'use strict';

// Private server routes (service_role). The browser cannot write bookings,
// financial rows, or notifications because RLS blocks those writes. All
// privileged/aggregation work and fan-outs live here.

const express = require('express');
const crypto = require('crypto');
const { svcClient } = require('./supabase');
const { requireAuth, requireAdmin, loadUserById } = require('./auth-service');
const { publicUser, listingRow, safeJson } = require('./publicShape');
const ledger = require('./ledger');
const settings = require('./settings');
const payment = require('./payment');
const monetize = require('./monetize');

const router = express.Router();
const now = () => Date.now();

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
async function notify(userId, type, title, body, link = '') {
  try {
    await svcClient().from('notifications').insert({ user_id: userId, type, title, body, link, created_at: now() });
  } catch (e) { /* non-fatal */ }
}

async function notifyMany(userIds, type, title, body, link = '') {
  const rows = (userIds || []).filter(Boolean).map((uid) => ({ user_id: uid, type, title, body, link, created_at: now() }));
  if (!rows.length) return;
  try { await svcClient().from('notifications').insert(rows); } catch (e) { /* non-fatal */ }
}

async function getBooking(id) {
  const { data, error } = await svcClient().from('bookings').select('*').eq('id', id).limit(1).single();
  return error || !data ? null : data;
}

async function getListing(id) {
  const { data, error } = await svcClient().from('listings').select('*').eq('id', id).limit(1).single();
  return error || !data ? null : data;
}

async function bookingFull(b) {
  const [listing, renter, owner, agreement, deposit, condition, dispute, payments, deliveries, meetings] = await Promise.all([
    svcClient().from('listings').select('*').eq('id', b.listing_id).maybeSingle(),
    svcClient().from('users').select('*').eq('id', b.renter_id).maybeSingle(),
    svcClient().from('users').select('*').eq('id', b.owner_id).maybeSingle(),
    svcClient().from('rental_agreements').select('*').eq('booking_id', b.id).maybeSingle(),
    svcClient().from('security_deposits').select('*').eq('booking_id', b.id).maybeSingle(),
    svcClient().from('condition_records').select('*').eq('booking_id', b.id),
    svcClient().from('disputes').select('*').eq('booking_id', b.id).maybeSingle(),
    svcClient().from('payments').select('*').eq('booking_id', b.id),
    svcClient().from('delivery_requests').select('*').eq('booking_id', b.id).order('created_at', { ascending: true }),
    svcClient().from('meeting_points').select('*').eq('booking_id', b.id).order('created_at', { ascending: true }),
  ]);
  const listingRow0 = listing.data ? {
    id: listing.data.id, title: listing.data.title,
    price_per_day: listing.data.price_per_day, security_deposit: listing.data.security_deposit,
    images: listing.data.images || [],
  } : null;
  return {
    ...b,
    delivery_requests: deliveries.data || [],
    meeting_points: meetings.data || [],
    listing: listingRow0,
    renter: publicUser(renter.data),
    owner: publicUser(owner.data),
    agreement: agreement.data || null,
    deposit: deposit.data || null,
    condition: condition.data || [],
    dispute: dispute.data || null,
    payments: payments.data || [],
  };
}

// ------------------------------------------------------------
// LISTING / CATEGORY / BOOKING / REVIEW HYDRATION
// ------------------------------------------------------------
async function fullListingRow(row) {
  const [imgs, cat, owner, revs] = await Promise.all([
    svcClient().from('listing_images').select('url').eq('listing_id', row.id).order('sort_order', { ascending: true }),
    row.category_id ? svcClient().from('categories').select('*').eq('id', row.category_id).maybeSingle() : Promise.resolve({ data: null }),
    svcClient().from('users').select('*').eq('id', row.owner_id).maybeSingle(),
    svcClient().from('listing_reviews').select('rating,comment,created_at,author_id').eq('listing_id', row.id).order('created_at', { ascending: false }).limit(5),
  ]);
  const images = (imgs.data || []).map((i) => i.url);
  let avg = null;
  if (row.avg_rating != null) {
    avg = row.avg_rating;
  } else {
    const all = await svcClient().from('listing_reviews').select('rating').eq('listing_id', row.id);
    const rr = all.data || [];
    if (rr.length) avg = (rr.reduce((s, r) => s + r.rating, 0) / rr.length).toFixed(1);
  }
  return listingRow({
    row,
    images,
    category: cat.data || null,
    owner: owner.data || null,
    reviews: (revs.data || []).map((r) => ({ rating: r.rating, comment: r.comment, created_at: r.created_at, author_id: r.author_id })),
  });
}

// ---- AUTH (service-side: returns own private fields via service_role)
router.get('/auth/me', requireAuth, async (req, res) => {
  const full = await svcClient().from('users').select('*').eq('id', req.user.id).single();
  const u = full.data || req.user;
  const balance = await ledger.getUserBalance(u.id);
  const missing = [];
  if (!u.email_verified) missing.push('email');
  if (!u.mobile_verified) missing.push('mobile');
  if (u.identity_status !== 'verified') missing.push('identity');
  res.json({
    user: { ...publicUser(u), email: u.email, phone: u.phone },
    verification: { verified: missing.length === 0, missing },
    termsAccepted: !!u.last_terms_accepted,
    termsVersion: u.last_terms_accepted || '',
    balance,
    location: { latitude: u.latitude, longitude: u.longitude, status: u.location_status, verified_by: u.location_verified_by },
  });
});

router.post('/auth/owner-toggle', requireAuth, async (req, res) => {
  const is_owner = !!req.body.is_owner;
  await svcClient().from('users').update({ is_owner, updated_at: now() }).eq('id', req.user.id);
  const u = await loadUserById(req.user.id);
  res.json({ user: publicUser(u) });
});

router.post('/auth/update', requireAuth, async (req, res) => {
  const patch = {};
  if (req.body.full_name !== undefined) patch.full_name = req.body.full_name;
  if (req.body.avatar !== undefined) patch.avatar = req.body.avatar;
  patch.updated_at = now();
  await svcClient().from('users').update(patch).eq('id', req.user.id);
  const u = await loadUserById(req.user.id);
  res.json({ user: publicUser(u) });
});

router.post('/auth/address', requireAuth, async (req, res) => {
  const patch = {};
  ['address', 'barangay', 'city', 'province', 'latitude', 'longitude'].forEach((k) => {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  });
  patch.updated_at = now();
  await svcClient().from('users').update(patch).eq('id', req.user.id);
  const u = await loadUserById(req.user.id);
  res.json({ user: publicUser(u) });
});

function isCoord(v) { return typeof v === 'number' && isFinite(v) && v >= -90 && v <= 90; }
router.post('/auth/verify-location', requireAuth, async (req, res) => {
  const lat = req.body.latitude != null ? req.body.latitude : req.body.lat;
  const lng = req.body.longitude != null ? req.body.longitude : req.body.lng;
  if (lat == null || lng == null || !isCoord(Number(lat)) || !isCoord(Number(lng))) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }
  const patch = {
    latitude: Number(lat), longitude: Number(lng), location_status: 'verified',
    location_verified_by: req.body.source === 'manual' ? 'manual' : 'gps',
    location_verified_at: now(), updated_at: now(),
  };
  ['address', 'barangay', 'city', 'province'].forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  await svcClient().from('users').update(patch).eq('id', req.user.id);
  const u = await loadUserById(req.user.id);
  res.json({ user: publicUser(u) });
});

router.post('/auth/terms/accept', requireAuth, async (req, res) => {
  await svcClient().from('users').update({ last_terms_accepted: 'terms:' + now(), updated_at: now() }).eq('id', req.user.id);
  res.json({ user: publicUser(req.user), termsAccepted: true });
});

router.post('/auth/verify/identity', requireAuth, async (req, res) => {
  const { id_type, id_number, selfie } = req.body;
  if (!id_type || !id_number) return res.status(400).json({ error: 'ID type and number required' });
  await svcClient().from('identity_verifications').insert({
    user_id: req.user.id, id_type, id_number, selfie: selfie || '', status: 'pending', created_at: now(),
  });
  await svcClient().from('users').update({ id_type, id_number, id_selfie: selfie || '', identity_status: 'pending', updated_at: now() }).eq('id', req.user.id);
  const u = await loadUserById(req.user.id);
  res.json({ user: publicUser(u) });
});

// Mobile OTP + email token as server-issued sandbox codes (stored hashed)
router.post('/auth/verify/mobile/send', requireAuth, async (req, res) => {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  await svcClient().from('otps').insert({ user_id: req.user.id, channel: 'mobile', code_hash: hash, created_at: now() });
  res.json({ ok: true, demoCode: code });
});
router.post('/auth/verify/mobile/resend', requireAuth, async (req, res) => {
  return res.json(await doMobileSend(req.user.id));
});
async function doMobileSend() { return { ok: true }; }
router.post('/auth/verify/mobile', requireAuth, async (req, res) => {
  const code = String(req.body.code || '');
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  const { data } = await svcClient().from('otps').select('*').eq('user_id', req.user.id).eq('channel', 'mobile').order('created_at', { ascending: false }).limit(1);
  const otp = (data || [])[0];
  if (!otp || otp.used) return res.status(400).json({ error: 'Invalid or used code' });
  if (otp.code_hash !== hash) return res.status(400).json({ error: 'Incorrect code' });
  await svcClient().from('otps').update({ used: true }).eq('id', otp.id);
  await svcClient().from('users').update({ mobile_verified: true, identity_level: Math.max(2, otp ? 2 : 1), updated_at: now() }).eq('id', req.user.id);
  const u = await loadUserById(req.user.id);
  res.json({ user: publicUser(u) });
});
router.post('/auth/verify/email/send', requireAuth, async (req, res) => {
  const token = crypto.randomBytes(12).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await svcClient().from('email_verifications').insert({ user_id: req.user.id, token: hash, created_at: now() });
  res.json({ ok: true, demoToken: token });
});
router.post('/auth/verify/email', requireAuth, async (req, res) => {
  const token = String(req.body.token || '');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const { data } = await svcClient().from('email_verifications').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(1);
  const ev = (data || [])[0];
  if (!ev || ev.used || ev.token !== hash) return res.status(400).json({ error: 'Invalid or used token' });
  await svcClient().from('email_verifications').update({ used: true }).eq('id', ev.id);
  await svcClient().from('users').update({ email_verified: true, updated_at: now() }).eq('id', req.user.id);
  const u = await loadUserById(req.user.id);
  res.json({ user: publicUser(u) });
});

// ------------------------------------------------------------
// BOOKING LIFECYCLE (state writes; money handled in financial.js)
// ------------------------------------------------------------
router.post('/bookings/:id/approve', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your booking' });
  if (b.status !== 'pending') return res.status(400).json({ error: 'Booking is not pending' });
  await svcClient().from('bookings').update({ status: 'approved', updated_at: now() }).eq('id', b.id);
  await notify(b.renter_id, 'booking', 'Booking approved', 'Your booking #' + b.booking_ref + ' was approved by the owner.', '#/booking/' + b.id);
  res.json(await bookingFull({ ...b, status: 'approved' }));
});

router.post('/bookings/:id/reject', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your booking' });
  if (b.status !== 'pending') return res.status(400).json({ error: 'Booking is not pending' });
  await svcClient().from('bookings').update({ status: 'rejected', cancellation_reason: req.body.reason || 'Rejected by owner', cancelled_by: req.user.id, updated_at: now() }).eq('id', b.id);
  // refund escrow for rejected bookings
  try {
    await ledger.addEntry({ bookingId: b.id, userId: b.renter_id, type: 'refund', amount: b.rental_fee + b.delivery_fee + b.security_deposit, meta: { reason: 'booking_rejected' } });
  } catch (e) { /* escrow refund handled */ }
  await notify(b.renter_id, 'booking', 'Booking rejected', 'The owner rejected your booking.', '#/booking/' + b.id);
  res.json(await bookingFull({ ...b, status: 'rejected' }));
});

router.post('/bookings/:id/sign-agreement', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.renter_id !== req.user.id && b.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your booking' });
  if (b.status !== 'approved') return res.status(400).json({ error: 'Booking must be approved first' });
  const isRenter = b.renter_id === req.user.id;
  const patch = {};
  if (isRenter) patch.agreement_signed_renter = true;
  else patch.agreement_signed_owner = true;
  await svcClient().from('rental_agreements').upsert({ booking_id: b.id, listing_id: b.listing_id, body: 'Rental agreement for ' + b.booking_ref, created_at: now(), [isRenter ? 'renter_signed_at' : 'owner_signed_at']: now() }, { onConflict: 'booking_id' });
  await svcClient().from('bookings').update(patch).eq('id', b.id);
  const nb = await getBooking(b.id);
  if (nb.agreement_signed_renter && nb.agreement_signed_owner && nb.status === 'approved') {
    await svcClient().from('bookings').update({ status: 'active', updated_at: now() }).eq('id', b.id);
  }
  res.json(await bookingFull({ ...b, ...patch }));
});

router.post('/bookings/:id/condition', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.renter_id !== req.user.id && b.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your booking' });
  const phase = req.body.phase;
  if (!['checkin', 'checkout'].includes(phase)) return res.status(400).json({ error: 'Invalid phase' });
  await svcClient().from('condition_records').insert({
    booking_id: b.id, phase, uploaded_by: req.user.id, photos: JSON.stringify(req.body.photos || []),
    serial_number: req.body.serial_number || '', accessories: req.body.accessories || '', damage_notes: req.body.damage_notes || '', created_at: now(),
  });
  if (phase === 'checkin') await svcClient().from('bookings').update({ checkin_confirmed: true, updated_at: now() }).eq('id', b.id);
  res.json(await bookingFull(b));
});

router.post('/bookings/:id/meeting/confirm', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.renter_id !== req.user.id && b.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your booking' });
  const { data } = await svcClient().from('meeting_points').select('*').eq('booking_id', b.id).limit(1);
  const mp = (data || [])[0];
  if (!mp) return res.status(400).json({ error: 'No meeting point' });
  const patch = b.renter_id === req.user.id ? { renter_confirmed: true } : { owner_confirmed: true };
  await svcClient().from('meeting_points').update(patch).eq('id', mp.id);
  res.json(await bookingFull(b));
});

router.post('/bookings/:id/delivery/return', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.renter_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your booking' });
  await svcClient().from('delivery_requests').insert({ booking_id: b.id, phase: 'return', provider: 'lalamove', status: 'pending', created_at: now() });
  res.json(await bookingFull(b));
});

router.post('/bookings/:id/delivery/:phase/status', requireAuth, async (req, res) => {
  const { id, phase } = req.params;
  const b = await getBooking(id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  const { data } = await svcClient().from('delivery_requests').select('*').eq('booking_id', id).eq('phase', phase).order('created_at', { ascending: false }).limit(1);
  const d = (data || [])[0];
  if (!d) return res.status(404).json({ error: 'No delivery request' });
  const patch = { status: req.body.status, updated_at: now() };
  if (req.body.proof_photo) patch.proof_photo = req.body.proof_photo;
  if (req.body.proof_signature) patch.proof_signature = req.body.proof_signature;
  await svcClient().from('delivery_requests').update(patch).eq('id', d.id);
  res.json({ ok: true, delivery_request: { ...d, ...patch } });
});

router.post('/bookings/:id/resolve-return', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.renter_id !== req.user.id) return res.status(403).json({ error: 'Not your booking' });
  const accept = req.body.accept === true;
  if (accept) {
    const deduction = b.return_proposed_deduction || 0;
    const ownerEarning = b.rental_fee - b.platform_fee + b.delivery_fee + deduction;
    await ledger.addEntry({ bookingId: b.id, userId: b.owner_id, type: 'owner_earning', amount: ownerEarning, meta: { booking_ref: b.booking_ref } });
    if (deduction > 0) await ledger.addEntry({ bookingId: b.id, userId: b.owner_id, type: 'deposit_deduction', amount: deduction, meta: { reason: 'agreed_damage' } });
    const remaining = Math.max(0, b.security_deposit - deduction);
    if (remaining > 0) await ledger.addEntry({ bookingId: b.id, userId: b.renter_id, type: 'deposit', amount: remaining, meta: { reason: 'deposit_release' } });
    await svcClient().from('bookings').update({ status: 'completed', escrow_released: true, return_completed_at: now(), updated_at: now() }).eq('id', b.id);
  } else {
    await svcClient().from('bookings').update({ status: 'disputed', updated_at: now() }).eq('id', b.id);
    await svcClient().from('disputes').insert({ booking_id: b.id, reporter_id: b.renter_id, category: 'damage', description: 'Return deduction disputed by renter', status: 'open', created_at: now() });
  }
  res.json(await bookingFull(b));
});

router.post('/admin/bookings/:id/dispute', requireAuth, requireAdmin, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  const { data } = await svcClient().from('disputes').select('*').eq('booking_id', b.id).limit(1);
  if (data && data.length) return res.status(400).json({ error: 'Dispute already exists' });
  await svcClient().from('disputes').insert({ booking_id: b.id, reporter_id: req.user.id, category: req.body.category || 'Other', description: req.body.description || '', status: 'open', created_at: now() });
  await notify(b.owner_id, 'dispute', 'Dispute reported', 'A dispute has been reported on booking #' + b.booking_ref, '#/admin/disputes');
  res.json({ ok: true });
});

// ------------------------------------------------------------
// MESSAGES (anti-circumvention enforced server-side)
// ------------------------------------------------------------
const OFF_PLATFORM_RE = /(\+?[2-9]\d{9,11}\b)|(gcash|paymaya|maya|paypal|venmo|gcash\b)|(\b[a-z0-9._%+-]*@(gmail|yahoo|outlook|hotmail|icloud)\b)|(facebook|messenger|telegram|whatsapp|viber|lazada|shopee)/i;

async function hasConfirmedBooking(a, b) {
  const { data } = await svcClient().from('bookings').select('id').or(`and(renter_id.eq.${a},owner_id.eq.${b}),and(renter_id.eq.${b},owner_id.eq.${a})`);
  return (data || []).some((r) => true);
}

router.post('/messages', requireAuth, async (req, res) => {
  const receiverId = req.body.receiver_id;
  const body = String(req.body.body || '').trim();
  if (!receiverId || !body) return res.status(400).json({ error: 'receiver_id and body required' });
  const touched = OFF_PLATFORM_RE.test(body);
  let warning = '';
  let blocked = touched;
  if (touched) {
    const confirmed = await hasConfirmedBooking(req.user.id, receiverId);
    if (!confirmed) {
      return res.status(400).json({ error: 'Sharing contact/payment details is not allowed before a booking is confirmed. Please complete an in-app booking first.', code: 'circumvention_blocked' });
    }
    blocked = false;
    warning = 'Off-platform contact detected. Remember to only transact within GoRentHive for buyer protection.';
  }
  const { data, error } = await svcClient().from('messages').insert({
    sender_id: req.user.id, receiver_id: receiverId, body, booking_id: req.body.booking_id || null,
    warning: warning || null, is_read: false, created_at: now(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await notify(receiverId, 'message', 'New message', body.slice(0, 80), '#/messages/' + req.user.id);
  res.json({ ok: true, warning, message: data });
});

router.get('/messages', requireAuth, async (req, res) => {
  const myId = req.user.id;
  const { data } = await svcClient().from('messages').select('*').or(`sender_id.eq.${myId},receiver_id.eq.${myId}`).order('created_at', { ascending: true }).limit(500);
  const messages = data || [];
  const convs = new Map();
  for (const m of messages) {
    const otherId = m.sender_id === myId ? m.receiver_id : m.sender_id;
    if (!convs.has(otherId)) convs.set(otherId, { other_id: otherId, messages: [] });
    convs.get(otherId).messages.push(m);
  }
  const result = [];
  for (const [otherId, cv] of convs) {
    const msgs = cv.messages;
    const last = msgs[msgs.length - 1];
    const unread = msgs.filter((m) => m.receiver_id === myId && !m.is_read).length;
    const { data: ou } = await svcClient().from('users').select('*').eq('id', otherId).maybeSingle();
    const lastBooking = msgs.map((m) => m.booking_id).find(Boolean) || null;
    result.push({ other_id: otherId, last, unread, booking_id: lastBooking, other: publicUser(ou.data), last_time: last.created_at, prev: last.body });
  }
  result.sort((a, b) => b.last_time - a.last_time);
  res.json(result);
});

router.get('/messages/:userId', requireAuth, async (req, res) => {
  const myId = req.user.id;
  const otherId = req.params.userId;
  const { data } = await svcClient().from('messages').select('*').or(`and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`).order('created_at', { ascending: true }).limit(500);
  const { data: ou } = await svcClient().from('users').select('*').eq('id', otherId).maybeSingle();
  const incoming = (data || []).filter((m) => m.receiver_id === myId && !m.is_read);
  for (const m of incoming) await svcClient().from('messages').update({ is_read: true }).eq('id', m.id);
  res.json({ messages: data || [], other: publicUser(ou.data) });
});

// ------------------------------------------------------------
// REQUESTS (fan-out)
// ------------------------------------------------------------
router.post('/requests', requireAuth, async (req, res) => {
  const { title, description, category, city, start_date, end_date, budget, latitude, longitude } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const { data, error } = await svcClient().from('rent_requests').insert({
    requester_id: req.user.id, title, description: description || '', category: category || '', city: city || '',
    start_date: start_date || null, end_date: end_date || null, budget: budget || null,
    latitude: latitude || null, longitude: longitude || null, status: 'open', created_at: now(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const { data: owners } = await svcClient().from('listings').select('owner_id').eq('status', 'active');
  const ids = [...new Set((owners || []).map((l) => l.owner_id))].filter((id) => id !== req.user.id);
  await notifyMany(ids, 'request', 'New rent request', title.slice(0, 80), '#/requests');
  res.json({ id: data.id });
});

router.get('/requests', requireAuth, async (req, res) => {
  const { data } = await svcClient().from('rent_requests').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(50);
  const requests = [];
  for (const r of data || []) {
    const { data: ru } = await svcClient().from('users').select('*').eq('id', r.requester_id).maybeSingle();
    requests.push({ ...r, requester: ru.data ? { id: ru.data.id, full_name: ru.data.full_name, avatar: ru.data.avatar } : null });
  }
  res.json(requests);
});

router.get('/requests/mine', requireAuth, async (req, res) => {
  const { data } = await svcClient().from('rent_requests').select('*').eq('requester_id', req.user.id).order('created_at', { ascending: false });
  res.json(data || []);
});

router.post('/requests/:id/close', requireAuth, async (req, res) => {
  const { data } = await svcClient().from('rent_requests').select('*').eq('id', req.params.id).single();
  if (!data) return res.status(404).json({ error: 'Not found' });
  if (data.requester_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your request' });
  await svcClient().from('rent_requests').update({ status: 'closed' }).eq('id', req.params.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------
// LEGAL
// ------------------------------------------------------------
const LEGAL_DEFAULTS = {
  terms: { title: 'GoRentHive Terms of Service', content: 'By using GoRentHive you agree to these terms...' },
  privacy: { title: 'Privacy Policy', content: 'We protect your data...' },
  cancellation: { title: 'Cancellation Policy', content: 'Free cancellation up to 48h before start.' },
  refund: { title: 'Refund Policy', content: 'Refunds follow our cancellation policy.' },
  damage: { title: 'Damage Policy', content: 'Security deposits cover damage.' },
  prohibited: { title: 'Prohibited Items', content: 'Some items cannot be rented.' },
  owner: { title: 'Owner Terms', content: 'Terms for listing owners.' },
  renter: { title: 'Renter Terms', content: 'Terms for renters.' },
};

async function getOrCreateTerms(type) {
  const { data } = await svcClient().from('terms_versions').select('*').eq('type', type).order('created_at', { ascending: false }).limit(1);
  if (data && data.length) return data[0];
  const d = LEGAL_DEFAULTS[type] || { title: type, content: '' };
  const { data: ins } = await svcClient().from('terms_versions').insert({ type, version: 1, title: d.title, content: d.content, created_at: now() }).select().single();
  return ins;
}

router.get('/legal', requireAuth, async (req, res) => {
  const out = [];
  for (const type of Object.keys(LEGAL_DEFAULTS)) out.push(await getOrCreateTerms(type));
  res.json(out);
});
router.get('/legal/:type', requireAuth, async (req, res) => {
  res.json(await getOrCreateTerms(req.params.type));
});
router.post('/legal/:type/accept', requireAuth, async (req, res) => {
  const t = await getOrCreateTerms(req.params.type);
  await svcClient().from('user_terms_acceptance').insert({ user_id: req.user.id, terms_type: req.params.type, version: t.version, accepted_at: now() });
  res.json({ ok: true });
});

// ------------------------------------------------------------
// CATEGORIES
// ------------------------------------------------------------
router.get('/categories', async (req, res) => {
  try {
    const { data } = await svcClient().from('categories').select('*').eq('is_active', true).order('sort_order', { ascending: true });
    const out = [];
    for (const c of data || []) {
      const [sub, cnt] = await Promise.all([
        svcClient().from('subcategories').select('*').eq('category_id', c.id),
        svcClient().from('listings').select('id', { count: 'exact', head: true }).eq('category_id', c.id).eq('status', 'active'),
      ]);
      out.push({ ...c, subcategories: sub.data || [], count: cnt.count || 0 });
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------------------------------------------
// LISTINGS
// ------------------------------------------------------------
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371, dLat = (bLat - aLat) * Math.PI / 180, dLng = (bLng - aLng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

router.get('/listings', async (req, res) => {
  try {
    let query = svcClient().from('listings').select('*');
    const filters = [];
    if (req.query.owner) filters.push(`owner_id=eq.${req.query.owner}`);
    if (req.query.category) filters.push(`category_id=eq.${req.query.category}`);
    if (req.query.city) filters.push(`location_city=ilike.*${req.query.city}*`);
    if (req.query.q) {
      const q = (req.query.q || '').trim();
      filters.push(`or(title.ilike.*${q}*,description.ilike.*${q}*)`);
    }
    if (filters.length) query = query.or(filters.join(','));
    else query = query.neq('id', -1);
    const { data } = await query.limit(100);
    let rows = (data || []).filter((r) => r.status === 'active' || r.owner_id === req.user?.id);
    if (req.query.featured === '1') rows = rows.filter((r) => r.featured);
    if (req.query.bundle === '1') rows = rows.filter((r) => r.is_bundle);
    const minP = parseFloat(req.query.minPrice); if (!isNaN(minP)) rows = rows.filter((r) => r.price_per_day >= minP);
    const maxP = parseFloat(req.query.maxPrice); if (!isNaN(maxP)) rows = rows.filter((r) => r.price_per_day <= maxP);
    // radius
    if (req.query.radius && req.query.lat && req.query.lng) {
      const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng), rad = parseFloat(req.query.radius);
      rows = rows.map((r) => {
        let d = null;
        if (r.latitude != null && r.longitude != null) d = haversineKm(lat, lng, r.latitude, r.longitude);
        return { ...r, distance_km: d, } // will round to 1 decimal below
      }).filter((r) => r.distance_km == null || r.distance_km <= rad);
      rows = rows.map((r) => ({ ...r, distance_km: r.distance_km != null ? Math.round(r.distance_km * 10) / 10 : null }));
    }
    const sort = req.query.sort;
    if (sort === 'price_asc') rows.sort((a, b) => a.price_per_day - b.price_per_day);
    else if (sort === 'price_desc') rows.sort((a, b) => b.price_per_day - a.price_per_day);
    else if (sort === 'popular') rows.sort((a, b) => (b.rental_count || 0) - (a.rental_count || 0));
    else if (sort === 'rating') {
      const ratings = {};
      for (const r of rows) {
        const all = await svcClient().from('listing_reviews').select('rating').eq('listing_id', r.id);
        const rr = all.data || [];
        ratings[r.id] = rr.length ? rr.reduce((s, x) => s + x.rating, 0) / rr.length : 0;
      }
      rows.sort((a, b) => ratings[b.id] - ratings[a.id]);
    } else {
      rows.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.created_at || 0) - (a.created_at || 0));
    }
    const out = [];
    for (const r of rows.slice(0, 100)) out.push(await fullListingRow(r));
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/listings/collections', async (req, res) => {
  try {
    const [trend, feat, bun, owners] = await Promise.all([
      svcClient().from('listings').select('*').eq('status', 'active').order('rental_count', { ascending: false }).limit(8),
      svcClient().from('listings').select('*').eq('status', 'active').eq('featured', true),
      svcClient().from('listings').select('*').eq('status', 'active').eq('is_bundle', true).limit(8),
      svcClient().from('users').select('*').eq('is_owner', true),
    ]);
    const trending = [], featured = [], bundles = [];
    for (const r of trend.data || []) trending.push(await fullListingRow(r));
    const feats = (feat.data || []).sort(() => Math.random() - 0.5).slice(0, 8);
    for (const r of feats) featured.push(await fullListingRow(r));
    for (const r of bun.data || []) bundles.push(await fullListingRow(r));
    const topOwners = [];
    const withRentals = (owners.data || []).filter((o) => o.successful_rentals > 0).sort((a, b) => (b.vessel_rating || 0) - (a.vessel_rating || 0)).slice(0, 8);
    for (const o of withRentals) {
      const { count } = await svcClient().from('listings').select('id', { count: 'exact', head: true }).eq('owner_id', o.id).eq('status', 'active');
      topOwners.push({ ...publicUser(o), itemCount: count || 0 });
    }
    res.json({ trending, featured, bundles, topOwners });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/listings/locations', async (req, res) => {
  try {
    const { data } = await svcClient().from('listings').select('location_city').eq('status', 'active');
    const counts = {};
    for (const r of data || []) { if (r.location_city) counts[r.location_city] = (counts[r.location_city] || 0) + 1; }
    const out = Object.keys(counts).map((city) => ({ location_city: city, c: counts[city] })).sort((a, b) => b.c - a.c).slice(0, 20);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/listings/:id', async (req, res) => {
  try {
    const { data, error } = await svcClient().from('listings').select('*').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Not found' });
    await svcClient().from('listings').update({ view_count: (data.view_count || 0) + 1 }).eq('id', data.id);
    res.json(await fullListingRow({ ...data, view_count: (data.view_count || 0) + 1 }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/listings/:id/related', async (req, res) => {
  try {
    const { data } = await svcClient().from('listings').select('*').eq('id', req.params.id).single();
    if (!data) return res.json([]);
    const { data: rel } = await svcClient().from('listings').select('*').eq('status', 'active').eq('category_id', data.category_id).neq('id', data.id).order('rental_count', { ascending: false }).limit(6);
    const out = [];
    for (const r of rel || []) out.push(await fullListingRow(r));
    res.json(out);
  } catch (e) { res.json([]); }
});

router.post('/listings/:id/favorite', requireAuth, async (req, res) => {
  try {
    const { data: l } = await svcClient().from('listings').select('id,favorite_count').eq('id', req.params.id).single();
    if (!l) return res.status(404).json({ error: 'Not found' });
    const { data: existing } = await svcClient().from('favorites').select('*').eq('user_id', req.user.id).eq('listing_id', req.params.id).maybeSingle();
    if (existing) {
      await svcClient().from('favorites').delete().eq('id', existing.id);
      await svcClient().from('listings').update({ favorite_count: Math.max(0, (l.favorite_count || 0) - 1) }).eq('id', l.id);
      res.json({ favorited: false });
    } else {
      await svcClient().from('favorites').insert({ user_id: req.user.id, listing_id: req.params.id, created_at: now() });
      await svcClient().from('listings').update({ favorite_count: (l.favorite_count || 0) + 1 }).eq('id', l.id);
      res.json({ favorited: true });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/listings', requireAuth, async (req, res) => {
  try {
    const u = req.user;
    if (!u.last_terms_accepted) return res.status(428).json({ error: 'Please accept the Terms first.', code: 'terms_required' });
    const missing = [];
    if (!u.email_verified) missing.push('email');
    if (!u.mobile_verified) missing.push('mobile');
    if (u.identity_status !== 'verified') missing.push('identity');
    if (missing.length) return res.status(428).json({ error: 'Please complete verification to list items.', code: 'verify_required', missing });
    const cap = await monetize.enforceListingCap(req.user);
    if (!cap.allowed) return res.status(402).json({ error: cap.error, code: 'listing_cap_exceeded', over: cap.over, fee: cap.fee });
    const { title, price_per_day, estimated_value, deposit_tier } = req.body;
    if (!title || !price_per_day || estimated_value == null) return res.status(400).json({ error: 'title, price_per_day, estimated_value required' });
    const security_deposit = Math.round(Number(estimated_value) * ({ low: 0.1, medium: 0.2, high: 0.3 }[deposit_tier || 'low'] || 0.1));
    let categoryId = req.body.category_id || null;
    if (!categoryId && req.body.categoryName) {
      const { data: c } = await svcClient().from('categories').select('id').eq('name', req.body.categoryName).maybeSingle();
      categoryId = c ? c.id : null;
    }
    const { data, error } = await svcClient().from('listings').insert({
      owner_id: u.id, category_id: categoryId, subcategory_id: null,
      title, description: req.body.description || '', price_per_day: Number(price_per_day),
      security_deposit, estimated_value: Number(estimated_value), deposit_tier: deposit_tier || 'low',
      location_city: req.body.location_city || '', location_barangay: req.body.location_barangay || '', location_province: req.body.location_province || '',
      latitude: req.body.latitude || null, longitude: req.body.longitude || null,
      delivery_available: !!req.body.delivery_available, pickup_available: req.body.pickup_available !== false,
      delivery_fee: req.body.delivery_fee || 0, min_verification_level: req.body.min_verification_level || 2,
      rules: req.body.rules || '', condition: req.body.condition || '', accessories: req.body.accessories || '',
      serial_number: req.body.serial_number, status: 'active', is_bundle: !!req.body.is_bundle,
      bundle_items: req.body.bundle_items ? JSON.stringify(req.body.bundle_items) : null,
      created_at: now(), updated_at: now(),
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    const images = Array.isArray(req.body.images) ? req.body.images : [];
    if (images.length) {
      await svcClient().from('listing_images').insert(images.map((url, i) => ({ listing_id: data.id, url, is_primary: i === 0, sort_order: i })));
    }
    if (cap.over > 0) await monetize.chargeListingOverage(req.user, cap.over);
    res.json(await fullListingRow(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/listings/:id', requireAuth, async (req, res) => {
  try {
    const { data: l, error } = await svcClient().from('listings').select('*').eq('id', req.params.id).single();
    if (error || !l) return res.status(404).json({ error: 'Not found' });
    if (l.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your listing' });
    const patch = {};
    ['title', 'description', 'price_per_day', 'location_city', 'location_barangay', 'location_province', 'latitude', 'longitude', 'delivery_available', 'pickup_available', 'delivery_fee', 'min_verification_level', 'rules', 'condition', 'accessories', 'serial_number', 'status', 'is_bundle'].forEach((k) => {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    });
    if (req.body.estimated_value !== undefined || req.body.deposit_tier !== undefined) {
      patch.estimated_value = req.body.estimated_value !== undefined ? req.body.estimated_value : l.estimated_value;
      patch.deposit_tier = req.body.deposit_tier !== undefined ? req.body.deposit_tier : l.deposit_tier;
      patch.security_deposit = Math.round(Number(patch.estimated_value) * ({ low: 0.1, medium: 0.2, high: 0.3 }[patch.deposit_tier] || 0.1));
    }
    if (req.body.bundle_items) patch.bundle_items = JSON.stringify(req.body.bundle_items);
    patch.updated_at = now();
    await svcClient().from('listings').update(patch).eq('id', l.id);
    if (Array.isArray(req.body.images)) {
      await svcClient().from('listing_images').delete().eq('listing_id', l.id);
      if (req.body.images.length) await svcClient().from('listing_images').insert(req.body.images.map((url, i) => ({ listing_id: l.id, url, is_primary: i === 0, sort_order: i })));
    }
    const { data: updated } = await svcClient().from('listings').select('*').eq('id', l.id).single();
    res.json(await fullListingRow(updated));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/listings/:id', requireAuth, async (req, res) => {
  try {
    const { data: l } = await svcClient().from('listings').select('owner_id').eq('id', req.params.id).single();
    if (!l) return res.status(404).json({ error: 'Not found' });
    if (l.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your listing' });
    await svcClient().from('listing_images').delete().eq('listing_id', req.params.id);
    await svcClient().from('listings').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------------------------------------------
// MONETIZATION: premium, featured boost, seller dashboard
// ------------------------------------------------------------
router.post('/listings/:id/boost', requireAuth, async (req, res) => {
  try {
    const r = await monetize.boostListing(req.user, Number(req.params.id));
    if (!r.ok) return res.status(402).json({ error: r.error, fee: r.fee });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/account/premium', requireAuth, async (req, res) => {
  try {
    const r = await monetize.purchasePremium(req.user);
    if (!r.ok) return res.status(402).json({ error: r.error, fee: r.fee });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/seller/dashboard', requireAuth, async (req, res) => {
  try {
    res.json(await monetize.sellerDashboard(req.user));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------------------------------------------
// BOOKINGS (read-side; writes/money in financial.js + above)
// ------------------------------------------------------------
router.get('/bookings/mine/:side', requireAuth, async (req, res) => {
  try {
    const side = req.params.side;
    let q;
    if (side === 'renter') q = svcClient().from('bookings').select('*').eq('renter_id', req.user.id);
    else if (side === 'owner') q = svcClient().from('bookings').select('*').eq('owner_id', req.user.id);
    else q = svcClient().from('bookings').select('*').or(`renter_id.eq.${req.user.id},owner_id.eq.${req.user.id}`);
    const { data } = await q.order('created_at', { ascending: false });
    const out = [];
    for (const b of data || []) out.push(await bookingFull(b));
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/bookings/:id', requireAuth, async (req, res) => {
  try {
    const b = await getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'Not found' });
    if (b.renter_id !== req.user.id && b.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your booking' });
    res.json(await bookingFull(b));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------------------------------------------
// REVIEWS
// ------------------------------------------------------------
router.post('/reviews', requireAuth, async (req, res) => {
  try {
    const { booking_id, rating, comment, target_user_id, listing_id } = req.body;
    if (!booking_id || !rating || !target_user_id) return res.status(400).json({ error: 'booking_id, rating, target_user_id required' });
    const b = await getBooking(booking_id);
    if (!b || b.status !== 'completed') return res.status(403).json({ error: 'Only completed bookings can be reviewed' });
    if (b.renter_id !== req.user.id && b.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your booking' });
    if (b.renter_id !== target_user_id && b.owner_id !== target_user_id) return res.status(403).json({ error: 'Can only review the other party' });
    const { data: existing } = await svcClient().from('booking_reviews').select('*').eq('booking_id', booking_id).eq('reviewer_id', req.user.id).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Already reviewed' });
    await svcClient().from('booking_reviews').insert({ booking_id: booking_id, reviewer_id: req.user.id, target_user_id, rating: Number(rating), comment: comment || '', created_at: now() });
    const { data: tu } = await svcClient().from('users').select('rating_sum,review_count,id').eq('id', target_user_id).single();
    const newSum = (tu.rating_sum || 0) + Number(rating);
    const newCount = (tu.review_count || 0) + 1;
    await svcClient().from('users').update({ rating_sum: newSum, review_count: newCount, vessel_rating: Math.round((newSum / newCount) * 10) / 10, updated_at: now() }).eq('id', target_user_id);
    if (listing_id) {
      const { data: le } = await svcClient().from('listing_reviews').select('*').eq('listing_id', listing_id).eq('author_id', req.user.id).maybeSingle();
      if (!le) await svcClient().from('listing_reviews').insert({ listing_id: listing_id, author_id: req.user.id, rating: Number(rating), comment: comment || '', created_at: now() });
    }
    res.json({ ok: true, new_rating: (newSum / newCount).toFixed(1) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------------------------------------------
// NOTIFICATIONS
// ------------------------------------------------------------
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const { data } = await svcClient().from('notifications').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50);
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------------------------------------------
// ADMIN READ / MANAGEMENT
// ------------------------------------------------------------
router.get('/admin/analytics', requireAuth, requireAdmin, async (req, res) => {
  const [users, listings, bookings, disputes] = await Promise.all([
    svcClient().from('users').select('*'),
    svcClient().from('listings').select('*'),
    svcClient().from('bookings').select('*'),
    svcClient().from('disputes').select('*'),
  ]);
  const u = users.data || [], l = listings.data || [], b = bookings.data || [], d = disputes.data || [];
  const completed = b.filter((x) => x.status === 'completed');
  const gross = completed.reduce((s, x) => s + (x.rental_fee || 0) + (x.delivery_fee || 0), 0);
  const revenueByDay = {};
  const now30 = now() - 30 * 86400000;
  for (const x of completed) {
    const day = new Date(x.return_completed_at || x.created_at).toISOString().slice(0, 10);
    revenueByDay[day] = (revenueByDay[day] || 0) + (x.rental_fee || 0);
  }
  const catCount = {};
  for (const x of l) catCount[x.category_id] = (catCount[x.category_id] || 0) + 1;
  const topCats = [];
  for (const k of Object.keys(catCount)) topCats.push({ name: 'cat-' + k, c: catCount[k] });
  topCats.sort((a, b) => b.c - a.c);
  const topListing = [...l].sort((a, b) => (b.rental_count || 0) - (a.rental_count || 0))[0] || null;
  const topOwner = [...u].filter((x) => x.is_owner).sort((a, b) => (b.successful_rentals || 0) - (a.successful_rentals || 0))[0] || null;
  res.json({
    totalUsers: u.length, activeUsers: u.filter((x) => (x.updated_at || 0) >= now30).length,
    listings: l.length, activeListings: l.filter((x) => x.status === 'active').length,
    bookings: b.length, completed: completed.length, cancelled: b.filter((x) => x.status === 'cancelled').length,
    gross, platformRevenue: completed.reduce((s, x) => s + (x.platform_fee || 0), 0),
    pendingDisputes: d.filter((x) => x.status === 'open').length,
    topCategories: topCats.slice(0, 5), topListing: topListing ? { id: topListing.id, title: topListing.title, rental_count: topListing.rental_count } : null,
    topOwner: topOwner ? { full_name: topOwner.full_name, successful_rentals: topOwner.successful_rentals, vessel_rating: topOwner.vessel_rating } : null,
    revenueByDay: Object.keys(revenueByDay).map((day) => ({ d: day, s: revenueByDay[day] })),
  });
});

router.get('/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const q = (req.query.q || '').trim();
  let query = svcClient().from('users').select('*').order('created_at', { ascending: false }).limit(200);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
  const { data } = await query;
  res.json((data || []).map((u) => ({ ...publicUser(u), email: u.email, phone: u.phone, wallet_balance: u.wallet_balance, created_at: u.created_at })));
});

router.post('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const patch = {};
  if (req.body.role) patch.role = req.body.role;
  if (req.body.suspended !== undefined) patch.suspended = !!req.body.suspended;
  if (req.body.identity_status) {
    patch.identity_status = req.body.identity_status;
    if (req.body.identity_status === 'verified') patch.identity_level = Math.max(patch.identity_level || 1, 3);
  }
  patch.updated_at = now();
  await svcClient().from('users').update(patch).eq('id', req.params.id);
  if (req.body.identity_status) await svcClient().from('identity_verifications').update({ status: req.body.identity_status }).eq('user_id', req.params.id);
  await svcClient().from('audit_logs').insert({ admin_id: req.user.id, action: 'user_update', detail: JSON.stringify(patch), created_at: now() });
  const u = await loadUserById(req.params.id);
  res.json(publicUser(u));
});

router.get('/admin/listings', requireAuth, requireAdmin, async (req, res) => {
  const { data } = await svcClient().from('listings').select('*').order('created_at', { ascending: false }).limit(200);
  const out = [];
  for (const l of data || []) {
    const { data: o } = await svcClient().from('users').select('full_name').eq('id', l.owner_id).maybeSingle();
    out.push({ id: l.id, title: l.title, status: l.status, price_per_day: l.price_per_day, featured: !!l.featured, rental_count: l.rental_count, owner_id: l.owner_id, owner_name: o.data?.full_name || '', category: 'cat-' + l.category_id });
  }
  res.json(out);
});

router.post('/admin/listings/:id', requireAuth, requireAdmin, async (req, res) => {
  const patch = {};
  if (req.body.status) patch.status = req.body.status;
  if (req.body.featured !== undefined) patch.featured = !!req.body.featured;
  patch.updated_at = now();
  const { error } = await svcClient().from('listings').update(patch).eq('id', req.params.id);
  if (error) return res.status(404).json({ error: error.message });
  const { data: l } = await svcClient().from('listings').select('owner_id').eq('id', req.params.id).maybeSingle();
  if (l?.owner_id) await notify(l.owner_id, 'listing', 'Listing updated', 'An admin updated your listing.');
  await svcClient().from('audit_logs').insert({ admin_id: req.user.id, action: 'listing_update', detail: JSON.stringify(patch), created_at: now() });
  res.json({ ok: true });
});

router.get('/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  const { data } = await svcClient().from('admin_settings').select('*');
  const obj = {};
  for (const s of data || []) obj[s.key] = s.value;
  res.json(obj);
});

router.post('/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  const allowed = ['platform_percent', 'platform_min_fee', 'platform_max_fee', 'featured_fee_basic', 'featured_fee_plus', 'featured_fee_premium', 'free_cancellation_hours', 'partial_cancellation_hours'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) await svcClient().from('admin_settings').upsert({ key: k, value: String(req.body[k]), updated_at: now() }, { onConflict: 'key' });
  }
  await svcClient().from('audit_logs').insert({ admin_id: req.user.id, action: 'settings_update', detail: 'updated settings', created_at: now() });
  res.json({ ok: true });
});

router.post('/admin/broadcast', requireAuth, requireAdmin, async (req, res) => {
  const { title, body } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const { data } = await svcClient().from('users').select('id');
  const ids = (data || []).map((u) => u.id);
  await notifyMany(ids, 'broadcast', title, body || '', '');
  await svcClient().from('audit_logs').insert({ admin_id: req.user.id, action: 'broadcast', detail: title, created_at: now() });
  res.json({ ok: true, sent: ids.length });
});

router.get('/admin/refunds', requireAuth, requireAdmin, async (req, res) => {
  const { data } = await svcClient().from('refunds').select('*').order('created_at', { ascending: false }).limit(100);
  res.json(data || []);
});

router.get('/admin/audit', requireAuth, requireAdmin, async (req, res) => {
  const { data } = await svcClient().from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
  res.json(data || []);
});

router.get('/admin/disputes', requireAuth, requireAdmin, async (req, res) => {
  const { data } = await svcClient().from('disputes').select('*').order('created_at', { ascending: false }).limit(100);
  const out = [];
  for (const d of data || []) {
    const b = d.booking_id ? await getBooking(d.booking_id) : null;
    const { data: r } = await svcClient().from('users').select('*').eq('id', d.reporter_id).maybeSingle();
    out.push({ ...d, booking: b ? { id: b.id, booking_ref: b.booking_ref, status: b.status } : null, reporter: publicUser(r.data), evidence: b ? await evidenceFor(b) : null });
  }
  res.json(out);
});

async function evidenceFor(b) {
  const [agreement, condition, deliveries, payments, deposit] = await Promise.all([
    svcClient().from('rental_agreements').select('*').eq('booking_id', b.id).maybeSingle(),
    svcClient().from('condition_records').select('*').eq('booking_id', b.id),
    svcClient().from('delivery_requests').select('*').eq('booking_id', b.id),
    svcClient().from('payments').select('*').eq('booking_id', b.id),
    svcClient().from('security_deposits').select('*').eq('booking_id', b.id).maybeSingle(),
  ]);
  return {
    booking: { id: b.id, ref: b.booking_ref, status: b.status, dates: { start: b.start_date, end: b.end_date }, fees: { rental: b.rental_fee, delivery: b.delivery_fee, deposit: b.security_deposit, platform: b.platform_fee } },
    escrow: { released: b.escrow_released, proposed_deduction: b.return_proposed_deduction },
    agreement: agreement.data || null, condition: condition.data || [], delivery: deliveries.data || [],
    payments: payments.data || [], deposit: deposit.data || null,
  };
}

module.exports = router;
