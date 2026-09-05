'use strict';

// Production-safe verification routes. Mounted before private.js.
// In production no OTP/token is ever returned in the API response. Delivery is
// delegated to configured HTTPS sender webhooks so provider credentials stay
// server-side and GoRentHive fails closed when verification is unavailable.

const express = require('express');
const crypto = require('crypto');
const { svcClient } = require('./supabase');
const { requireAuth, loadUserById } = require('./auth-service');

const router = express.Router();
const now = () => Date.now();
const MOBILE_TTL = 10 * 60 * 1000;
const EMAIL_TTL = 30 * 60 * 1000;
const COOLDOWN = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
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

function normalizePhone(value) {
  let phone = String(value || '').trim().replace(/[\s().-]/g, '');
  if (/^09\d{9}$/.test(phone)) phone = '+63' + phone.slice(1);
  else if (/^639\d{9}$/.test(phone)) phone = '+' + phone;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  return phone;
}

async function sendWebhook(url, secret, payload) {
  if (!url) return false;
  const headers = { 'content-type': 'application/json' };
  if (secret) headers.authorization = `Bearer ${secret}`;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Verification sender returned HTTP ${response.status}`);
  return true;
}

async function sendMobile(req, res) {
  try {
    if (req.user.mobile_verified) return res.json({ ok: true, alreadyVerified: true });
    const wait = checkCooldown(req.user.id, 'mobile');
    if (wait) return res.status(429).json({ error: `Please wait ${wait}s before requesting another code.` });

    const phone = normalizePhone(req.user.phone);
    if (!phone) {
      return res.status(400).json({
        error: 'Add a valid mobile number to your account first. Philippine numbers may be entered as 09XXXXXXXXX or +639XXXXXXXXX.',
        code: 'mobile_number_required',
      });
    }

    // Keep the canonical E.164 form in the marketplace profile.
    if (phone !== String(req.user.phone || '').trim()) {
      const { error } = await svcClient().from('users').update({ phone, updated_at: now() }).eq('id', req.user.id);
      if (!error) req.user.phone = phone;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const sent = await sendWebhook(process.env.SMS_SENDER_WEBHOOK_URL, process.env.SMS_SENDER_WEBHOOK_SECRET, {
      to: phone,
      message: `Your GoRentHive verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
      purpose: 'gorenthive_mobile_verification',
    });
    if (!sent && isProd()) {
      return res.status(503).json({
        error: 'SMS verification is not configured yet. An SMS provider must be connected before mobile numbers can be verified.',
        code: 'sms_provider_required',
      });
    }

    const createdAt = now();
    const { error: insertError } = await svcClient().from('otps').insert({
      user_id: req.user.id,
      channel: 'mobile',
      code_hash: hash(code),
      attempts: 0,
      max_attempts: MAX_OTP_ATTEMPTS,
      expires_at: createdAt + MOBILE_TTL,
      used: false,
      meta: JSON.stringify({ destination: phone }),
      created_at: createdAt,
    });
    if (insertError) throw insertError;

    return res.json(isProd() ? { ok: true } : { ok: true, demoCode: code });
  } catch (e) {
    return res.status(502).json({ error: 'Could not send verification code. Please try again.', detail: isProd() ? undefined : e.message });
  }
}

router.post('/auth/verify/mobile/send', requireAuth, sendMobile);
router.post('/auth/verify/mobile/resend', requireAuth, sendMobile);

router.post('/auth/verify/mobile', requireAuth, async (req, res) => {
  try {
    if (req.user.mobile_verified) return res.json({ ok: true, user: req.user, alreadyVerified: true });
    const code = String(req.body.code || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit verification code.' });

    const { data, error } = await svcClient().from('otps').select('*')
      .eq('user_id', req.user.id)
      .eq('channel', 'mobile')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;

    const otp = (data || [])[0];
    const expiresAt = Number(otp && otp.expires_at || 0);
    const attempts = Number(otp && otp.attempts || 0);
    const maxAttempts = Number(otp && otp.max_attempts || MAX_OTP_ATTEMPTS);
    if (!otp || otp.used || !expiresAt || now() > expiresAt) {
      return res.status(400).json({ error: 'The code is invalid or expired.' });
    }
    if (attempts >= maxAttempts) {
      return res.status(429).json({ error: 'Too many incorrect attempts. Request a new verification code.' });
    }
    if (otp.code_hash !== hash(code)) {
      await svcClient().from('otps').update({ attempts: attempts + 1 }).eq('id', otp.id);
      return res.status(400).json({ error: 'Incorrect verification code.' });
    }

    await svcClient().from('otps').update({ used: true }).eq('id', otp.id);
    await svcClient().from('users').update({
      mobile_verified: true,
      identity_level: Math.max(2, Number(req.user.identity_level || 1)),
      updated_at: now(),
    }).eq('id', req.user.id);
    const u = await loadUserById(req.user.id);
    return res.json({ ok: true, user: u });
  } catch (e) {
    return res.status(500).json({ error: 'Could not verify the mobile number. Please try again.' });
  }
});

async function sendEmail(req, res) {
  try {
    if (req.user.email_verified) return res.json({ ok: true, alreadyVerified: true });
    const wait = checkCooldown(req.user.id, 'email');
    if (wait) return res.status(429).json({ error: `Please wait ${wait}s before requesting another verification email.` });
    const email = String(req.user.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Add an email address to your account first.' });

    const token = crypto.randomBytes(24).toString('hex');
    const verifyUrl = `${String(process.env.PUBLIC_BASE_URL || 'https://gorenthive.online').replace(/\/$/, '')}/verify?token=${encodeURIComponent(token)}`;
    const sent = await sendWebhook(process.env.EMAIL_SENDER_WEBHOOK_URL, process.env.EMAIL_SENDER_WEBHOOK_SECRET, {
      to: email,
      subject: 'Verify your GoRentHive email',
      text: `Verify your GoRentHive email using this token: ${token}\n\nVerification link: ${verifyUrl}\n\nThis verification expires in 30 minutes.`,
      purpose: 'gorenthive_email_verification',
    });
    if (!sent && isProd()) {
      return res.status(503).json({
        error: 'Email verification is not configured yet. An email sender must be connected before email addresses can be verified.',
        code: 'email_provider_required',
      });
    }

    const createdAt = now();
    const { error: insertError } = await svcClient().from('email_verifications').insert({
      user_id: req.user.id,
      token: hash(token),
      expires_at: createdAt + EMAIL_TTL,
      used: false,
      created_at: createdAt,
    });
    if (insertError) throw insertError;

    return res.json(isProd() ? { ok: true } : { ok: true, demoToken: token });
  } catch (e) {
    return res.status(502).json({ error: 'Could not send verification email. Please try again.', detail: isProd() ? undefined : e.message });
  }
}

router.post('/auth/verify/email/send', requireAuth, sendEmail);
router.post('/auth/verify/email/resend', requireAuth, sendEmail);

router.post('/auth/verify/email', requireAuth, async (req, res) => {
  try {
    if (req.user.email_verified) return res.json({ ok: true, user: req.user, alreadyVerified: true });
    const token = String(req.body.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Verification token is required.' });

    const { data, error } = await svcClient().from('email_verifications').select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;

    const ev = (data || [])[0];
    const expiresAt = Number(ev && ev.expires_at || 0);
    if (!ev || ev.used || !expiresAt || now() > expiresAt || ev.token !== hash(token)) {
      return res.status(400).json({ error: 'The email verification is invalid or expired.' });
    }

    await svcClient().from('email_verifications').update({ used: true }).eq('id', ev.id);
    await svcClient().from('users').update({ email_verified: true, updated_at: now() }).eq('id', req.user.id);
    const u = await loadUserById(req.user.id);
    return res.json({ ok: true, user: u });
  } catch (e) {
    return res.status(500).json({ error: 'Could not verify the email address. Please try again.' });
  }
});

module.exports = router;
