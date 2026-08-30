'use strict';

const express = require('express');
const db = require('../db/schema');
const { hashPassword, verifyPassword, createSession, destroySession, requireAuth, publicUser } = require('../auth');
const verify = require('../verify');
const crypto = require('crypto');
const router = express.Router();

function genReferral() {
  return 'RH-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function updateRatingScore(userId) {
  const u = db.prepare('SELECT rating_sum, review_count FROM users WHERE id=?').get(userId);
  if (!u || u.review_count === 0) return;
  db.prepare('UPDATE users SET vessel_rating=? WHERE id=?').run((u.rating_sum / u.review_count).toFixed(2), userId);
}

router.post('/register', (req, res) => {
  if (!verify.rateLimit('reg:' + (req.ip || 'anon'), 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many sign-ups. Please try again later.' });
  }
  const { full_name, email, phone, password, city, role, referred_by } = req.body || {};
  if (!full_name || !password) return res.status(400).json({ error: 'Name and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = email
    ? db.prepare('SELECT id FROM users WHERE email=?').get(email)
    : db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
  if (existing) return res.status(400).json({ error: 'An account with that email/phone already exists' });

  const now = Date.now();
  const code = genReferral();
  let referredByUser = null;
  if (referred_by) {
    const re = String(referred_by).trim();
    referredByUser = db.prepare('SELECT id FROM users WHERE referral_code=?').get(re) || null;
  }

  const info = db.prepare(
    `INSERT INTO users (email, phone, password_hash, full_name, role, city, referral_code, referred_by_user_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(email || null, phone || null, hashPassword(password), full_name, role === 'admin' ? 'user' : 'user', city || '', code, referredByUser ? referredByUser.id : null, now, now);

  const uid = info.lastInsertRowid;
  verify.acceptTerms(uid);
  const token = createSession(uid);
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000, path: '/' });
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(uid)) });
});

router.post('/login', (req, res) => {
  if (!verify.rateLimit('login:' + (req.ip || 'anon'), 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }
  const { email, phone, password } = req.body || {};
  const ident = email || phone;
  if (!ident || !password) return res.status(400).json({ error: 'Email/phone and password required' });
  const user = email
    ? db.prepare('SELECT * FROM users WHERE email=?').get(email)
    : db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.suspended || user.banned) {
    return res.status(403).json({ error: 'This account has been restricted. Contact support.' });
  }
  const token = createSession(user.id);
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000, path: '/' });
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  const token = req.cookies && req.cookies.session;
  if (token) destroySession(token);
  res.clearCookie('session');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies && req.cookies.session;
  const auth = require('../auth');
  const user = auth.getSessionUser(token);
  if (!user) return res.json({ user: null });
  res.json({
    user: publicUser(user),
    verification: verify.verificationStatus(user),
    termsAccepted: verify.hasAcceptedTerms(user),
    termsVersion: require('../settings').getSetting('terms_version', '1'),
    balance: user.wallet_balance,
    location: {
      latitude: user.latitude,
      longitude: user.longitude,
      status: user.location_status,
      verified_by: user.location_verified_by,
    },
  });
});

// --- Real mobile verification (OTP) ---
// Send a 6-digit OTP to the user's phone
router.post('/verify/mobile/send', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u.phone) return res.status(400).json({ error: 'Add a phone number to your profile first.' });
  const result = verify.sendMobileOtp(u.id, u.phone);
  if (result.error) return res.status(429).json({ error: result.error });
  res.json({ ok: true, demoCode: result.demoCode });
});

// Resend is the same as send (rate-limited upstream)
router.post('/verify/mobile/resend', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u.phone) return res.status(400).json({ error: 'Add a phone number to your profile first.' });
  const result = verify.sendMobileOtp(u.id, u.phone);
  if (result.error) return res.status(429).json({ error: result.error });
  res.json({ ok: true, demoCode: result.demoCode });
});

// Validate the OTP
router.post('/verify/mobile', requireAuth, (req, res) => {
  const { code } = req.body || {};
  const result = verify.confirmMobileOtp(req.user.id, code);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});

// --- Real email verification (token link) ---
// Request an email verification link
router.post('/verify/email/send', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u.email) return res.status(400).json({ error: 'Add an email address to your profile first.' });
  const result = verify.sendEmailVerification(u.id, u.email);
  if (result.error) return res.status(429).json({ error: result.error });
  res.json({ ok: true, demoToken: result.demoToken });
});

// Confirm using the token from the link (also accepted via POST with token body)
router.post('/verify/email', requireAuth, (req, res) => {
  const { token } = req.body || {};
  const result = verify.confirmEmailToken(req.user.id, token);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});

// Submit identity verification
router.post('/verify/identity', requireAuth, (req, res) => {
  const { id_type, id_number, selfie } = req.body || {};
  if (!id_type || !id_number) return res.status(400).json({ error: 'ID type and number required' });
  db.prepare(
    'INSERT INTO identity_verifications (user_id, id_type, id_number, selfie, status, created_at) VALUES (?,?,?,?,?,?)'
  ).run(req.user.id, id_type, id_number, selfie || '', 'pending', Date.now());
  db.prepare('UPDATE users SET id_type=?, id_number=?, id_selfie=?, identity_status=? WHERE id=?').run(
    id_type, id_number, selfie || '', 'pending', req.user.id
  );
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});

// Accept current Terms & Conditions
router.post('/terms/accept', requireAuth, (req, res) => {
  verify.acceptTerms(req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)), termsAccepted: true });
});

// Toggle owner mode
router.post('/owner-toggle', requireAuth, (req, res) => {
  const { is_owner } = req.body || {};
  db.prepare('UPDATE users SET is_owner=? WHERE id=?').run(is_owner ? 1 : 0, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});

router.post('/address', requireAuth, (req, res) => {
  const { address, barangay, city, province, latitude, longitude } = req.body || {};
  db.prepare('UPDATE users SET address=?, barangay=?, city=?, province=?, latitude=?, longitude=? WHERE id=?').run(
    address || '', barangay || '', city || '', province || '', latitude || null, longitude || null, req.user.id
  );
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});

// Verify a user's location — via in-app GPS capture ('gps') or a manually
// confirmed address ('manual'). Both set location_status='verified' so a
// platform location badge is granted.
router.post('/verify-location', requireAuth, (req, res) => {
  const { source, latitude, longitude, address, barangay, city, province, lat, lng } = req.body || {};
  const src = source === 'gps' ? 'gps' : 'manual';
  const la = latitude != null ? latitude : lat;
  const ln = longitude != null ? longitude : lng;
  const loc = require('../location');
  if (!loc.isCoord(la, ln)) {
    return res.status(400).json({ error: 'A valid coordinate is required to verify your location.' });
  }
  const now = Date.now();
  db.prepare(
    'UPDATE users SET latitude=?, longitude=?, address=?, barangay=?, city=?, province=?, location_status=?, location_verified_by=?, location_verified_at=? WHERE id=?'
  ).run(
    parseFloat(la), parseFloat(ln),
    address != null ? address : req.user.address,
    barangay != null ? barangay : req.user.barangay,
    city != null ? city : req.user.city,
    province != null ? province : req.user.province,
    'verified', src, now, req.user.id
  );
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});

router.post('/update', requireAuth, (req, res) => {
  const { full_name, avatar } = req.body || {};
  if (full_name) db.prepare('UPDATE users SET full_name=? WHERE id=?').run(full_name, req.user.id);
  if (avatar !== undefined) db.prepare('UPDATE users SET avatar=? WHERE id=?').run(avatar, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});

module.exports = router;
