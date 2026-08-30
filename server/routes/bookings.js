'use strict';

const express = require('express');
const db = require('../db/schema');
const { requireAuth, publicUser } = require('../auth');
const ledger = require('../ledger');
const settings = require('../settings');
const delivery = require('../delivery');
const { createPayment, executeCharge } = require('../payment');
const { notify } = require('../notify');
const verify = require('../verify');
const trust = require('../trust');
const router = express.Router();

function genBookingRef() {
  return 'RH-' + Math.random().toString(36).slice(2, 7).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
}

// ---- Compute a quote without creating a booking (shown live in UI) ----
router.post('/quote', requireAuth, (req, res) => {
  const { listing_id, start_date, end_date, delivery_requested, delivery_method, distance_km, vehicle_type } = req.body || {};
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(listing_id);
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  const start = new Date(start_date).getTime();
  const end = new Date(end_date).getTime();
  if (!start || !end || end <= start) return res.status(400).json({ error: 'Invalid dates' });
  const days = Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
  const rentalFee = days * l.price_per_day;

  // Delivery method: pickup (no fee) or lalamove (carrier fee via gateway).
  const method = delivery_method === 'lalamove' || (delivery_method === undefined && delivery_requested) ? 'lalamove' : 'pickup';
  let deliveryFee = 0;
  let carrierFee = 0;
  let distance = 0;
  let vehicle = 'motorcycle';
  if (method === 'lalamove' && delivery.gateway.enabled() && l.delivery_available) {
    distance = Math.max(0, parseFloat(distance_km) || 5);
    vehicle = delivery.VEHICLES.includes(vehicle_type) ? vehicle_type : 'motorcycle';
    const q = delivery.gateway.quote({ distanceKm: distance, vehicleType: vehicle });
    deliveryFee = q.fee;
    carrierFee = q.fee;
  }
  const platformFee = settings.computePlatformFee(rentalFee);
  const disc = trust.depositDiscount(req.user, l.security_deposit);
  const effectiveDeposit = disc.effective_deposit;
  const total = rentalFee + deliveryFee + effectiveDeposit + platformFee;
  res.json({
    days,
    rental_fee: rentalFee,
    delivery_method: method,
    delivery_fee: deliveryFee,
    lalamove_fee: carrierFee,
    distance_km: distance,
    vehicle_type: vehicle,
    security_deposit: effectiveDeposit,
    security_deposit_full: l.security_deposit,
    deposit_discount_pct: disc.discount_pct,
    platform_fee: platformFee,
    total,
    owner_earning: rentalFee - platformFee + deliveryFee,
  });
});

// ---- Create a booking request ----
router.post('/', requireAuth, (req, res) => {
  const { listing_id, start_date, end_date, delivery_requested, pickup_option, delivery_method, distance_km, vehicle_type, dropoff_address, meeting_point_name, meeting_point_address, meeting_point_lat, meeting_point_lng } = req.body || {};
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(listing_id);
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  if (l.owner_id === req.user.id) return res.status(400).json({ error: 'You cannot rent your own listing' });
  if (l.status !== 'active') return res.status(400).json({ error: 'Listing is not available' });

  // ---- GATE 1: current Terms & Conditions accepted ----
  if (!verify.hasAcceptedTerms(req.user)) {
    return res.status(428).json({ error: 'You must accept the current Terms & Conditions before booking.', code: 'terms_required' });
  }
  // ---- GATE 2: full identity verification (email + mobile + ID) ----
  if (!verify.isFullyVerified(req.user)) {
    const st = verify.verificationStatus(req.user);
    return res.status(428).json({ error: 'You must complete identity verification to rent.', code: 'verify_required', missing: st.missing });
  }
  // ---- GATE 3: listing's minimum verification level ----
  if (!verify.meetsLevel(req.user, l.min_verification_level || 1)) {
    return res.status(428).json({ error: `This listing requires Level ${l.min_verification_level} verification. Complete identity verification to continue.`, code: 'level_required' });
  }

  const start = new Date(start_date).getTime();
  const end = new Date(end_date).getTime();
  if (!start || !end || end <= start) return res.status(400).json({ error: 'Invalid dates' });
  const days = Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
  const rentalFee = days * l.price_per_day;

  const method = delivery_method === 'lalamove' || (delivery_method === undefined && delivery_requested) ? 'lalamove' : 'pickup';
  let deliveryFee = 0;
  let carrierFee = 0;
  let distance = 0;
  let vehicle = 'motorcycle';
  if (method === 'lalamove') {
    if (!l.delivery_available) return res.status(400).json({ error: 'This item is not available for delivery.' });
    distance = Math.max(0, parseFloat(distance_km) || 5);
    vehicle = delivery.VEHICLES.includes(vehicle_type) ? vehicle_type : 'motorcycle';
    const q = delivery.gateway.quote({ distanceKm: distance, vehicleType: vehicle });
    deliveryFee = q.fee;
    carrierFee = q.fee;
  }
  const platformFee = settings.computePlatformFee(rentalFee);
  // Risk-based deposit: a renter with a high trust score is offered a reduced
  // (discounted) security deposit. The owner is still protected — the full tier
  // deposit balance is shown in the ledger of record.
  const disc = trust.depositDiscount(req.user, l.security_deposit);
  const effectiveDeposit = disc.effective_deposit;
  const depositDiscountPct = disc.discount_pct;
  const total = rentalFee + deliveryFee + effectiveDeposit + platformFee;
  const amountDueOwner = rentalFee - platformFee + deliveryFee;

  // Public-place handover: renter proposes a public meeting point. Mutually
  // confirmed in-app before the item is handed over. For Lalamove, this agreed
  // public place becomes the drop-off (renter's private address is never shown
  // to the owner; the carrier gets exact coordinates only after confirmation).
  const wantsPublicPlace = pickup_option === 'public_place';
  const effectivePickup = wantsPublicPlace ? 'public_place' : (pickup_option || (method === 'lalamove' ? 'lalamove' : 'pickup'));
  const meetingName = wantsPublicPlace ? (meeting_point_name || '').trim() : '';
  if (wantsPublicPlace && !meetingName) {
    return res.status(400).json({ error: 'Please select or name the agreed public meeting place.' });
  }
  const meetingAddr = wantsPublicPlace ? ((meeting_point_address || '').trim() || meetingName) : '';
  // For Lalamove drop-off: prefer the agreed public place, else the renter's
  // directly-entered dropoff (which should be a public place / verified address).
  const effectiveDropoff = method === 'lalamove'
    ? (wantsPublicPlace ? `${meetingName}${meetingAddr ? ' — ' + meetingAddr : ''}` : (dropoff_address || '').trim())
    : '';

  // Simple availability check (no overlapping active/pending bookings)
  const overlap = db.prepare(
    `SELECT id FROM bookings WHERE listing_id=? AND status IN ('pending','approved','active') AND start_date < ? AND end_date > ?`
  ).get(l.id, end, start);
  if (overlap) return res.status(400).json({ error: 'The item is already booked for those dates' });

  // ---- GATE 4: mandatory in-app escrow ----
  // Renter must pay the FULL amount (rental + deposit + platform fee) into RentHub's
  // escrow through their wallet BEFORE the booking can proceed. This keeps the
  // transaction inside the app so RentHub revenue is always collected.
  const balance = ledger.getUserBalance(req.user.id);
  if (balance < total) {
    return res.status(402).json({
      error: 'Insufficient wallet balance.',
      code: 'insufficient_funds',
      required: total,
      balance,
    });
  }

  const ref = genBookingRef();
  const now = Date.now();
  const info = db.prepare(
    `INSERT INTO bookings (booking_ref, renter_id, owner_id, listing_id, start_date, end_date, rental_days, rental_fee,
       security_deposit, delivery_fee, delivery_requested, pickup_option, platform_fee, total_charged, amount_due_owner,
       delivery_method, delivery_distance_km, delivery_vehicle_type, dropoff_address, lalamove_fee,
       status, escrow_payment, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(ref, req.user.id, l.owner_id, l.id, start, end, days, rentalFee, effectiveDeposit, deliveryFee,
    method === 'lalamove' ? 1 : 0, effectivePickup, platformFee, total, amountDueOwner,
    method, distance, vehicle, effectiveDropoff, carrierFee,
    'pending', 1, now, now);

  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(info.lastInsertRowid);

  // Persist the proposed public meeting place (renter-confirmed on their side;
  // owner must confirm separately before handover).
  if (wantsPublicPlace) {
    db.prepare(
      'INSERT INTO meeting_points (booking_id, point_name, point_address, latitude, longitude, proposed_by, renter_confirmed, owner_confirmed, created_at, updated_at) VALUES (?,?,?,?,?,?,1,0,?,?)'
    ).run(b.id, meetingName, meetingAddr,
      meeting_point_lat != null ? parseFloat(meeting_point_lat) : null,
      meeting_point_lng != null ? parseFloat(meeting_point_lng) : null,
      req.user.id, now, now);
  }

  // Create security deposit record
  if (effectiveDeposit > 0) {
    db.prepare('INSERT INTO security_deposits (booking_id, renter_id, owner_id, amount, status, deduction) VALUES (?,?,?,?,?,?)').run(
      b.id, req.user.id, l.owner_id, effectiveDeposit, 'held', 0
    );
  }

  // Move funds from renter wallet into escrow (ledger, server-side)
  ledger.addEntry({ bookingId: b.id, userId: req.user.id, type: 'rental_escrow', amount: -(rentalFee + deliveryFee + platformFee), meta: { listing_id: l.id, ref } });
  if (effectiveDeposit > 0) {
    ledger.addEntry({ bookingId: b.id, userId: req.user.id, type: 'deposit_escrow', amount: -effectiveDeposit, meta: { ref, full_deposit: l.security_deposit, discount_pct: depositDiscountPct } });
  }

  // Create payment records (escrowed)
  const rentalPayment = createPayment({
    userId: req.user.id, bookingId: b.id, type: 'rental', grossAmount: rentalFee + deliveryFee, platformFee,
    method: 'wallet', meta: { listing_id: l.id, escrow: true, ref },
  });
  const depositPayment = effectiveDeposit > 0 ? createPayment({
    userId: req.user.id, bookingId: b.id, type: 'deposit', grossAmount: effectiveDeposit, platformFee: 0,
    method: 'wallet', meta: { escrow: true, ref, full_deposit: l.security_deposit, discount_pct: depositDiscountPct },
  }) : null;

  (async () => {
    await executeCharge(rentalPayment);
    if (depositPayment) await executeCharge(depositPayment);
  })();

  notify(l.owner_id, 'new_booking', 'New booking request', `${req.user.full_name} requested "${l.title}" (${b.booking_ref})`, `/bookings`);
  notify(req.user.id, 'booking_submitted', 'Booking submitted', `Your request for "${l.title}" is pending owner approval. Funds are held in escrow.`, `/booking/${b.id}`);

  res.json({ booking: b, ref, escrowed: total });
});

// ---- My bookings (renter or owner) ----
router.get('/mine/:side', requireAuth, (req, res) => {
  const side = req.params.side; // 'renter' | 'owner' | 'all'
  let rows;
  if (side === 'renter') rows = db.prepare('SELECT * FROM bookings WHERE renter_id=? ORDER BY created_at DESC').all(req.user.id);
  else if (side === 'owner') rows = db.prepare('SELECT * FROM bookings WHERE owner_id=? ORDER BY created_at DESC').all(req.user.id);
  else rows = db.prepare('SELECT * FROM bookings WHERE renter_id=? OR owner_id=? ORDER BY created_at DESC').all(req.user.id, req.user.id);
  const out = rows.map(bookingFull);
  res.json(out);
});

function bookingFull(b) {
  const listing = b.listing_id ? db.prepare('SELECT * FROM listings WHERE id=?').get(b.listing_id) : null;
  const renter = db.prepare('SELECT * FROM users WHERE id=?').get(b.renter_id);
  const owner = db.prepare('SELECT * FROM users WHERE id=?').get(b.owner_id);
  const agreement = db.prepare('SELECT * FROM rental_agreements WHERE booking_id=?').get(b.id);
  const deposit = db.prepare('SELECT * FROM security_deposits WHERE booking_id=?').get(b.id);
  const condition = db.prepare('SELECT * FROM condition_records WHERE booking_id=? ORDER BY id').all(b.id);
  const dispute = db.prepare('SELECT * FROM disputes WHERE booking_id=?').get(b.id);
  const payment = db.prepare('SELECT * FROM payments WHERE booking_id=?').all(b.id);
  const deliveryRequests = db.prepare('SELECT * FROM delivery_requests WHERE booking_id=? ORDER BY id').all(b.id);
  const meetingPoints = db.prepare('SELECT * FROM meeting_points WHERE booking_id=? ORDER BY id').all(b.id);
  return {
    ...b,
    delivery_requests: deliveryRequests,
    meeting_points: meetingPoints,
    listing: listing ? {
      id: listing.id, title: listing.title, price_per_day: listing.price_per_day,
      security_deposit: listing.security_deposit, images: db.prepare('SELECT url FROM listing_images WHERE listing_id=?').all(listing.id).map(i => i.url),
    } : null,
    renter: publicUser(renter),
    owner: publicUser(owner),
    agreement,
    deposit,
    condition,
    dispute,
    payments: payment,
  };
}

router.get('/:id', requireAuth, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.renter_id !== req.user.id && b.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(bookingFull(b));
});

// ---- Owner approves ----
router.post('/:id/approve', requireAuth, (req, res) => {
  const b = getInvolved(req);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can approve' });
  if (b.status !== 'pending') return res.status(400).json({ error: 'Booking is not pending' });
  // Require the renter's escrowed payment to have been captured before approving.
  const escrowPaid = db.prepare("SELECT * FROM payments WHERE booking_id=? AND type='rental' AND status='succeeded'").get(b.id);
  if (!escrowPaid) return res.status(400).json({ error: 'Renter payment has not cleared yet. Try again in a moment.' });
  db.prepare('UPDATE bookings SET status=?, updated_at=? WHERE id=?').run('approved', Date.now(), b.id);

  // Lalamove delivery: dispatch order is triggered ONLY once the transaction is
  // paid and approved — a driver can never be sent before payment clears.
  if (b.delivery_method === 'lalamove') {
    const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(b.listing_id);
    // Pickup = the OWNER's verified location (not the listing text address), so
    // the carrier collects from a confirmed, verifiable place.
    const owner = db.prepare('SELECT * FROM users WHERE id=?').get(b.owner_id);
    const originParts = [owner && owner.address, owner && owner.barangay, owner && owner.city, owner && owner.province]
      .filter(Boolean).join(', ') || `${listing.location_barangay || ''}, ${listing.location_city || ''}`.replace(/^, /, '').replace(/, ,/g, ',');
    // Drop-off = the renter's agreed public place (meeting point) or the renter's
    // entered dropoff. Only the DEPARTIES see a general location until confirmed;
    // the carrier gets exact coordinates separately.
    const mp = db.prepare('SELECT * FROM meeting_points WHERE booking_id=? ORDER BY id').get(b.id);
    const dropoffAddr = b.dropoff_address || listing.location_city;
    const order = delivery.gateway.createDeliveryOrder({
      bookingRef: b.booking_ref,
      phase: 'dispatch',
      origin: originParts,
      dropoff: dropoffAddr,
      distanceKm: b.delivery_distance_km,
      vehicleType: b.delivery_vehicle_type,
      fee: b.lalamove_fee,
    });
    db.prepare(
      `INSERT INTO delivery_requests (booking_id, phase, provider, provider_order_id, status, vehicle_type, distance_km,
         fee, origin_address, dropoff_address, dropoff_lat, dropoff_lng, tracking_url, driver_name, driver_phone, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(b.id, 'dispatch', order.provider || 'sandbox', order.providerOrderId, order.status,
      b.delivery_vehicle_type || 'motorcycle', b.delivery_distance_km, b.lalamove_fee,
      originParts, dropoffAddr,
      mp && mp.latitude != null ? mp.latitude : null,
      mp && mp.longitude != null ? mp.longitude : null,
      order.trackingUrl, order.driverName, order.driverPhone, Date.now(), Date.now());
    notify(b.renter_id, 'delivery_dispatch', 'Driver assigned', `A Lalamove driver is on the way to pick up your item. Track it in-app.`, `/booking/${b.id}`);
  }

  notify(b.renter_id, 'booking_approved', 'Booking approved', `Your booking for "${b.listing?.title || ''}" was approved`, `/booking/${b.id}`);
  const updated = db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id);
  res.json(bookingFull(updated));
});

// ---- Renter schedules the return delivery via Lalamove (active booking) ----
router.post('/:id/delivery/return', requireAuth, (req, res) => {
  const b = getInvolved(req);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.renter_id !== req.user.id) return res.status(403).json({ error: 'Only the renter can schedule the return' });
  if (b.status !== 'active') return res.status(400).json({ error: 'The rental must be active to schedule a return' });
  if (b.delivery_method !== 'lalamove') return res.status(400).json({ error: 'This booking is not a Lalamove delivery' });
  const existing = db.prepare("SELECT id FROM delivery_requests WHERE booking_id=? AND phase='return'").get(b.id);
  if (existing) return res.status(400).json({ error: 'Return delivery already scheduled' });
  const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(b.listing_id);
  const origin = b.dropoff_address || listing.location_city;
  const dropoff = `${listing.location_barangay || ''}, ${listing.location_city || ''}, ${listing.location_province || ''}`.replace(/, ,/g, ',').replace(/^, /, '');
  const order = delivery.gateway.createDeliveryOrder({
    bookingRef: b.booking_ref, phase: 'return', origin, dropoff,
    distanceKm: b.delivery_distance_km, vehicleType: b.delivery_vehicle_type, fee: b.lalamove_fee,
  });
  db.prepare(
    `INSERT INTO delivery_requests (booking_id, phase, provider, provider_order_id, status, vehicle_type, distance_km,
       fee, origin_address, dropoff_address, tracking_url, driver_name, driver_phone, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(b.id, 'return', 'sandbox', order.providerOrderId, order.status,
    b.delivery_vehicle_type || 'motorcycle', b.delivery_distance_km, b.lalamove_fee,
    origin, dropoff, order.trackingUrl, order.driverName, order.driverPhone, Date.now(), Date.now());
  notify(b.owner_id, 'delivery_return', 'Return scheduled', 'A Lalamove driver will pick up the returned item.', `/booking/${b.id}`);
  res.json(bookingFull(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id)));
});

// ---- Update a delivery request's tracking status (both parties, per phase) ----
router.post('/:id/delivery/:phase/status', requireAuth, (req, res) => {
  const b = getInvolved(req);
  if (!b) return res.status(404).json({ error: 'Not found' });
  const phase = req.params.phase; // dispatch | return
  const dr = db.prepare('SELECT * FROM delivery_requests WHERE booking_id=? AND phase=?').get(b.id, phase);
  if (!dr) return res.status(404).json({ error: 'No delivery request for this phase' });
  const { status, proof_photo, proof_signature } = req.body || {};
  const allowed = ['accepted', 'pickup_ready', 'in_transit', 'delivered', 'cancelled', 'failed'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  // Proof of delivery: a photo and/or signature is captured when an item is
  // handed over/received, so delivery completion is evidenced, not just claimed.
  db.prepare('UPDATE delivery_requests SET status=?, proof_photo=?, proof_signature=?, updated_at=? WHERE id=?')
    .run(status, proof_photo || dr.proof_photo, proof_signature || dr.proof_signature, Date.now(), dr.id);
  res.json({ ok: true, delivery_request: db.prepare('SELECT * FROM delivery_requests WHERE id=?').get(dr.id) });
});

// ---- Mutually confirm the agreed public meeting place (renter + owner) ----
// The item is only considered handed over once BOTH parties electronically
// confirm the chosen public place for pickup/delivery.
router.post('/:id/meeting/confirm', requireAuth, (req, res) => {
  const b = getInvolved(req);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.pickup_option !== 'public_place') return res.status(400).json({ error: 'This booking does not use a public meeting place.' });
  const mp = db.prepare('SELECT * FROM meeting_points WHERE booking_id=? ORDER BY id').get(b.id);
  if (!mp) return res.status(404).json({ error: 'No meeting point proposed for this booking' });
  const isRenter = b.renter_id === req.user.id;
  const isOwner = b.owner_id === req.user.id;
  if (!isRenter && !isOwner) return res.status(403).json({ error: 'Forbidden' });
  const fields = isRenter
    ? { col: 'renter_confirmed', by: mp.renter_confirmed }
    : { col: 'owner_confirmed', by: mp.owner_confirmed };
  if (fields.by) return res.status(400).json({ error: 'You already confirmed this meeting place.' });
  const handoverAt = (isRenter && mp.owner_confirmed) || (isOwner && mp.renter_confirmed) ? Date.now() : mp.handover_confirmed_at;
  db.prepare(`UPDATE meeting_points SET ${fields.col}=1, updated_at=?, handover_confirmed_at=? WHERE id=?`).run(Date.now(), handoverAt, mp.id);
  const other = isRenter && mp.owner_confirmed ? b.owner_id : (isOwner && mp.renter_confirmed ? b.renter_id : null);
  if (other) {
    notify(other, 'meeting_confirmed', 'Meeting place confirmed', 'Both parties confirmed the agreed public meeting place.', `/booking/${b.id}`);
  }
  res.json(bookingFull(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id)));
});

// ---- Owner rejects / renter cancels pending ----
router.post('/:id/reject', requireAuth, (req, res) => {
  const b = getInvolved(req);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (b.status !== 'pending') return res.status(400).json({ error: 'Booking is not pending' });
  db.prepare('UPDATE bookings SET status=?, cancellation_reason=?, updated_at=? WHERE id=?').run('rejected', req.body?.reason || 'Owner declined', Date.now(), b.id);
  notify(b.renter_id, 'booking_rejected', 'Booking declined', 'Your booking request was declined', `/booking/${b.id}`);
  res.json(bookingFull(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id)));
});

// ---- Sign rental agreement (both parties must sign) ----
router.post('/:id/sign-agreement', requireAuth, (req, res) => {
  const b = getInvolved(req);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'approved') return res.status(400).json({ error: 'Booking is not in approved state' });
  const isRenter = b.renter_id === req.user.id;
  const isOwner = b.owner_id === req.user.id;
  if (!isRenter && !isOwner) return res.status(403).json({ error: 'Forbidden' });

  const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(b.listing_id);
  let agreement = db.prepare('SELECT * FROM rental_agreements WHERE booking_id=?').get(b.id);
  if (!agreement) {
    const body = buildAgreement(b, listing);
    db.prepare('INSERT INTO rental_agreements (booking_id, listing_id, body, created_at) VALUES (?,?,?,?)').run(b.id, b.listing_id, body, Date.now());
    agreement = db.prepare('SELECT * FROM rental_agreements WHERE booking_id=?').get(b.id);
  }
  if (isRenter && !b.agreement_signed_renter) db.prepare('UPDATE bookings SET agreement_signed_renter=1 WHERE id=?').run(b.id);
  if (isOwner && !b.agreement_signed_owner) db.prepare('UPDATE bookings SET agreement_signed_owner=1 WHERE id=?').run(b.id);
  // Update agreement signatures
  const nb = db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id);
  db.prepare('UPDATE rental_agreements SET renter_signed_at = CASE WHEN ?=1 THEN ? ELSE renter_signed_at END, owner_signed_at = CASE WHEN ?=1 THEN ? ELSE owner_signed_at END WHERE id=?').run(
    nb.agreement_signed_renter ? 1 : 0, nb.agreement_signed_renter ? Date.now() : null,
    nb.agreement_signed_owner ? 1 : 0, nb.agreement_signed_owner ? Date.now() : null, agreement.id
  );
  // When both signed, activate
  if (nb.agreement_signed_renter && nb.agreement_signed_owner && nb.status === 'approved') {
    db.prepare('UPDATE bookings SET status=\'active\' WHERE id=?').run(b.id);
    notify(b.renter_id, 'rental_active', 'Rental started', 'Both parties signed. Rental is now active.', `/booking/${b.id}`);
    notify(b.owner_id, 'rental_active', 'Rental started', 'Both parties signed. Rental is now active.', `/booking/${b.id}`);
  }
  res.json(bookingFull(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id)));
});

function buildAgreement(b, listing) {
  return `RENTAL AGREEMENT
============================
Agreement Ref: ${b.booking_ref}
Item: ${listing.title}
Owner: user#${b.owner_id}
Renter: user#${b.renter_id}
Rental period: ${new Date(b.start_date).toLocaleDateString()} to ${new Date(b.end_date).toLocaleDateString()} (${b.rental_days} days)
Rental fee: P${b.rental_fee}
Security deposit: P${b.security_deposit}
Platform fee: P${b.platform_fee}
Delivery fee: P${b.delivery_fee}
Pickup option: ${b.pickup_option}
Condition: ${listing.condition || 'As shown'}
Accessories: ${listing.accessories || 'None listed'}
Cancellation policy: ${listing.cancellation_policy}
Rules: ${listing.rules || 'None'}

The renter agrees to return the item in the same condition, subject to normal wear and tear. The security deposit is refundable subject to the terms of the Damages & Losses policy. By accepting this agreement electronically, both parties agree to be bound by RentHub's Terms & Conditions, Rental Agreement, Cancellation, Refund and Damage & Loss Policies.

Both parties accept electronically.`;
}

// ---- Check-in / condition ----
router.post('/:id/condition', requireAuth, (req, res) => {
  const b = getInvolved(req);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'active' && b.status !== 'approved') return res.status(400).json({ error: 'Not in rentable state' });
  const { phase, photos, serial_number, accessories, damage_notes } = req.body || {};
  if (!phase || (phase !== 'checkin' && phase !== 'checkout')) return res.status(400).json({ error: 'Invalid phase' });
  const already = db.prepare('SELECT id FROM condition_records WHERE booking_id=? AND phase=?').get(b.id, phase);
  if (already) return res.status(400).json({ error: `Condition already recorded for ${phase}` });
  db.prepare('INSERT INTO condition_records (booking_id, phase, uploaded_by, photos, serial_number, accessories, damage_notes, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
    b.id, phase, req.user.id, JSON.stringify(photos || []), serial_number || '', accessories || '', damage_notes || '', Date.now()
  );
  if (phase === 'checkin') {
    db.prepare('UPDATE bookings SET checkin_confirmed=1 WHERE id=?').run(b.id);
  }
  res.json(bookingFull(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id)));
});

// ---- Owner completes the return; proposes optional deposit deduction ----
// A checkout (return) condition record with evidence is required so items can't
// be "silently returned". If a deposit deduction is proposed, funds are NOT
// released on the owner's word alone: the renter must accept, or it goes to dispute.
router.post('/:id/complete', requireAuth, async (req, res) => {
  const b = getInvolved(req);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can finalize the return' });
  if (b.status !== 'active') return res.status(400).json({ error: 'Rental is not active' });

  // For Lalamove returns, the carrier must have actually delivered the item back
  // (with proof) before funds can be released from escrow. This prevents escrow
  // release before the physical return is evidenced.
  if (b.delivery_method === 'lalamove') {
    const ret = db.prepare("SELECT * FROM delivery_requests WHERE booking_id=? AND phase='return'").get(b.id);
    if (!ret) return res.status(400).json({ error: 'Schedule the return delivery before finalizing.' });
    if (ret.status !== 'delivered') {
      return res.status(400).json({ error: 'Return must be marked delivered (with proof) before the deposit can be released.' });
    }
    if (!ret.proof_photo) {
      return res.status(400).json({ error: 'A proof-of-delivery photo is required before releasing funds.' });
    }
  }

  // Evidence required: both check-in and check-out condition records must exist.
  const checkins = db.prepare('SELECT id FROM condition_records WHERE booking_id=? AND phase=\'checkin\'').get(b.id);
  const checkouts = db.prepare('SELECT id FROM condition_records WHERE booking_id=? AND phase=\'checkout\'').get(b.id);
  if (!checkins) return res.status(400).json({ error: 'Check-in condition must be recorded before the rental can be finalized.' });
  if (!checkouts) return res.status(400).json({ error: 'Record the check-out (return) condition with photos before finalizing.' });

  const { lateFees, damageDeduction, reason } = req.body || {};
  const lateFee = parseInt(lateFees || '0', 10);
  const deduction = Math.max(0, parseInt(damageDeduction || '0', 10));
  db.prepare('UPDATE bookings SET checkout_confirmed=1, late_fee=? WHERE id=?').run(lateFee, b.id);

  if (deduction <= 0) {
    // Clean return: release everything immediately.
    const done = finalizeBooking(b, 0, '', lateFee);
    notify(b.renter_id, 'rental_completed', 'Rental completed', `${b.booking_ref} completed. Deposit fully released.`, `/booking/${b.id}`);
    notify(b.owner_id, 'rental_completed', 'Rental completed', `${b.booking_ref} completed. Funds credited to your wallet.`, `/booking/${b.id}`);
    return res.json(bookingFull(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id)));
  }

  // Owner proposes a deposit deduction -> goes to renter for acceptance (fairness).
  db.prepare('UPDATE bookings SET status=\'returned\', return_proposed_deduction=?, return_proposed_reason=?, return_proposed_by=?, return_completed_at=? WHERE id=?').run(
    Math.min(deduction, b.security_deposit), reason || 'Damage', req.user.id, Date.now(), b.id
  );
  notify(b.renter_id, 'return_pending', 'Return pending review', `Owner reported a ${fmtPeso(Math.min(deduction, b.security_deposit))} deposit deduction. Review to accept or dispute.`, `/booking/${b.id}`);
  res.json(bookingFull(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id)));
});

// ---- Renter accepts or disputes the owner's proposed deposit deduction ----
router.post('/:id/resolve-return', requireAuth, (req, res) => {
  const b = getInvolved(req);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'returned') return res.status(400).json({ error: 'Booking is not awaiting return resolution' });
  if (b.renter_id !== req.user.id) return res.status(403).json({ error: 'Only the renter can resolve this' });
  if (b.return_proposed_deduction < 0) return res.status(400).json({ error: 'No deduction proposed' });

  const { accept } = req.body || {};
  if (accept) {
    finalizeBooking(b, b.return_proposed_deduction, b.return_proposed_reason, b.late_fee || 0);
    notify(b.renter_id, 'deposit_released', 'Deposit released', `You accepted the deduction. Deposit released after ${fmtPeso(b.return_proposed_deduction)} deduction.`, `/booking/${b.id}`);
    notify(b.owner_id, 'rental_completed', 'Rental completed', `${b.booking_ref} completed. Funds credited to your wallet.`, `/booking/${b.id}`);
    return res.json(bookingFull(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id)));
  }

  // Renter disputes -> freeze funds for admin review.
  db.prepare('UPDATE bookings SET status=\'disputed\' WHERE id=?').run(b.id);
  const existing = db.prepare('SELECT id FROM disputes WHERE booking_id=?').get(b.id);
  if (!existing) {
    db.prepare('INSERT INTO disputes (booking_id, reporter_id, category, description, status, evidence, created_at) VALUES (?,?,?,?,?,?,?)').run(
      b.id, req.user.id, 'Deposit deduction', `Renter disputes the ${fmtPeso(b.return_proposed_deduction)} deposit deduction: ${b.return_proposed_reason || ''}`, 'open', JSON.stringify({ proposed_deduction: b.return_proposed_deduction }), Date.now()
    );
  }
  notify(b.owner_id, 'dispute_update', 'Dispute opened', 'The renter disputed the deposit deduction. Funds are frozen pending review.', `/booking/${b.id}`);
  res.json(bookingFull(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id)));
});

// ---- Finalize: move escrowed funds only after the return is agreed/settled ----
function finalizeBooking(b, depositDeduction, deductionReason, lateFee) {
  const now = Date.now();
  db.prepare('UPDATE bookings SET status=\'completed\', escrow_released=1, return_proposed_deduction=?, updated_at=? WHERE id=?')
    .run(depositDeduction, now, b.id);

  const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(b.listing_id);
  db.prepare('UPDATE listings SET rental_count=rental_count+1 WHERE id=?').run(b.listing_id);
  db.prepare('UPDATE users SET successful_rentals=successful_rentals+1 WHERE id=?').run(b.owner_id);
  db.prepare('UPDATE users SET successful_rentals=successful_rentals+1 WHERE id=?').run(b.renter_id);

  // Owner earning from rental (rental fee - platform fee + delivery fee)
  const split = ledger.computeBookingSplit(b.rental_fee, b.delivery_fee);
  ledger.addEntry({ bookingId: b.id, userId: b.owner_id, type: 'owner_earning', amount: split.ownerEarning, meta: { listing_id: b.listing_id } });
  if (lateFee > 0) {
    ledger.addEntry({ bookingId: b.id, userId: b.owner_id, type: 'penalty', amount: lateFee, meta: { kind: 'late_return' } });
  }

  // Deposit reconciliation
  const deposit = db.prepare('SELECT * FROM security_deposits WHERE booking_id=?').get(b.id);
  if (deposit) {
    const deduction = Math.min(Math.max(0, depositDeduction || 0), deposit.amount);
    const releaseAmount = deposit.amount - deduction;
    if (deduction > 0) {
      db.prepare('UPDATE security_deposits SET status=\'partially_deducted\', deduction=? WHERE id=?').run(deduction, deposit.id);
      ledger.addEntry({ bookingId: b.id, userId: b.owner_id, type: 'deposit_deduction', amount: deduction, meta: { reason: deductionReason || 'damage' } });
    } else {
      db.prepare('UPDATE security_deposits SET status=\'released\' WHERE id=?').run(deposit.id);
    }
    // release the remainder back to the renter's wallet
    ledger.addEntry({ bookingId: b.id, userId: b.renter_id, type: 'deposit', amount: releaseAmount, meta: { kind: 'release', deduction } });
    db.prepare('UPDATE security_deposits SET released_at=? WHERE id=?').run(now, deposit.id);
  }

  // Mark deposit payment released (the renter's original deposit payment is now settled)
  const depoPay = db.prepare('SELECT * FROM payments WHERE booking_id=? AND type=\'deposit\'').get(b.id);
  if (depoPay) db.prepare('UPDATE payments SET status=\'released\', updated_at=? WHERE id=?').run(now, depoPay.id);

  checkReferral(b.renter_id);
}

function fmtPeso(n) { return '₱' + Number(n || 0).toLocaleString('en-PH'); }

function checkReferral(renterId) {
  const renter = db.prepare('SELECT * FROM users WHERE id=?').get(renterId);
  if (!renter || !renter.referred_by_user_id) return;
  const reward = parseInt(settings.getSetting('referrer_reward', '50'), 10);
  const ref = db.prepare('SELECT * FROM referrals WHERE referred_id=?').get(renterId);
  if (ref && ref.status === 'pending') {
    db.prepare('UPDATE referrals SET status=\'rewarded\' WHERE id=?').run(ref.id);
    ledger.addEntry({ userId: renter.referred_by_user_id, type: 'referral', amount: reward, meta: { referred: renterId } });
    notify(renter.referred_by_user_id, 'referral_reward', 'Referral reward', `You earned P${reward} for a completed rental by your referral.`, `/wallet`);
  }
}

// ---- Cancel booking ----
router.post('/:id/cancel', requireAuth, (req, res) => {
  const b = getInvolved(req);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.renter_id !== req.user.id && b.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  if (['completed', 'cancelled', 'rejected'].includes(b.status)) return res.status(400).json({ error: 'Cannot cancel this booking' });
  const reason = req.body?.reason || '';
  db.prepare('UPDATE bookings SET status=\'cancelled\', cancellation_reason=?, cancelled_by=?, updated_at=? WHERE id=?').run(reason, req.user.id, Date.now(), b.id);
  db.prepare('UPDATE users SET cancelled_rentals=cancelled_rentals+1 WHERE id=?').run(req.user.id);

  // Refund logic based on cancellation policy & timing
  const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(b.listing_id);
  const hours = (b.start_date - Date.now()) / (60 * 60 * 1000);
  const freeH = parseInt(settings.getSetting('free_cancellation_hours', '48'), 10);
  const partialH = parseInt(settings.getSetting('partial_cancellation_hours', '24'), 10);
  let refundPct = 0;
  if (hours >= freeH) refundPct = 100;
  else if (hours >= partialH) refundPct = 50;

  const rentalPaid = b.rental_fee + b.delivery_fee;
  const refundAmount = Math.round((rentalPaid * refundPct) / 100);
  if (refundAmount > 0) {
    db.prepare('INSERT INTO refunds (booking_id, renter_id, amount, reason, status, created_at) VALUES (?,?,?,?,?,?)').run(
      b.id, b.renter_id, refundAmount, 'cancellation', 'succeeded', Date.now()
    );
    ledger.addEntry({ bookingId: b.id, userId: b.renter_id, type: 'refund', amount: refundAmount, meta: { reason: 'cancellation' } });
    const rp = db.prepare('SELECT * FROM payments WHERE booking_id=? AND type=\'rental\'').get(b.id);
    if (rp) db.prepare('UPDATE payments SET status=\'refunded\', updated_at=? WHERE id=?').run(Date.now(), rp.id);
  }
  // Deposit always released on cancellation
  const depo = db.prepare('SELECT * FROM security_deposits WHERE booking_id=?').get(b.id);
  if (depo && depo.status !== 'released') {
    ledger.addEntry({ bookingId: b.id, userId: b.renter_id, type: 'deposit', amount: depo.amount, meta: { kind: 'cancel_release' } });
    db.prepare('UPDATE security_deposits SET status=\'released\', released_at=? WHERE id=?').run(Date.now(), depo.id);
  }
  const other = b.renter_id === req.user.id ? b.owner_id : b.renter_id;
  notify(other, 'booking_cancelled', 'Booking cancelled', `${b.booking_ref} was cancelled.`, `/booking/${b.id}`);
  notify(req.user.id, 'booking_cancelled', 'Booking cancelled', `Your booking was cancelled.`, `/booking/${b.id}`);

  res.json(bookingFull(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id)));
});

function getInvolved(req) {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);
  if (!b) return null;
  return b;
}

// Public to admin so disputed deposits can be settled and escrow released fairly.
module.exports = router;
module.exports.finalizeBooking = finalizeBooking;
