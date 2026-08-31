'use strict';

// Real verification system: OTP (phone), email tokens, identity review, rate limiting.
// Messaging is provider-agnostic (sendSms / sendEmail) so Twilio / SendGrid can be
// plugged in without touching the rest of the app. A sandbox transport logs the code
// and (for dev only) returns a demo code so flows can be exercised.

const db = require('./db/schema');
const crypto = require('crypto');

// ---------------- Provider-agnostic messaging ----------------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const transports = {
  sandboxSms: async (phone, code) => {
    await sleep(80);
    // In case onboarding a real provider, this is where Twilio.send would go.
    console.log(`[VERIFY][SMS] to ${phone} -> code ${code}`);
  },
  sandboxEmail: async (to, subject, body) => {
    await sleep(60);
    console.log(`[VERIFY][EMAIL] to ${to}: ${subject}`);
  },
};
let smsTransport = transports.sandboxSms;
let emailTransport = transports.sandboxEmail;
const setSmsTransport = (fn) => { smsTransport = fn; };
const setEmailTransport = (fn) => { emailTransport = fn; };

// ---------------- Simple in-memory rate limiter ----------------
// key -> { count, resetAt }
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

// ---------------- Hashing ----------------
function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// ---------------- Mobile OTP ----------------
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

function sendMobileOtp(userId, phone) {
  // rate-limit sends (5 per 10 min per user)
  if (!rateLimit(`otp:${userId}`, 5, 10 * 60 * 1000)) {
    return { error: 'Too many requests. Please wait a few minutes before requesting a new code.' };
  }
  const code = String(crypto.randomInt(100000, 1000000)); // 6-digit
  db.prepare(
    'INSERT INTO otps (user_id, channel, code_hash, attempts, max_attempts, expires_at, used, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(userId, 'mobile', sha256(code), 0, OTP_MAX_ATTEMPTS, Date.now() + OTP_TTL_MS, 0, JSON.stringify({ phone: phone || '' }), Date.now());
  smsTransport(phone, code);
  // Sandbox only: expose the code so dev/demo can complete the flow.
  return { ok: true, demoCode: code };
}

function confirmMobileOtp(userId, code) {
  if (!code || String(code).length < 4) return { error: 'Enter the 6-digit code you received.' };
  const row = db.prepare(
    "SELECT * FROM otps WHERE user_id=? AND channel='mobile' AND used=0 ORDER BY id DESC LIMIT 1"
  ).get(userId);
  if (!row) return { error: 'No pending verification. Request a new code.' };
  if (row.expires_at < Date.now()) return { error: 'Code expired. Request a new one.' };
  if (row.attempts >= row.max_attempts) return { error: 'Too many attempts. Request a new code.' };
  if (sha256(String(code).trim()) !== row.code_hash) {
    db.prepare('UPDATE otps SET attempts=attempts+1 WHERE id=?').run(row.id);
    const left = row.max_attempts - (row.attempts + 1);
    return { error: left > 0 ? `Incorrect code. ${left} attempt(s) left.` : 'Too many attempts. Request a new code.' };
  }
  db.prepare('UPDATE otps SET used=1 WHERE id=?').run(row.id);
  db.prepare('UPDATE users SET mobile_verified=1, identity_level = MAX(identity_level, 2) WHERE id=?').run(userId);
  return { ok: true };
}

// ---------------- Email verification (token link) ----------------
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function sendEmailVerification(userId, email) {
  if (!rateLimit(`email:${userId}`, 5, 10 * 60 * 1000)) {
    return { error: 'Too many requests. Please wait a few minutes.' };
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO email_verifications (user_id, token, expires_at, used, created_at) VALUES (?,?,?,?,?)').run(
    userId, sha256(token), Date.now() + EMAIL_TOKEN_TTL_MS, 0, Date.now()
  );
  const verifyUrl = `https://gorenthive.online/verify/email?token=${token}`;
  emailTransport(email, 'Verify your GoRentHive email', `Click to verify: ${verifyUrl}`);
  return { ok: true, demoToken: token };
}

function confirmEmailToken(userId, token) {
  if (!token) return { error: 'Missing verification token.' };
  const row = db.prepare(
    "SELECT * FROM email_verifications WHERE user_id=? AND used=0 ORDER BY id DESC LIMIT 1"
  ).get(userId);
  if (!row) return { error: 'No pending email verification.' };
  if (sha256(String(token).trim()) !== row.token) return { error: 'Invalid verification link.' };
  if (row.expires_at < Date.now()) return { error: 'Verification link expired. Request a new one.' };
  db.prepare('UPDATE email_verifications SET used=1 WHERE id=?').run(row.id);
  db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(userId);
  return { ok: true };
}

// ---------------- Completeness helpers ----------------
function verificationStatus(user) {
  const missing = [];
  if (!user.email_verified) missing.push('email');
  if (!user.mobile_verified) missing.push('mobile');
  if (user.identity_status !== 'verified') missing.push('identity');
  return { verified: missing.length === 0, missing };
}

function isFullyVerified(user) {
  return !!(user.email_verified && user.mobile_verified && user.identity_status === 'verified');
}

function meetsLevel(user, level) {
  const lvl = parseInt(level || '1', 10);
  return (parseInt(user.identity_level, 10) || 1) >= lvl;
}

// ---------------- Terms acceptance ----------------
function hasAcceptedTerms(user) {
  const v = require('./settings').getSetting('terms_version', '1');
  return (user.last_terms_accepted || '') === `terms:${v}`;
}

function acceptTerms(userId) {
  const v = require('./settings').getSetting('terms_version', '1');
  db.prepare(
    'INSERT OR REPLACE INTO user_terms_acceptance (user_id, terms_type, version, accepted_at) VALUES (?,?,?,?)'
  ).run(userId, 'terms', parseInt(v, 10) || 1, Date.now());
  db.prepare('UPDATE users SET last_terms_accepted=? WHERE id=?').run(`terms:${v}`, userId);
}

module.exports = {
  sendMobileOtp,
  confirmMobileOtp,
  sendEmailVerification,
  confirmEmailToken,
  verificationStatus,
  isFullyVerified,
  meetsLevel,
  hasAcceptedTerms,
  acceptTerms,
  rateLimit,
  setSmsTransport,
  setEmailTransport,
};
