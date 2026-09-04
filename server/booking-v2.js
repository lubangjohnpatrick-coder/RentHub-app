'use strict';

// Launch-safe booking endpoints. Mounted before legacy financial routes.
// GoRentHive does not operate delivery. The renter pays rental + refundable
// security deposit. The 8% marketplace commission is deducted from the
// owner's rental earnings only.

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
    const q = await quoteFor(req.user, req.body || {});
    if (q.error) return res.status(q.status || 400).json({ error: q.error, code: q.code });
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/bookings/paymongo', requireAuth, async (req, res) => {
  try {
    if (!PaymongoProvider.configured()) return res.status(503).json({ error: 'Online payments are not configured. Booking payment is unavailable.', code: 'payment_provider_required' });
    const draft = req.body && req.body.booking_draft ? req.body.booking_draft : req.body;
    const q = await quoteFor(req.user, draft || {});
    if (q.error) return res.status(q.status || 400).json({ error: q.error, code: q.code });
    if (q.total <= 0) return res.status(400).json({ error: 'Invalid booking total' });

    const method = String(req.body.method || 'gcash').toLowerCase();
    const pay = await payment.createPayment({
      userId: req.user.id,
      bookingId: null,
      type: 'booking_pay',
      grossAmount: Math.round(q.total),
      platformFee: 0,
      method: 'paymongo',
      meta: { booking_draft: draft },
    });
    const intent = await PaymongoProvider.createIntent({
      amountPesos: Math.round(q.total),
      method,
      description: 'GoRentHive booking payment ' + pay.payment_ref,
      metadata: { payment_ref: pay.payment_ref, user_id: String(req.user.id) },
    });
    if (intent.sandbox && String(process.env.NODE_ENV || '').toLowerCase() === 'production') throw new Error('Sandbox payment intent refused in production');
    const meta = {
      ...parseJson(pay.meta),
      paymongo_intent_id: intent.id,
      paymongo_kind: 'booking',
      return_url: returnUrl('booking'),
    };
    await svcClient().from('payments').update({ meta: JSON.stringify(meta), updated_at: now() }).eq('id', pay.id);
    res.json({ ok: true, sandbox: !!intent.sandbox, payment_id: pay.id, client_key: intent.client_key, intent_id: intent.id, amount: Math.round(q.total), return_url: meta.return_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/bookings', requireAuth, async (req, res) => {
  let rentalDebited = false;
  let depositDebited = false;
  let insertedId = null;
  let rollbackRental = 0;
  let rollbackDeposit = 0;
  try {
    const draft = req.body || {};
    const q = await quoteFor(req.user, draft);
    if (q.error) return res.status(q.status || 400).json({ error: q.error, code: q.code });
    rollbackRental = q.rental_fee;
    rollbackDeposit = q.security_deposit;
    const l = q.listing;

    const needLevel = Number(l.min_verification_level || 2);
    const userLevel = Number(req.user.identity_level || 1);
    if (userLevel < needLevel) {
      return res.status(428).json({ error: 'This listing requires a higher verification level. Complete account verification first.', code: 'verify_required', required: needLevel, current: userLevel });
    }

    const keyRaw = req.headers['idempotency-key'] || draft.idempotency_key || ['bk', req.user.id, l.id, q.start, q.end].join('|');
    const clientRequestId = String(keyRaw).slice(0, 120);
    const { data: existing } = await svcClient().from('bookings').select('*').eq('renter_id', req.user.id).eq('client_request_id', clientRequestId).limit(1).maybeSingle();
    if (existing) return res.json({ ok: true, booking: existing, idempotent: true });

    const balance = await ledger.getUserBalance(req.user.id);
    if (balance < q.total) return res.status(402).json({ error: 'Insufficient wallet balance. Please fund the booking first.', code: 'insufficient_funds', required: q.total, balance });

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
      pickup_option: draft.pickup_option || 'pickup',
      delivery_method: 'pickup',
      delivery_distance_km: 0,
      delivery_vehicle_type: '',
      lalamove_fee: 0,
      platform_fee: q.platform_fee,
      total_charged: q.total,
      amount_due_owner: q.owner_earning,
      status: 'pending',
      escrow_payment: true,
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

    await ledger.addEntry({ bookingId: insertedId, userId: req.user.id, type: 'rental_escrow', amount: -q.rental_fee, meta: { booking_ref: bookingRef } });
    rentalDebited = true;
    if (q.security_deposit > 0) {
      await ledger.addEntry({ bookingId: insertedId, userId: req.user.id, type: 'deposit_escrow', amount: -q.security_deposit, meta: { booking_ref: bookingRef } });
      depositDebited = true;
      await svcClient().from('security_deposits').insert({ booking_id: insertedId, renter_id: req.user.id, owner_id: l.owner_id, amount: q.security_deposit, status: 'held', created_at: now() });
    }

    const pointName = (draft.meeting_point && draft.meeting_point.name) || draft.meeting_point_name || '';
    const pointAddress = (draft.meeting_point && draft.meeting_point.address) || draft.meeting_point_address || '';
    if (pointName) {
      await svcClient().from('meeting_points').insert({ booking_id: insertedId, point_name: String(pointName).slice(0, 200), point_address: String(pointAddress).slice(0, 500), latitude: null, longitude: null, proposed_by: req.user.id, created_at: now(), updated_at: now() });
    }

    res.json({ ok: true, booking: ins.data });
  } catch (e) {
    try {
      if (insertedId) {
        if (depositDebited && rollbackDeposit > 0) await ledger.addEntry({ bookingId: insertedId, userId: req.user.id, type: 'refund', amount: rollbackDeposit, meta: { reason: 'booking_create_rollback_deposit' } });
        if (rentalDebited && rollbackRental > 0) await ledger.addEntry({ bookingId: insertedId, userId: req.user.id, type: 'refund', amount: rollbackRental, meta: { reason: 'booking_create_rollback_rental' } });
        await svcClient().from('security_deposits').delete().eq('booking_id', insertedId);
        await svcClient().from('bookings').delete().eq('id', insertedId);
      }
    } catch (_) {}
    res.status(500).json({ error: e.message || 'Could not create booking' });
  }
});

module.exports = router;
