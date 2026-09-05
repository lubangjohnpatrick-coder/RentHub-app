'use strict';

// Launch-safe booking endpoints. GoRentHive does not operate delivery. The
// renter pays rental + refundable deposit; the 8% commission is deducted from
// owner earnings. Wallet reservation is atomic in Postgres.

const express = require('express');
const crypto = require('crypto');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');
const settings = require('./settings');
const ledger = require('./ledger');
const payment = require('./payment');
const { PaymongoProvider, returnUrl } = require('./providers/paymongo');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const now = () => Date.now();

function parseJson(s, fallback = {}) {
  try { return JSON.parse(s || '{}'); } catch (_) { return fallback; }
}

function validateDates(startInput, endInput) {
  const start = new Date(startInput).getTime();
  const end = new Date(endInput).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, status: 400, error: 'Please enter valid rental dates.', code: 'invalid_date' };
  if (end < start) return { ok: false, status: 400, error: 'The end date must be on or after the start date.', code: 'date_order' };
  if (start < now() - 60 * 60 * 1000) return { ok: false, status: 400, error: 'The rental start date cannot be in the past.', code: 'past_date' };
  const days = Math.max(1, Math.ceil(Math.max(0, end - start) / DAY_MS));
  return { ok: true, start, end, days };
}

function handoverOption(value) {
  return String(value || '').toLowerCase() === 'meetup' ? 'meetup' : 'pickup';
}

function payMethod(value) {
  const method = String(value || '').toLowerCase();
  return ['gcash', 'maya'].includes(method) ? method : 'gcash';
}

function canonicalDraft(draft) {
  const d = draft && typeof draft === 'object' ? draft : {};
  const meeting = d.meeting_point && typeof d.meeting_point === 'object' ? d.meeting_point : {};
  return {
    listing_id: Number(d.listing_id),
    start_date: d.start_date,
    end_date: d.end_date,
    pickup_option: handoverOption(d.pickup_option),
    meeting_point: {
      name: String(meeting.name || d.meeting_point_name || '').trim().slice(0, 200),
      address: String(meeting.address || d.meeting_point_address || '').trim().slice(0, 500),
    },
  };
}

async function getListing(id) {
  return svcClient().from('listings').select('*').eq('id', id).limit(1).single();
}

async function quoteFor(user, draft) {
  const { listing_id, start_date, end_date } = draft || {};
  const listing = await getListing(listing_id);
  if (listing.error || !listing.data) return { error: 'Listing not found', status: 404 };
  const l = listing.data;
  if (l.status !== 'active') return { error: 'Listing is not available', status: 400 };
  if (user && l.owner_id === user.id) return { error: 'You cannot rent your own listing', status: 400 };

  const d = validateDates(start_date, end_date);
  if (!d.ok) return { error: d.error, status: d.status, code: d.code };

  const rentalFee = d.days * Math.max(0, Number(l.price_per_day) || 0);
  const deposit = Math.max(0, Number(l.security_deposit) || 0);
  const platformFee = await settings.computePlatformFee(rentalFee);
  const rate = await settings.getPlatformRate();
  const ownerEarning = Math.max(0, rentalFee - platformFee);
  const renterTotal = rentalFee + deposit;

  return {
    listing: l,
    start: d.start,
    end: d.end,
    days: d.days,
    rental_fee: rentalFee,
    security_deposit: deposit,
    platform_fee: platformFee,
    commission_rate: rate.percent,
    owner_earning: ownerEarning,
    total: renterTotal,
    delivery_fee: 0,
    delivery_method: 'pickup',
  };
}

router.post('/bookings/quote', requireAuth, async (req, res) => {
  try {
    const draft = canonicalDraft(req.body || {});
    const q = await quoteFor(req.user, draft);
    if (q.error) return res.status(q.status || 400).json({ error: q.error, code: q.code });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      rental_days: q.days,
      rental_fee: q.rental_fee,
      security_deposit: q.security_deposit,
      platform_fee: q.platform_fee,
      commission_rate: q.commission_rate,
      owner_earning: q.owner_earning,
      total: q.total,
      delivery_fee: 0,
      delivery_method: 'pickup',
      pricing_note: 'GoRentHive commission is deducted from owner earnings. Renters are not charged an additional platform commission.',
    });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] booking quote failed`, e);
    res.status(500).json({ error: 'Could not calculate the booking quote.', request_id: req.requestId });
  }
});

router.post('/bookings/paymongo', requireAuth, async (req, res) => {
  try {
    if (String(process.env.GATEWAY || '').toLowerCase() !== 'paymongo' || !PaymongoProvider.configured()) {
      return res.status(503).json({ error: 'Online payments are not configured. Booking payment is unavailable.', code: 'payment_provider_required' });
    }
    const draft = canonicalDraft(req.body && req.body.booking_draft ? req.body.booking_draft : req.body);
    const q = await quoteFor(req.user, draft);
    if (q.error) return res.status(q.status || 400).json({ error: q.error, code: q.code });
    if (q.total <= 0) return res.status(400).json({ error: 'Invalid booking total' });

    const method = payMethod(req.body.method);
    const pay = await payment.createPayment({
      userId: req.user.id,
      bookingId: null,
      type: 'booking_pay',
      grossAmount: Math.round(q.total),
      platformFee: 0,
      method: 'paymongo',
      meta: { booking_draft: draft, requested_method: method },
    });
    const intent = await PaymongoProvider.createIntent({
      amountPesos: Math.round(q.total),
      method,
      description: 'GoRentHive booking payment ' + pay.payment_ref,
      metadata: { payment_ref: pay.payment_ref, user_id: String(req.user.id), purpose: 'booking' },
    });
    if (intent.sandbox && String(process.env.NODE_ENV || '').toLowerCase() === 'production') throw new Error('Sandbox payment intent refused in production');
    const meta = {
      ...parseJson(pay.meta),
      paymongo_intent_id: intent.id,
      paymongo_kind: 'booking',
      requested_method: method,
      return_url: returnUrl('booking'),
    };
    await svcClient().from('payments').update({ meta: JSON.stringify(meta), updated_at: now() }).eq('id', pay.id);
    res.json({
      ok: true, sandbox: !!intent.sandbox, payment_id: pay.id,
      client_key: intent.client_key, intent_id: intent.id,
      amount: Math.round(q.total), method, return_url: meta.return_url,
    });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] booking payment intent failed`, e);
    res.status(502).json({ error: 'Could not start the booking payment. Please try again.', request_id: req.requestId });
  }
});

router.post('/bookings', requireAuth, async (req, res) => {
  let insertedId = null;
  try {
    const draft = canonicalDraft(req.body || {});
    const q = await quoteFor(req.user, draft);
    if (q.error) return res.status(q.status || 400).json({ error: q.error, code: q.code });
    const l = q.listing;

    const missing = [];
    if (!req.user.email_verified) missing.push('email');
    if (!req.user.mobile_verified) missing.push('mobile');
    if (missing.length) return res.status(428).json({ error: 'Complete email and mobile verification before booking.', code: 'verify_required', missing });

    const needLevel = Number(l.min_verification_level || 2);
    const userLevel = Number(req.user.identity_level || 1);
    if (userLevel < needLevel) {
      return res.status(428).json({ error: 'This listing requires a higher verification level. Complete account verification first.', code: 'verify_required', required: needLevel, current: userLevel });
    }

    const rawKey = String(req.headers['idempotency-key'] || req.body.idempotency_key || 'automatic').slice(0, 180);
    const clientRequestId = crypto.createHash('sha256')
      .update([req.user.id, l.id, q.start, q.end, rawKey].join('|'))
      .digest('hex');
    const { data: existing } = await svcClient().from('bookings').select('*').eq('renter_id', req.user.id).eq('client_request_id', clientRequestId).limit(1).maybeSingle();
    if (existing) return res.json({ ok: true, booking: existing, idempotent: true });

    // Fast UX precheck only. The reserve_booking_funds RPC rechecks while the
    // wallet row is locked and is the authoritative insufficient-funds gate.
    const visibleBalance = await ledger.getUserBalance(req.user.id);
    if (visibleBalance < q.total) return res.status(402).json({ error: 'Insufficient wallet balance. Please fund the booking first.', code: 'insufficient_funds', required: q.total, balance: visibleBalance });

    const { data: overlap } = await svcClient().from('bookings').select('id')
      .eq('listing_id', l.id).in('status', ['pending','approved','active','returned','disputed'])
      .lt('start_date', q.end + 1).gt('end_date', q.start - 1).limit(1).maybeSingle();
    if (overlap) return res.status(409).json({ error: 'The item is already booked for those dates.', code: 'date_conflict' });

    const bookingRef = 'BK-' + now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const row = {
      booking_ref: bookingRef,
      renter_id: req.user.id,
      owner_id: l.owner_id,
      listing_id: l.id,
      client_request_id: clientRequestId,
      start_date: q.start,
      end_date: q.end,
      rental_days: q.days,
      rental_fee: q.rental_fee,
      daily_rate_at_booking: Math.max(0, Number(l.price_per_day) || 0),
      commission_rate_at_booking: q.commission_rate,
      security_deposit: q.security_deposit,
      delivery_fee: 0,
      delivery_requested: false,
      pickup_option: handoverOption(draft.pickup_option),
      delivery_method: 'pickup',
      delivery_distance_km: 0,
      delivery_vehicle_type: '',
      lalamove_fee: 0,
      platform_fee: q.platform_fee,
      total_charged: q.total,
      amount_due_owner: q.owner_earning,
      status: 'pending',
      escrow_payment: true, // legacy DB column name; UI uses "protected payment"
      payment_confirmed: true,
      created_at: now(),
      updated_at: now(),
    };

    const ins = await svcClient().from('bookings').insert(row).select().single();
    if (ins.error) {
      const raw = String(ins.error.message || '').toLowerCase();
      if (/exclusion|overlap|unique|already exists|23p01|23505/.test(raw)) return res.status(409).json({ error: 'This item was just booked by someone else. Please choose different dates.' });
      throw new Error(ins.error.message);
    }
    insertedId = ins.data.id;

    const reserve = await svcClient().rpc('reserve_booking_funds', {
      p_booking_id: insertedId,
      p_renter_id: req.user.id,
      p_owner_id: l.owner_id,
      p_rental_amount: q.rental_fee,
      p_deposit_amount: q.security_deposit,
      p_booking_ref: bookingRef,
    });
    if (reserve.error) {
      await svcClient().from('bookings').delete().eq('id', insertedId);
      insertedId = null;
      throw new Error('Could not reserve booking funds. Apply the latest financial-integrity migration and try again.');
    }
    const reservation = Array.isArray(reserve.data) ? reserve.data[0] : reserve.data;
    if (!reservation || reservation.reservation_status !== 'reserved') {
      await svcClient().from('bookings').delete().eq('id', insertedId);
      insertedId = null;
      if (reservation && reservation.reservation_status === 'insufficient_funds') {
        return res.status(402).json({ error: 'Your wallet balance changed before the booking could be reserved. Please fund the difference and try again.', code: 'insufficient_funds', required: q.total, balance: reservation.new_balance || 0 });
      }
      throw new Error('Booking funds could not be reserved.');
    }

    // Meeting point is coordination metadata, not a financial dependency. A
    // transient insert failure must not undo a successfully reserved booking.
    const pointName = draft.meeting_point && draft.meeting_point.name;
    const pointAddress = draft.meeting_point && draft.meeting_point.address;
    if (pointName) {
      try {
        await svcClient().from('meeting_points').insert({
          booking_id: insertedId,
          point_name: pointName,
          point_address: pointAddress || '',
          latitude: null,
          longitude: null,
          proposed_by: req.user.id,
          created_at: now(),
          updated_at: now(),
        });
      } catch (_) {}
    }

    res.json({ ok: true, booking: ins.data });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] booking creation failed`, e);
    if (insertedId) {
      // At this point a failed reservation has already been rolled back by the
      // RPC transaction. Only delete rows that have no committed ledger entries.
      try { await svcClient().from('bookings').delete().eq('id', insertedId); } catch (_) {}
    }
    res.status(500).json({ error: 'Could not create booking. Please try again.', request_id: req.requestId });
  }
});

module.exports = router;
module.exports._test = { canonicalDraft, handoverOption, payMethod, validateDates };
