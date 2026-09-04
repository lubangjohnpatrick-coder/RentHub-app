'use strict';

const crypto = require('crypto');
const BASE = 'https://api.paymongo.com/v1';

function secretKey() { return process.env.PAYMONGO_SECRET_KEY || ''; }
function publicKey() { return process.env.PAYMONGO_PUBLIC_KEY || ''; }
function enabled() { return !!(secretKey() && publicKey()); }
function isProd() { return String(process.env.NODE_ENV || '').toLowerCase() === 'production'; }
function requireConfigured() {
  if (!enabled() && isProd()) throw new Error('PayMongo is not configured for production');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pmRequest(method, path, body) {
  requireConfigured();
  const key = secretKey();
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (key) opts.headers.Authorization = 'Basic ' + Buffer.from(key + ':').toString('base64');
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = data && data.errors && data.errors[0];
    const msg = (first && first.detail) || 'PayMongo request failed';
    throw new Error(msg + (first && first.code ? ' (' + first.code + ')' : ''));
  }
  return data;
}

function returnUrl(kind) {
  const base = process.env.PUBLIC_BASE_URL || '';
  const origin = base && base !== 'http://localhost:4000' ? base.replace(/\/$/, '') : '';
  return origin + '/#/paymongo/callback?kind=' + encodeURIComponent(kind || 'payment');
}
function mockId(prefix) { return prefix + '_' + crypto.randomBytes(8).toString('hex'); }

const PaymongoProvider = {
  name: 'paymongo',
  configured() { return enabled(); },

  async createIntent({ amountPesos, method = 'gcash', description, metadata = {} }) {
    const amount = Math.round(Number(amountPesos) * 100);
    if (!Number.isFinite(amount) || amount < 100) throw new Error('Minimum payment is ₱1.00');
    if (!enabled()) {
      requireConfigured();
      const id = mockId('pi');
      return { id, client_key: id + '_client_' + crypto.randomBytes(6).toString('hex'), status: 'awaiting_payment_method', sandbox: true, amount_centavos: amount };
    }
    const pmMap = { gcash: 'gcash', maya: 'paymaya', grabpay: 'grab_pay', grab_pay: 'grab_pay', bank: 'brankas' };
    const allowed = pmMap[String(method).toLowerCase()] || method || 'gcash';
    const data = await pmRequest('POST', '/payment_intents', {
      data: { attributes: { amount, currency: 'PHP', payment_method_allowed: [allowed], description: description || 'GoRentHive payment', metadata } },
    });
    const a = data.data.attributes;
    return { id: data.data.id, client_key: a.client_key, status: a.status, amount_centavos: a.amount, sandbox: false };
  },

  async getIntent(id) {
    if (!id) return null;
    if (!enabled()) { requireConfigured(); return null; }
    try {
      const data = await pmRequest('GET', '/payment_intents/' + encodeURIComponent(id));
      const a = data.data.attributes;
      return { id: data.data.id, status: a.status, client_key: a.client_key, payments: a.payments || [], last_error: a.last_payment_error };
    } catch (e) {
      if (isProd()) throw e;
      return null;
    }
  },

  async createRefund({ paymentId, amountPesos, reason = 'others', notes }) {
    const amount = Math.round(Number(amountPesos) * 100);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid refund amount');
    if (!enabled()) {
      requireConfigured();
      return { status: 'refunded', provider_ref: 'PMR-' + mockId('rfr') };
    }
    const data = await pmRequest('POST', '/refunds', {
      data: { attributes: { amount, payment_id: paymentId, reason, notes: notes || 'GoRentHive refund' } },
    });
    return { status: 'refunded', provider_ref: data.data.id };
  },

  async charge(payment) {
    await sleep(50);
    if (isProd()) throw new Error('Synchronous PayMongo charge fallback is disabled in production; use Payment Intents');
    return { status: 'pending', provider_ref: mockId('pi_charge') };
  },

  async refund(payment) {
    const pid = payment.provider_ref || (payment.meta && payment.meta.provider_ref);
    if (!pid && isProd()) throw new Error('Cannot refund payment without a PayMongo payment reference');
    if (pid) return this.createRefund({ paymentId: pid, amountPesos: payment.gross_amount || 0, reason: 'others' });
    requireConfigured();
    return { status: 'refunded', provider_ref: 'PMR-' + mockId('rfr') };
  },

  // PayMongo does not provide a generic legal escrow primitive here. GoRentHive
  // handles delayed owner wallet credit in its own ledger/state machine.
  async releaseHold(payment) {
    if (isProd()) return { status: 'released', provider_ref: payment && payment.provider_ref || '' };
    return { status: 'released', provider_ref: 'PMH-' + mockId('rel') };
  },
};

function verifyWebhook(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader || !webhookSecret) return false;
  const parts = {};
  signatureHeader.split(',').forEach((p) => {
    const eq = p.indexOf('=');
    if (eq > -1) parts[p.slice(0, eq).trim()] = p.slice(eq + 1);
  });
  const timestamp = parts.t;
  const sigToCheck = parts.li || parts.te;
  if (!timestamp || !sigToCheck) return false;
  try {
    const expected = crypto.createHmac('sha256', webhookSecret).update(timestamp + '.' + rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(sigToCheck);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}
function webhookSecret() { return process.env.PAYMONGO_WEBHOOK_SECRET || ''; }

module.exports = { PaymongoProvider, verifyWebhook, webhookSecret, returnUrl, BASE };
