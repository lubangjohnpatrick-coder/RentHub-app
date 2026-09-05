'use strict';

const express = require('express');
const { svcClient } = require('./supabase');

const router = express.Router();
const REQUIRED_BUCKETS = ['listing-photos', 'profile-photos', 'rental-evidence', 'identity-docs'];
const CACHE_MS = 30 * 1000;
let cached = null;
let cachedAt = 0;

function configured(value, placeholders = []) {
  const v = String(value || '').trim();
  return !!v && !placeholders.includes(v);
}

function httpsConfigured(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  try { return new URL(v).protocol === 'https:'; } catch (_) { return false; }
}

function strongSecret(value) {
  const v = String(value || '').trim();
  return v.length >= 32 && !['change-me', 'your-app-secret'].includes(v);
}

function paymentConfig() {
  const secret = String(process.env.PAYMONGO_SECRET_KEY || '');
  const webhook = String(process.env.PAYMONGO_WEBHOOK_SECRET || '');
  return {
    gateway: String(process.env.GATEWAY || '').toLowerCase() === 'paymongo',
    secretConfigured: configured(secret, ['your-paymongo-secret-key']),
    webhookConfigured: configured(webhook, ['your-paymongo-webhook-secret']),
    liveKey: /^sk_live_/i.test(secret),
  };
}

async function databaseCheck(client) {
  try {
    const { error } = await client.from('listings').select('id', { head: true, count: 'exact' }).limit(1);
    return { ok: !error };
  } catch (_) {
    return { ok: false };
  }
}

async function storageCheck(client) {
  try {
    const { data, error } = await client.storage.listBuckets();
    if (error) return { ok: false, required: REQUIRED_BUCKETS.length, found: 0 };
    const names = new Set((data || []).map((b) => b.name));
    const missing = REQUIRED_BUCKETS.filter((name) => !names.has(name));
    return { ok: missing.length === 0, required: REQUIRED_BUCKETS.length, found: REQUIRED_BUCKETS.length - missing.length };
  } catch (_) {
    return { ok: false, required: REQUIRED_BUCKETS.length, found: 0 };
  }
}

async function buildReadiness() {
  const production = process.env.NODE_ENV === 'production';
  const canonical = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') === 'https://gorenthive.online';
  const supabaseConfigured = configured(process.env.SUPABASE_URL)
    && configured(process.env.SUPABASE_SERVICE_ROLE_KEY, ['your-service-role-key'])
    && configured(process.env.SUPABASE_ANON_KEY, ['your-project-anon-key']);
  const appSecretConfigured = strongSecret(process.env.APP_SECRET);
  const smsSenderConfigured = httpsConfigured(process.env.SMS_SENDER_WEBHOOK_URL);
  const emailSenderConfigured = httpsConfigured(process.env.EMAIL_SENDER_WEBHOOK_URL);
  const payments = paymentConfig();

  let database = { ok: false };
  let storage = { ok: false, required: REQUIRED_BUCKETS.length, found: 0 };
  if (supabaseConfigured) {
    try {
      const client = svcClient();
      [database, storage] = await Promise.all([databaseCheck(client), storageCheck(client)]);
    } catch (_) {
      // Keep failed status. Never expose underlying secret/config errors here.
    }
  }

  const checks = {
    production,
    canonical,
    supabase: supabaseConfigured,
    database: database.ok,
    storage: storage.ok,
    appSecret: appSecretConfigured,
    paymentGateway: payments.gateway,
    paymentSecret: payments.secretConfigured,
    paymentLiveKey: production ? payments.liveKey : payments.secretConfigured,
    paymentWebhook: payments.webhookConfigured,
    smsVerificationSender: production ? smsSenderConfigured : true,
    emailVerificationSender: production ? emailSenderConfigured : true,
  };
  const ready = Object.values(checks).every(Boolean);
  return {
    ok: ready,
    service: 'GoRentHive',
    readiness: ready ? 'ready' : 'not_ready',
    checks,
    storage: { required: storage.required, found: storage.found },
    paymentMode: payments.liveKey ? 'live-key-configured' : (payments.secretConfigured ? 'non-live-key-configured' : 'not-configured'),
    checkedAt: new Date().toISOString(),
  };
}

router.get('/health/readiness', async (req, res) => {
  try {
    const now = Date.now();
    if (!cached || now - cachedAt > CACHE_MS) {
      cached = await buildReadiness();
      cachedAt = now;
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(cached.ok ? 200 : 503).json(cached);
  } catch (_) {
    return res.status(503).json({ ok: false, service: 'GoRentHive', readiness: 'not_ready' });
  }
});

module.exports = router;
module.exports.buildReadiness = buildReadiness;
