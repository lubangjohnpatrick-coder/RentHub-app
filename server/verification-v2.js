'use strict';

// Production-safe verification compatibility routes. Mounted before private.js.
// In production no OTP/token is ever returned in the API response. Delivery is
// delegated to configured HTTPS sender webhooks so GoRentHive can use any
// approved Philippine SMS/email provider without embedding credentials/client
// SDKs in the browser.

const express = require('express');
const crypto = require('crypto');
const { svcClient } = require('./supabase');
const { requireAuth, loadUserById } = require('./auth-service');

const router = express.Router();
const now = () => Date.now();
const MOBILE_TTL = 10 * 60 * 1000;
const EMAIL_TTL = 30 * 60 * 1000;
const COOLDOWN = 60 * 1000;
const sentAt = new Map();

function isProd() { return String(process.env.NODE_ENV || '').toLowerCase() === 'production'; }
function hash(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }

function cooldownKey(userId, channel) { return `${userId}:${channel}`; }
function checkCooldown(userId, channel) {
  const key = cooldownKey(userId, channel);
  const last = sentAt.get(key) || 0;
  if (now() - last < COOLDOWN) return Math.ceil((COOLDOWN - (now() - last)) / 1000);
  sentAt.set(key, now());
  return 0;
}

async function sendWebhook(url, secret, payload) {
  if (!url) return false;
  const headers = { 'content-type': 'application/json' };
  if (secret) headers.authorization = `Bearer ${secret}`;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Verification sender returned HTTP ${response.status}`);
  return true;
}

router.post('/auth/verify/mobile/send', requireAuth, async (req, res) => {
  try {
    const wait = checkCooldown(req.user.id, 'mobile');
    if (wait) return res.status(429).json({ error: `Please wait ${wait}s before requesting another code.` });
    const phone = String(req.user.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'Add a mobile number to your account first.' });

    const code = String(crypto.randomInt(100000, 1000000));
    await svcClient().from('otps').insert({ user_id: req.user.id, channel: 'mobile', code_hash: hash(code), created_at: now() });

    const sent = await sendWebhook(process.env.SMS_SENDER_WEBHOOK_URL, process.env.SMS_SENDER_WEBHOOK_SECRET, {
      to: phone,
      message: `Your GoRentHive verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
      purpose: 'gorenthive_mobile_verification',
    });
    if (!sent && isProd()) return res.status(503).json({ error: 'SMS verification is not configured yet. Contact GoRentHive support.', code: 'sms_provider_required' });
    res.json(isProd() ? { ok: true } : { ok: true, demoCode: code });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/auth/verify/mobile/resend', requireAuth, async (req, res, next) => {
  // Reuse the send implementation internally without exposing the legacy no-op.
  req.url = '/auth/verify/mobile/send';
  next('route');
});

router.post('/auth/verify/mobile', requireAuth, async (req, res) => {
  const code = String(req.body.code || '').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit verification code.' });
  const { data } = await svcClient().from('otps').select('*').eq('user_id', req.user.id).eq('channel', 'mobile').order('created_at', { ascending: false }).limit(1);
  const otp = (data || [])[0];
  if (!otp || otp.used || now() - Number(otp.created_at || 0) > MOBILE_TTL) return res.status(400).json({ error: 'The code is invalid or expired.' });
  if (otp.code_hash !== hash(code)) return res.status(400).json({ error: 'Incorrect verification code.' });
  await svcClient().from('otps').update({ used: true }).eq('id', otp.id);
  await svcClient().from('users').update({ mobile_verified: true, identity_level: Math.max(2, Number(req.user.identity_level || 1)), updated_at: now() }).eq('id', req.user.id);
  const u = await loadUserById(req.user.id);
  res.json({ ok: true, user: u });
});

router.post('/auth/verify/email/send', requireAuth, async (req, res) => {
  try {
    const wait = checkCooldown(req.user.id, 'email');
    if (wait) return res.status(429).json({ error: `Please wait ${wait}s before requesting another verification email.` });
    const email = String(req.user.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Add an email address to your account first.' });

    const token = crypto.randomBytes(24).toString('hex');
    await svcClient().from('email_verifications').insert({ user_id: req.user.id, token: hash(token), created_at: now() });
    const verifyUrl = `${String(process.env.PUBLIC_BASE_URL || 'https://gorenthive.online').replace(/\/$/, '')}/verify?token=${encodeURIComponent(token)}`;
    const sent = await sendWebhook(process.env.EMAIL_SENDER_WEBHOOK_URL, process.env.EMAIL_SENDER_WEBHOOK_SECRET, {
      to: email,
      subject: 'Verify your GoRentHive email',
      text: `Verify your GoRentHive email using this token: ${token}\n\nVerification link: ${verifyUrl}\n\nThis verification expires in 30 minutes.`,
      purpose: 'gorenthive_email_verification',
    });
    if (!sent && isProd()) return res.status(503).json({ error: 'Email verification is not configured yet. Contact GoRentHive support.', code: 'email_provider_required' });
    res.json(isProd() ? { ok: true } : { ok: true, demoToken: token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/auth/verify/email', requireAuth, async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Verification token is required.' });
  const { data } = await svcClient().from('email_verifications').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(1);
  const ev = (data || [])[0];
  if (!ev || ev.used || now() - Number(ev.created_at || 0) > EMAIL_TTL || ev.token !== hash(token)) return res.status(400).json({ error: 'The email verification is invalid or expired.' });
  await svcClient().from('email_verifications').update({ used: true }).eq('id', ev.id);
  await svcClient().from('users').update({ email_verified: true, updated_at: now() }).eq('id', req.user.id);
  const u = await loadUserById(req.user.id);
  res.json({ ok: true, user: u });
});

module.exports = router;
