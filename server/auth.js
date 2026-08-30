'use strict';

const db = require('./db/schema');
const crypto = require('crypto');
const trust = require('./trust');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashPassword(plain) {
  const bcrypt = require('bcryptjs');
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  const bcrypt = require('bcryptjs');
  return bcrypt.compareSync(plain, hash);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)'
  ).run(token, userId, now, now + SESSION_TTL_MS);
  // clean old sessions
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  return token;
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
}

function getSessionUser(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(token);
  if (!s) return null;
  if (s.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
    return null;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  return user || null;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    full_name: u.full_name,
    avatar: u.avatar,
    role: u.role,
    is_owner: u.is_owner,
    is_business: u.is_business,
    mobile_verified: u.mobile_verified,
    email_verified: u.email_verified,
    identity_status: u.identity_status,
    identity_level: u.identity_level,
    address: u.address,
    barangay: u.barangay,
    city: u.city,
    province: u.province,
    location_verified: u.location_status === 'verified',
    location_status: u.location_status,
    location_verified_by: u.location_verified_by,
    vessel_rating: u.vessel_rating,
    review_count: u.review_count,
    successful_rentals: u.successful_rentals,
    cancelled_rentals: u.cancelled_rentals,
    trust_score: trust.trustScore(u),
    trust_level: trust.trustLevel(trust.trustScore(u)),
    successful_return_rate: trust.successfulReturnRate(u),
    verificationBadge: identityBadge(u),
    locationBadge: locationBadge(u),
  };
}

function locationBadge(u) {
  if (u.location_status === 'verified') {
    return u.location_verified_by === 'gps' ? '📍 GPS Verified' : '📍 Address Verified';
  }
  return null;
}

function identityBadge(u) {
  if (u.identity_status === 'verified' && u.identity_level >= 3) return 'Verified';
  if (parseInt(u.successful_rentals, 10) >= 10 && u.vessel_rating >= 4.5) return 'Trusted';
  return null;
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.session;
  const user = getSessionUser(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (user.suspended || user.banned) {
    return res.status(403).json({ error: 'This account has been restricted. Contact support.' });
  }
  req.user = user;
  req.sessionToken = token;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function touchUser(id) {
  db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(Date.now(), id);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getSessionUser,
  publicUser,
  requireAuth,
  requireAdmin,
  identityBadge,
  locationBadge,
  touchUser,
  SESSION_TTL_MS,
};
