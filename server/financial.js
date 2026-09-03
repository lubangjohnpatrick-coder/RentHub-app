'use strict';

// Financial API — server only. All money movement happens here using the
// service-role Supabase client, after authenticating the caller's Supabase JWT.
// The browser cannot do these because RLS blocks writes to financial tables.

const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth, requireAdmin } = require('./auth-service');
const ledger = require('./ledger');
const settings = require('./settings');
const payment = require('./payment');
const revenue = require('./revenue');

const router = express.Router();
const now = () => Date.now();
const json = (s, fb) => { try { return JSON.parse(s || '{}'); } catch (e) { return fb || {}; } };

const { PaymongoProvider, returnUrl } = require('./providers/paymongo');

// ============================================================
// PAYMONGO â?" public key exposure + intent creation
// ============================================================
router.get('/paymongo/config', requireAuth, (req, res) => {
  res.json({
    enabled: !!process.env.PAYMONGO_SECRET_KEY && !!process.env.PAYMONGO_PUBLIC_KEY,
    publicKey: process.env.PAYMONGO_PUBLIC_KEY || '',
    gateway: (process.env.GATEWAY || 'sandbox').toLowerCase(),
  });
});

// Wallet top-up via PayMongo Payment Intent (client-side attach flow).
// Creates a pending payment row + a PayMongo intent, returns client_key.
router.post('/wallet/paymongo/topup', requireAuth, async (req, res) => {
  try {
    const amount = Math.round(Number(req.body.amount));
    const method = req.body.method || 'gcash';
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid top-up amount' });

    const pay = await payment.createPayment({
      userId: req.user.id, bookingId: null, type: 'topup',
      grossAmount: amount, platformFee: 0, method: 'paymongo',
      meta: {},
    });
    const intent = await PaymongoProvider.createIntent({
      amountPesos: amount, method,
      description: 'GoRentHive wallet top-up ' + pay.payment_ref,
      metadata: { payment_ref: pay.payment_ref, user_id: String(req.user.id) },
    });
    const meta = { ...json(pay.meta), paymongo_intent_id: intent.id, paymongo_kind: 'topup', return_url: returnUrl('topup') };
    await svcClient().from('payments').update({ meta: JSON.stringify(meta), updated_at: now() }).eq('id', pay.id);

    if (intent.sandbox) {
      res.json({ ok: true, sandbox: true, payment_id: pay.id, client_key: intent.client_key, intent_id: intent.id, amount });
      return;
    }
    res.json({ ok: true, payment_id: pay.id, client_key: intent.client_key, intent_id: intent.id, amount, return_url: meta.return_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Direct booking payment via PayMongo: pays the booking total into the wallet
// so the existing wallet-escrow booking flow can proceed. Returns the intent
// plus the booking total so the client can confirm.
router.post('/bookings/paymongo', requireAuth, async (req, res) => {
  try {
    // When the draft identifies a listing + dates, recompute the authoritative
    // total server-side so the client cannot under/over-state the amount.
    let amount = Math.round(Number(req.body.total));
    const draft = req.body && req.body.booking_draft ? req.body.booking_draft : req.body;
    if (draft && draft.listing_id && draft.start_date && draft.end_date) {
      const listing = await loadListing(draft.listing_id);
      if (!listing.error && listing.data) {
        const l = listing.data;
        const start = new Date(draft.start_date).getTime();
        const end = new Date(draft.end_date).getTime();
        if (start && end && end > start) {
          const days = Math.max(1, Math.round((end - start) / REQ_DAYS_MS));
          const rentalFee = days * (l.price_per_day || 0);
          const method = draft.delivery_method === 'lalamove' || draft.delivery_requested ? 'lalamove' : 'pickup';
          let deliveryFee = 0;
          if (method === 'lalamove' && l.delivery_available) deliveryFee = l.delivery_fee || 0;
          const platformFee = await settings.computePlatformFee(rentalFee);
          amount = Math.round(rentalFee + deliveryFee + (l.security_deposit || 0) + platformFee);
        }
      }
    }
    const method = req.body.method || 'gcash';
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid booking total' });

    const pay = await payment.createPayment({
      userId: req.user.id, bookingId: null, type: 'booking_pay',
      grossAmount: amount, platformFee: 0, method: 'paymongo',
      meta: { booking_draft: req.body },
    });
    const intent = await PaymongoProvider.createIntent({
      amountPesos: amount, method,
      description: 'GoRentHive booking payment ' + pay.payment_ref,
      metadata: { payment_ref: pay.payment_ref, user_id: String(req.user.id) },
    });
    const meta = { ...json(pay.meta), paymongo_intent_id: intent.id, paymongo_kind: 'booking', return_url: returnUrl('booking') };
    await svcClient().from('payments').update({ meta: JSON.stringify(meta), updated_at: now() }).eq('id', pay.id);
    res.json({ ok: true, sandbox: !!intent.sandbox, payment_id: pay.id, client_key: intent.client_key, intent_id: intent.id, amount, return_url: meta.return_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Client confirm: after PayMongo redirect the browser may beat the webhook.
// Re-checks the intent (or falls back to the stored payment row) and, if it
// succeeded, settles the wallet credit. Idempotent.
router.post('/paymongo/confirm', requireAuth, async (req, res) => {
  try {
    const intentId = req.body.intent_id;
    const paymentId = req.body.payment_id;
    const { findPaymentByIntent, settlePayment } = require('./paymongo-webhook');

    let payment = null;
    if (paymentId) {
      const { data, error } = await svcClient().from('payments').select('*').eq('id', paymentId).limit(1).maybeSingle();
      if (!error && data) { try { data.meta = JSON.parse(data.meta || '{}'); } catch (e) { data.meta = {}; } payment = data; }
    }
    if (!payment && intentId) payment = await findPaymentByIntent(intentId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status === 'succeeded') {
      const balance = await ledger.getUserBalance(payment.user_id);
      return res.json({ ok: true, status: 'succeeded', balance });
    }

    // Re-query the intent from PayMongo to confirm.
    let intentStatus = null;
    if (intentId && PaymongoProvider.configured()) {
      const intent = await PaymongoProvider.getIntent(intentId);
      intentStatus = intent && intent.status;
    }
    if (intentStatus === 'succeeded') {
      const settle = await settlePayment(payment, intentId, intentId);
      const balance = await ledger.getUserBalance(payment.user_id);
      return res.json({ ok: true, status: 'succeeded', settled: settle.status, balance });
    }
    res.json({ ok: true, status: intentStatus || 'pending', payment_status: payment.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// WALLET
// ============================================================
router.post('/wallet/topup', requireAuth, async (req, res) => {
  try {
    if (!PaymongoProvider.configured()) {
      return res.status(403).json({ error: 'Payment gateway is not configured; wallet top-up is disabled' });
    }
    const amount = Math.round(Number(req.body.amount));
    const method = req.body.method || 'sandbox'; // 'sandbox' | 'gcash'
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid top-up amount' });

    // Switch gateway provider if gcash is requested
    if (String(method).toLowerCase() === 'gcash' && process.env.GATEWAY !== 'gcash') {
      const { GcashProvider } = require('./providers/gcash');
      payment.gateway.provider = GcashProvider;
    } else {
      payment.gateway.provider = payment.SandboxProvider;
    }

    const pay = await payment.createPayment({
      userId: req.user.id, bookingId: null, type: 'topup',
      grossAmount: amount, platformFee: 0, method,
      meta: { gcash_phone: req.body.gcash_phone || '' },
    });
    const walletAmount = Math.round(amount * 100); // pesos -> cents not used; keep pesos for MVP
    const executed = await payment.executeCharge(pay);
    if (executed.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment not captured', payment: executed, authorization_url: executed.authorization_url });
    }
    // Credit wallet = the top-up amount
    await ledger.addEntry({ userId: req.user.id, type: 'topup', amount, meta: { payment_ref: pay.payment_ref } });
    const balance = await ledger.getUserBalance(req.user.id);
    res.json({ ok: true, payment: executed, balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wallet/withdraw', requireAuth, async (req, res) => {
  try {
    const amount = Math.round(Number(req.body.amount));
    const method = req.body.method || 'bank';
    const account = String(req.body.account || '').trim();
    const accountName = String(req.body.account_name || '').trim();
    const bankName = String(req.body.bank_name || (method === 'bank' ? req.body.bank : '') || '').trim();
    const holder = String(req.body.account_holder || '').trim();
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!account) return res.status(400).json({ error: 'Please provide your payout account number / GCash or Maya number.' });
    if (!accountName) return res.status(400).json({ error: 'Please provide the account holder name for the payout.' });
    if (method === 'bank' && !bankName) return res.status(400).json({ error: 'Please provide the bank name.' });

    const balance = await ledger.getUserBalance(req.user.id);
    if (balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

    const pay = await payment.createPayment({
      userId: req.user.id, bookingId: null, type: 'withdrawal',
      grossAmount: amount, platformFee: 0, method, meta: { account, account_name: accountName, bank_name: bankName, account_holder: holder },
    });
    // Debit wallet (negative)
    await ledger.addEntry({ userId: req.user.id, type: 'payout', amount: -amount, meta: { payment_ref: pay.payment_ref } });
    // Record payout request (status pending, admin approves disbursement)
    await svcClient().from('payouts').insert({
      payment_id: pay.id, user_id: req.user.id, amount,
      status: 'pending', method, account,
      account_name: accountName, bank_name: bankName, account_holder: holder,
      created_at: now(),
    });
    const newBalance = await ledger.getUserBalance(req.user.id);
    res.json({ ok: true, payment: pay, balance: newBalance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/wallet', requireAuth, async (req, res) => {
  try {
    const balance = await ledger.getUserBalance(req.user.id);
    const [led, pays, pays2] = await Promise.all([
      svcClient().from('ledger_entries').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50),
      svcClient().from('payments').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50),
      svcClient().from('payouts').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(20),
    ]);
    const entries = (led.data || []).map((r) => ({ ...r, meta: json(r.meta) }));
    const payments = (pays.data || []).map((r) => ({ ...r, meta: json(r.meta) }));
    res.json({ balance, entries, payments, payouts: pays2.data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// BOOKINGS — create uses the wallet escrow
// ============================================================
// ALL monetary amounts are recomputed server-side from the listing row.
// Client-supplied prices / commission / payout / total are NEVER trusted.
const REQ_DAYS_MS = 24 * 60 * 60 * 1000;
const DELIVERY_VEHICLES = ['motorcycle', 'car', 'van', 'truck'];

async function loadListing(listingId) {
  return svcClient().from('listings').select('*').eq('id', listingId).limit(1).single();
}

// Server-computed price quote (shown live in the UI before booking).
router.post('/bookings/quote', requireAuth, async (req, res) => {
  try {
    const { listing_id, start_date, end_date, delivery_method, delivery_requested, distance_km, vehicle_type } = req.body || {};
    const listing = await loadListing(listing_id);
    if (listing.error || !listing.data) return res.status(404).json({ error: 'Listing not found' });
    const l = listing.data;
    const start = new Date(start_date).getTime();
    const end = new Date(end_date).getTime();
    if (!start || !end || end <= start) return res.status(400).json({ error: 'Invalid dates' });
    const days = Math.max(1, Math.round((end - start) / REQ_DAYS_MS));
    const rentalFee = days * (l.price_per_day || 0);
    const method = delivery_method === 'lalamove' || (delivery_method === undefined && delivery_requested) ? 'lalamove' : 'pickup';
    let deliveryFee = 0;
    let distance = 0;
    let vehicle = '';
    if (method === 'lalamove' && l.delivery_available) {
      distance = Math.max(0, parseFloat(distance_km) || 5);
      vehicle = DELIVERY_VEHICLES.includes(vehicle_type) ? vehicle_type : 'motorcycle';
      deliveryFee = l.delivery_fee || 0;
    }
    const platformFee = await settings.computePlatformFee(rentalFee);
    const deposit = l.security_deposit || 0;
    const total = rentalFee + deliveryFee + deposit + platformFee;
    res.json({
      days, rental_fee: rentalFee, delivery_method: method, delivery_fee: deliveryFee,
      lalamove_fee: deliveryFee, distance_km: distance, vehicle_type: vehicle,
      security_deposit: deposit, security_deposit_full: l.security_deposit || 0,
      platform_fee: platformFee, total, owner_earning: rentalFee - platformFee + deliveryFee,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/bookings', requireAuth, async (req, res) => {
  try {
    const { listing_id, start_date, end_date, delivery_requested, delivery_method, distance_km, vehicle_type, pickup_option, meeting_point, meeting_point_name, meeting_point_address } = req.body;
    const listing = await loadListing(listing_id);
    if (listing.error || !listing.data) return res.status(404).json({ error: 'Listing not found' });
    const l = listing.data;
    if (l.owner_id === req.user.id) return res.status(400).json({ error: 'You cannot rent your own listing' });
    if (l.status !== 'active') return res.status(400).json({ error: 'Listing is not available' });

    const start = new Date(start_date).getTime();
    const end = new Date(end_date).getTime();
    if (!start || !end || end <= start) return res.status(400).json({ error: 'Invalid dates' });
    const days = Math.max(1, Math.round((end - start) / REQ_DAYS_MS));

    // Idempotency: the same renter + same dates + same listing must never
    // produce two bookings (prevents double-click / retry duplicates even if
    // the frontend guard is bypassed). The client sends a stable key derived
    // from the request; if it matches an earlier booking we return that row
    // without debiting the wallet again.
    const keyRaw = req.headers['idempotency-key'] || req.body.idempotency_key ||
      ['bk', req.user.id, listing_id, start, end].join('|');
    const clientRequestId = String(keyRaw).slice(0, 120);
    const { data: existing } = await svcClient().from('bookings')
      .select('*').eq('renter_id', req.user.id).eq('client_request_id', clientRequestId).limit(1).maybeSingle();
    if (existing) return res.json({ ok: true, booking: existing, idempotent: true });

    // Server-side price computation — never trusts the client.
    const rentalFee = days * (l.price_per_day || 0);
    const method = delivery_method === 'lalamove' || (delivery_method === undefined && delivery_requested) ? 'lalamove' : 'pickup';
    let deliveryFee = 0;
    let distance = 0;
    let vehicle = '';
    if (method === 'lalamove') {
      if (!l.delivery_available) return res.status(400).json({ error: 'This item is not available for delivery' });
      distance = Math.max(0, parseFloat(distance_km) || 5);
      vehicle = DELIVERY_VEHICLES.includes(vehicle_type) ? vehicle_type : 'motorcycle';
      deliveryFee = l.delivery_fee || 0;
    }
    const platformFee = await settings.computePlatformFee(rentalFee);
    const rateAtBooking = await settings.getPlatformRate();
    const deposit = l.security_deposit || 0;
    const total = rentalFee + deliveryFee + deposit + platformFee;
    const amountDueOwner = rentalFee - platformFee + deliveryFee;

    // Wallet escrow balance check against the SERVER-computed total.
    const balance = await ledger.getUserBalance(req.user.id);
    if (balance < total) {
      return res.status(402).json({ error: 'Insufficient wallet balance. Please top up first.', code: 'insufficient_funds', required: total, balance });
    }

    // Availability check (no overlapping active/pending bookings).
    const { data: overlap } = await svcClient().from('bookings').select('id')
      .eq('listing_id', listing_id).in('status', ['pending', 'approved', 'active'])
      .lt('start_date', end).gt('end_date', start).limit(1).maybeSingle();
    if (overlap) return res.status(400).json({ error: 'The item is already booked for those dates' });

    const ownerId = l.owner_id;
    const bookingRef = 'BK-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();

    // Debited once; platform keeps rental escrow + deposit escrow + fees.
    await ledger.addEntry({ userId: req.user.id, type: 'rental_escrow', amount: -(rentalFee + deliveryFee), meta: { booking_ref: bookingRef } });
    if (deposit > 0) {
      await ledger.addEntry({ userId: req.user.id, type: 'deposit_escrow', amount: -deposit, meta: { booking_ref: bookingRef } });
    }

    const nowMs = now();
    const booking = (await svcClient().from('bookings').insert({
      booking_ref: bookingRef, renter_id: req.user.id, owner_id: ownerId, listing_id,
      client_request_id: clientRequestId,
      start_date: start, end_date: end, rental_days: days, rental_fee: rentalFee, security_deposit: deposit,
      daily_rate_at_booking: l.price_per_day || 0, commission_rate_at_booking: rateAtBooking.percent || 0,
      delivery_fee: deliveryFee, delivery_requested: method === 'lalamove',
      pickup_option: pickup_option || 'pickup', delivery_method: method,
      delivery_distance_km: distance, delivery_vehicle_type: vehicle,
      lalamove_fee: deliveryFee, platform_fee: platformFee,
      total_charged: total, amount_due_owner: amountDueOwner,
      status: 'pending', escrow_payment: true, created_at: nowMs, updated_at: nowMs,
    }).select().single());

    if (booking.error) throw new Error(booking.error.message);

    if (deposit > 0) {
      await svcClient().from('security_deposits').insert({
        booking_id: booking.data.id, renter_id: req.user.id, owner_id: ownerId,
        amount: deposit, status: 'held', created_at: nowMs,
      });
    }

    // meeting point (optional) — accepts both nested and flat client payloads.
    const mpName = (meeting_point && meeting_point.name) || meeting_point_name || '';
    const mpAddr = (meeting_point && meeting_point.address) || meeting_point_address || '';
    if (mpName) {
      await svcClient().from('meeting_points').insert({
        booking_id: booking.data.id, point_name: mpName,
        point_address: mpAddr, latitude: (meeting_point && meeting_point.latitude) || null,
        longitude: (meeting_point && meeting_point.longitude) || null, proposed_by: req.user.id,
        created_at: nowMs, updated_at: nowMs,
      });
    }

    res.json({ ok: true, booking: booking.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// CANCEL — refund logic
// ============================================================
router.post('/bookings/:id/cancel', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const bk = await svcClient().from('bookings').select('*').eq('id', id).limit(1).single();
    if (bk.error || !bk.data) return res.status(404).json({ error: 'Booking not found' });
    const b = bk.data;
    if (b.renter_id !== req.user.id && b.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your booking' });
    }
    if (!['pending', 'approved'].includes(b.status)) {
      return res.status(400).json({ error: 'Booking cannot be cancelled now' });
    }

    const freeH = parseInt(await settings.getSetting('free_cancellation_hours', '48'), 10) || 48;
    const partH = parseInt(await settings.getSetting('partial_cancellation_hours', '24'), 10) || 24;
    const hoursLeft = (b.start_date - now()) / 3600000;
    let refundPct = 1;
    if (hoursLeft < partH) refundPct = 0;
    else if (hoursLeft < freeH) refundPct = 0.5;

    // Refund rental+delivery escrow (and deposit fully)
    const refundAmount = Math.round((b.rental_fee + b.delivery_fee) * refundPct);
    await ledger.addEntry({ bookingId: b.id, userId: b.renter_id, type: 'refund', amount: refundAmount, meta: { reason: 'cancellation' } });
    if (b.security_deposit > 0) {
      await ledger.addEntry({ bookingId: b.id, userId: b.renter_id, type: 'deposit', amount: b.security_deposit, meta: { reason: 'deposit_release_cancel' } });
    }
    // Refund the non-refunded portion is kept by owner/platform per policy (MVP keeps on account)
    const nowMs = now();
    await svcClient().from('bookings').update({
      status: refundAmount > 0 ? 'refunded' : 'cancelled',
      refund_amount: refundAmount + b.security_deposit,
      refunded_at: nowMs,
      cancellation_reason: req.body.reason || 'cancelled', cancelled_by: req.user.id, updated_at: nowMs,
    }).eq('id', b.id);
    const balance = await ledger.getUserBalance(b.renter_id);
    res.json({ ok: true, refundAmount, deposit: b.security_deposit, balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// COMPLETE — finalize, release deposit, credit owner
// ============================================================
router.post('/bookings/:id/complete', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const bk = await svcClient().from('bookings').select('*').eq('id', id).limit(1).single();
    if (bk.error || !bk.data) return res.status(404).json({ error: 'Booking not found' });
    const b = bk.data;
    if (b.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the owner can complete this booking' });
    }
    if (b.status !== 'active' && b.status !== 'returned') {
      return res.status(400).json({ error: 'Booking is not in a completable state' });
    }

    const proposed = b.return_proposed_deduction > 0 ? b.return_proposed_deduction : 0;

    // Credit owner: rental - platform fee + delivery fee (+ proposed deduction as damage penalty)
    const ownerEarning = b.rental_fee - b.platform_fee + b.delivery_fee + proposed;
    await ledger.addEntry({ bookingId: b.id, userId: b.owner_id, type: 'owner_earning', amount: ownerEarning, meta: { booking_ref: b.booking_ref } });

    // Platform keeps its commission (8% or min 20 of rental fee)
    await revenue.addIncome('commission', b.platform_fee || 0);

    // Damage deduction credited to owner
    if (proposed > 0) {
      await ledger.addEntry({ bookingId: b.id, userId: b.owner_id, type: 'deposit_deduction', amount: proposed, meta: { reason: 'damage' } });
    }

    // Release remaining deposit to renter
    const depositRemaining = Math.max(0, b.security_deposit - proposed);
    if (depositRemaining > 0) {
      await ledger.addEntry({ bookingId: b.id, userId: b.renter_id, type: 'deposit', amount: depositRemaining, meta: { reason: 'deposit_release' } });
    }
    if (b.security_deposit > 0) {
      const dep = await svcClient().from('security_deposits').select('*').eq('booking_id', b.id).limit(1).maybeSingle();
      if (dep.data && dep.data.status === 'held') {
        await svcClient().from('security_deposits').update({
          status: proposed > 0 ? 'partially_deducted' : 'released', deduction: proposed, released_at: now(),
        }).eq('id', dep.data.id);
      }
    }

    await svcClient().from('bookings').update({ status: 'completed', escrow_released: true, return_completed_at: now(), updated_at: now() }).eq('id', b.id);
    const listingRow = await svcClient().from('listings').select('rental_count').eq('id', b.listing_id).limit(1).single();
    await svcClient().from('listings').update({ rental_count: (listingRow.data?.rental_count || 0) + 1 }).eq('id', b.listing_id);

    res.json({ ok: true, ownerEarning, depositReleased: depositRemaining });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// CHECKOUT QUOTE (server-computed, authoritative)
// ============================================================
router.post('/quote', requireAuth, async (req, res) => {
  try {
    const { rental_fee, delivery_fee } = req.body;
    const platformFee = await settings.computePlatformFee(rental_fee || 0);
    const total = (rental_fee || 0) + (delivery_fee || 0) + platformFee;
    res.json({ rental_fee: rental_fee || 0, delivery_fee: delivery_fee || 0, platform_fee: platformFee, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ADMIN — disputes + payouts (money movement)
// ============================================================
router.get('/admin/payouts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await svcClient().from('payouts').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/payouts/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const status = req.body.status;
    const ALLOWED = ['pending', 'processed', 'completed', 'rejected', 'cancelled'];
    if (!ALLOWED.includes(status)) return res.status(400).json({ error: 'Invalid payout status' });
    const { data: p, error } = await svcClient().from('payouts').select('*').eq('id', id).limit(1).single();
    if (error || !p) return res.status(404).json({ error: 'Payout not found' });
    await svcClient().from('payouts').update({ status }).eq('id', id);
    if (status === 'completed') {
      await svcClient().from('payments').update({ status: 'succeeded', updated_at: now() }).eq('id', p.payment_id);
    } else if (status === 'rejected' || status === 'cancelled') {
      // refund the debited amount back to the user wallet
      await ledger.addEntry({ userId: p.user_id, type: 'refund', amount: p.amount, meta: { reason: 'payout_rejected', payout_id: id } });
      await svcClient().from('payments').update({ status: 'refunded', updated_at: now() }).eq('id', p.payment_id);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/disputes/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { status, resolution, booking_action } = req.body;
    await svcClient().from('disputes').update({ status, resolution: resolution || '', resolved_by: req.user.id, resolved_at: now() }).eq('id', id);
    if (booking_action === 'release_to_owner') {
      // force-complete: release to owner using default split (no deduction)
      const d = await svcClient().from('disputes').select('booking_id').eq('id', id).limit(1).single();
      if (d.data?.booking_id) {
        const bk = await svcClient().from('bookings').select('*').eq('id', d.data.booking_id).limit(1).single();
        const b = bk.data;
        const ownerEarning = b.rental_fee - b.platform_fee + b.delivery_fee;
        await ledger.addEntry({ bookingId: b.id, userId: b.owner_id, type: 'owner_earning', amount: ownerEarning, meta: { reason: 'dispute' } });
        if (b.security_deposit > 0) {
          await ledger.addEntry({ bookingId: b.id, userId: b.renter_id, type: 'deposit', amount: b.security_deposit, meta: { reason: 'dispute_deposit' } });
        }
        await svcClient().from('bookings').update({ status: 'completed', escrow_released: true, updated_at: now() }).eq('id', b.id);
      }
    } else if (booking_action === 'refund_renter') {
      const d = await svcClient().from('disputes').select('booking_id').eq('id', id).limit(1).single();
      if (d.data?.booking_id) {
        const bk = await svcClient().from('bookings').select('*').eq('id', d.data.booking_id).limit(1).single();
        const b = bk.data;
        const refund = b.rental_fee + b.delivery_fee + b.security_deposit;
        await ledger.addEntry({ bookingId: b.id, userId: b.renter_id, type: 'refund', amount: refund, meta: { reason: 'dispute_refund' } });
        await svcClient().from('bookings').update({ status: 'cancelled', escrow_released: true, updated_at: now() }).eq('id', b.id);
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/revenue', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rev = await revenue.getRevenue();
    const [method, account, accountName, bankName] = await Promise.all([
      settings.getSetting('founder_payout_method', ''),
      settings.getSetting('founder_payout_account', ''),
      settings.getSetting('founder_payout_account_name', ''),
      settings.getSetting('founder_payout_bank', ''),
    ]);
    const founder = { method, account, account_name: accountName, bank_name: bankName };
    res.json({ ...rev, founder });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Founder payout account (where the platform's own earnings get remitted).
router.post('/admin/founder', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { method, account, account_name, bank_name } = req.body || {};
    if (!method || !account) return res.status(400).json({ error: 'Payout method and account are required.' });
    await Promise.all([
      settings.setSetting('founder_payout_method', method),
      settings.setSetting('founder_payout_account', String(account).trim()),
      settings.setSetting('founder_payout_account_name', String(account_name || '').trim()),
      settings.setSetting('founder_payout_bank', String(bank_name || '').trim()),
    ]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Renter/owner preferred payout destination (saved on the user profile).
router.post('/me/payout-preference', requireAuth, async (req, res) => {
  try {
    const { method, account, account_name } = req.body || {};
    if (!method || !account) return res.status(400).json({ error: 'Method and account are required.' });
    await svcClient().from('users').update({
      payout_preference: method,
      payout_account: String(account).trim(),
      payout_account_name: String(account_name || '').trim(),
    }).eq('id', req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
