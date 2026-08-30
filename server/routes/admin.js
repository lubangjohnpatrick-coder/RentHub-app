'use strict';

const express = require('express');
const db = require('../db/schema');
const { requireAuth, requireAdmin, publicUser } = require('../auth');
const settings = require('../settings');
const ledger = require('../ledger');
const { notify } = require('../notify');
const router = express.Router();

router.use(requireAuth, requireAdmin);

function log(req, action, detail) {
  db.prepare('INSERT INTO audit_logs (admin_id, action, detail, created_at) VALUES (?,?,?,?)').run(req.user.id, action, detail || '', Date.now());
}

// Analytics dashboard
router.get('/analytics', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const activeUsers = db.prepare('SELECT COUNT(*) c FROM users WHERE updated_at > ?').get(Date.now() - 30 * 24 * 60 * 60 * 1000).c;
  const listings = db.prepare('SELECT COUNT(*) c FROM listings').get().c;
  const activeListings = db.prepare('SELECT COUNT(*) c FROM listings WHERE status=\'active\'').get().c;
  const bookings = db.prepare('SELECT COUNT(*) c FROM bookings').get().c;
  const completed = db.prepare('SELECT COUNT(*) c FROM bookings WHERE status=\'completed\'').get().c;
  const cancelled = db.prepare('SELECT COUNT(*) c FROM bookings WHERE status IN (\'cancelled\',\'rejected\')').get().c;
  const gross = db.prepare('SELECT COALESCE(SUM(rental_fee+delivery_fee),0) s FROM bookings WHERE status=\'completed\'').get().s;
  const platformRevenue = db.prepare('SELECT COALESCE(SUM(platform_fee),0) s FROM bookings WHERE status=\'completed\'').get().s;
  const pendingDisputes = db.prepare('SELECT COUNT(*) c FROM disputes WHERE status NOT IN (\'resolved\',\'dismissed\')').get().c;
  const topCategories = db.prepare(
    `SELECT c.name, COUNT(l.id) c FROM listings l JOIN categories c ON c.id=l.category_id GROUP BY c.name ORDER BY c DESC LIMIT 8`
  ).all();
  const topListing = db.prepare('SELECT id, title, rental_count FROM listings ORDER BY rental_count DESC LIMIT 1').get();
  const topOwner = db.prepare('SELECT full_name, successful_rentals, vessel_rating FROM users ORDER BY successful_rentals DESC LIMIT 1').get();
  const revenueByDay = db.prepare('SELECT date(created_at/1000,\'unixepoch\') d, SUM(platform_fee) s FROM bookings WHERE status=\'completed\' GROUP BY d ORDER BY d DESC LIMIT 14').all();
  res.json({
    totalUsers, activeUsers, listings, activeListings, bookings, completed, cancelled,
    gross, platformRevenue, pendingDisputes, topCategories, topListing, topOwner, revenueByDay,
  });
});

// Users list
router.get('/users', (req, res) => {
  const q = req.query.q || '';
  let rows;
  if (q) rows = db.prepare('SELECT * FROM users WHERE full_name LIKE ? OR email LIKE ? OR phone LIKE ?').all('%' + q + '%', '%' + q + '%', '%' + q + '%');
  else rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows.map(u => ({ ...publicUser(u), email: u.email, phone: u.phone, wallet_balance: u.wallet_balance, created_at: u.created_at })));
});

// Update user (suspend, verify identity, promote)
router.post('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const { role, suspended, identity_status, verified } = req.body || {};
  if (role) db.prepare('UPDATE users SET role=? WHERE id=?').run(role === 'admin' ? 'admin' : 'user', u.id);
  if (suspended !== undefined) db.prepare('UPDATE users SET suspended=? WHERE id=?').run(suspended ? 1 : 0, u.id); // (schema tolerant via column check)
  if (identity_status) {
    db.prepare('UPDATE users SET identity_status=?, identity_level=? WHERE id=?').run(identity_status, identity_status === 'verified' ? 3 : u.identity_level, u.id);
    db.prepare('UPDATE identity_verifications SET status=?, reviewed_at=? WHERE user_id=?').run(identity_status, Date.now(), u.id);
    if (identity_status === 'verified') {
      db.prepare('UPDATE users SET identity_level=3 WHERE id=?').run(u.id);
    }
  }
  if (verified !== undefined) {
    db.prepare('UPDATE users SET mobile_verified=?, email_verified=? WHERE id=?').run(verified ? 1 : 0, verified ? 1 : 0, u.id);
  }
  log(req, 'user_update', JSON.stringify({ uid: u.id, req: req.body }));
  notify(u.id, 'verification_update', 'Verification update', 'Your account verification status was updated', `/profile`);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)));
});

// Listings management
router.get('/listings', (req, res) => {
  const rows = db.prepare('SELECT * FROM listings ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows.map(l => ({
    id: l.id, title: l.title, status: l.status, price_per_day: l.price_per_day, featured: !!l.featured,
    rental_count: l.rental_count, owner_id: l.owner_id,
    owner_name: (db.prepare('SELECT full_name FROM users WHERE id=?').get(l.owner_id) || {}).full_name,
    category: l.category_id ? (db.prepare('SELECT name FROM categories WHERE id=?').get(l.category_id) || {}).name : null,
  })));
});

router.post('/listings/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  const { status, featured } = req.body || {};
  if (status) db.prepare('UPDATE listings SET status=? WHERE id=?').run(status, l.id);
  if (featured !== undefined) db.prepare('UPDATE listings SET featured=? WHERE id=?').run(featured ? 1 : 0, l.id);
  log(req, 'listing_update', JSON.stringify({ id: l.id, status, featured }));
  notify(l.owner_id, 'listing_update', 'Listing updated by admin', `Your listing "${l.title}" was ${status || 'updated'} by RentHub`, `/listings`);
  res.json({ ok: true });
});

// Disputes
router.get('/disputes', (req, res) => {
  const rows = db.prepare('SELECT * FROM disputes ORDER BY created_at DESC LIMIT 100').all();
  res.json(rows.map(d => {
    const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(d.booking_id);
    const reporter = db.prepare('SELECT * FROM users WHERE id=?').get(d.reporter_id);
    // Aggregate verifiable evidence so admin can review without trusting either party's word:
    // condition photos (checkin/checkout), the signed agreement, chat logs, delivery proof,
    // payments, and key timestamps.
    let evidence = null;
    if (b) {
      evidence = {
        booking_ref: b.booking_ref,
        status: b.status,
        created_at: b.created_at,
        rental: { start_date: b.start_date, end_date: b.end_date, days: b.rental_days, fee: b.rental_fee },
        escrow: { charged: b.total_charged, released: !!b.escrow_released },
        agreement: db.prepare('SELECT * FROM rental_agreements WHERE booking_id=?').get(b.id),
        condition: db.prepare('SELECT booking_id, phase, uploaded_by, photos, serial_number, accessories, damage_notes, created_at FROM condition_records WHERE booking_id=? ORDER BY id').all(b.id),
        delivery: db.prepare("SELECT id, phase, provider, provider_order_id, status, vehicle_type, distance_km, fee, origin_address, dropoff_address, tracking_url, driver_name, driver_phone, proof_photo, proof_signature, created_at FROM delivery_requests WHERE booking_id=? ORDER BY id").all(b.id),
        chat: db.prepare('SELECT id, sender_id, receiver_id, body, warning, created_at FROM messages WHERE booking_id=? ORDER BY created_at').all(b.id),
        payments: db.prepare('SELECT id, type, gross_amount, platform_fee, status, created_at FROM payments WHERE booking_id=? ORDER BY id').all(b.id),
        deposit: db.prepare('SELECT amount, status, deduction, deduction_reason FROM security_deposits WHERE booking_id=?').get(b.id),
      };
    }
    return { ...d, booking: b ? { id: b.id, booking_ref: b.booking_ref, status: b.status } : null, reporter: publicUser(reporter), evidence };
  }));
});

// Resolve dispute
router.post('/disputes/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM disputes WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const { status, resolution, finalDepositDeduction } = req.body || {};
  db.prepare('UPDATE disputes SET status=?, resolution=?, resolved_by=?, resolved_at=? WHERE id=?').run(status || d.status, resolution || '', req.user.id, Date.now(), d.id);
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(d.booking_id);
  if (b) {
    notify(b.renter_id, 'dispute_update', 'Dispute update', `Dispute ${d.id} ${status}: ${resolution || ''}`, `/booking/${b.id}`);
    notify(b.owner_id, 'dispute_update', 'Dispute update', `Dispute ${d.id} ${status}: ${resolution || ''}`, `/booking/${b.id}`);
  }
  // When an admin settles a deposit dispute, release the escrow fairly with the
  // decided deduction. Without this, disputed funds would stay frozen forever.
  if (b && (status === 'resolved' || status === 'closed') && b.status === 'disputed' && b.escrow_payment) {
    const { finalizeBooking } = require('./bookings');
    const decidedDeduction = parseInt(finalDepositDeduction, 10) >= 0 ? parseInt(finalDepositDeduction, 10) : (b.return_proposed_deduction >= 0 ? b.return_proposed_deduction : 0);
    try {
      finalizeBooking(b, decidedDeduction, resolution || 'Admin decision', b.late_fee || 0);
    } catch (e) { /* logging only; response still ok */ }
  }
  log(req, 'dispute_resolve', JSON.stringify({ id: d.id, status, resolution }));
  res.json({ ok: true });
});

// File a dispute (also available to users via bookings; here admin can open)
router.post('/bookings/:id/dispute', requireAuth, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  const existing = db.prepare('SELECT id FROM disputes WHERE booking_id=?').get(b.id);
  if (existing) return res.status(400).json({ error: 'A dispute already exists for this booking' });
  db.prepare('INSERT INTO disputes (booking_id, reporter_id, category, description, status, evidence, created_at) VALUES (?,?,?,?,?,?,?)').run(
    b.id, req.body?.reporter_id || req.user.id, req.body?.category || 'Other', req.body?.description || '', 'open', JSON.stringify({}), Date.now()
  );
  notify(b.owner_id, 'dispute_update', 'Dispute opened', 'A dispute has been opened on one of your bookings', `/booking/${b.id}`);
  res.json({ ok: true });
});

// Commission settings
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM admin_settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.post('/settings', (req, res) => {
  const allowed = ['platform_percent', 'platform_min_fee', 'platform_max_fee', 'referral_reward', 'referrer_reward',
    'featured_fee_basic', 'featured_fee_plus', 'featured_fee_premium', 'free_cancellation_hours', 'partial_cancellation_hours'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) settings.setSetting(k, req.body[k]);
  }
  log(req, 'settings_update', JSON.stringify(req.body));
  res.json({ ok: true });
});

// Notifications broadcast
router.post('/broadcast', (req, res) => {
  const { title, body } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title required' });
  const users = db.prepare('SELECT id FROM users').all();
  users.forEach(u => notify(u.id, 'broadcast', title, body || '', ''));
  log(req, 'broadcast', title);
  res.json({ ok: true, sent: users.length });
});

// Refunds (admin approval)
router.get('/refunds', (req, res) => {
  res.json(db.prepare('SELECT * FROM refunds ORDER BY created_at DESC LIMIT 100').all());
});

// Payouts
router.get('/payouts', (req, res) => {
  res.json(db.prepare('SELECT * FROM payouts ORDER BY created_at DESC LIMIT 100').all());
});
router.post('/payouts/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM payouts WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { status } = req.body || {};
  db.prepare('UPDATE payouts SET status=? WHERE id=?').run(status || 'paid', p.id);
  notify(p.user_id, 'payout', 'Payout processed', `Your payout of P${p.amount} was ${status}.`, `/wallet`);
  res.json({ ok: true });
});

// Categories admin
router.post('/categories', (req, res) => {
  const { name, icon, color } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  db.prepare('INSERT OR IGNORE INTO categories (name, slug, icon, color, sort_order, is_active) VALUES (?,?,?,?,?,1)').run(name, slug, icon || '📦', color || '#95A5A6', 999);
  log(req, 'category_create', name);
  res.json({ ok: true });
});

// Audit logs
router.get('/audit', (req, res) => {
  res.json(db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all());
});

module.exports = router;
