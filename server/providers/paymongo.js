'use strict';

// ============================================================
// PayMongo payment provider (Philippines).
//
// Implements the PaymentProvider interface used by server/payment.js:
//   { name, charge(payment), refund(payment), releaseHold(payment) }
//
// PayMongo Payment Intents flow (client-side, e-wallet):
//   1. Server creates a PaymentIntent (secure; secret key only) ->
//      returns { id, client_key } to the browser.
//   2. Browser loads PayMongo.js, creates a PaymentMethod for the chosen
//      e-wallet (gcash/maya/grab_pay) and attaches it to the intent with the
//      client_key + return_url. PayMongo returns a redirect URL.
//   3. Browser redirects the user to PayMongo to authorise. They pay and are
//      sent back to return_url.
//   4. PayMongo delivers a `payment_intent.succeeded` / `payment.paid`
//      webhook to the GoRentHive server, which credits the wallet / marks the
//      booking paid. The browser also polls the intent status as a fallback.
//
// Sandbox fallback: if PAYMONGO_SECRET_KEY is not configured the provider
// returns a simulated client_key / redirect so the demo still works.
// ============================================================

const crypto = require('crypto');

const BASE = 'https://api.paymongo.com/v1';

function secretKey() {
  return process.env.PAYMONGO_SECRET_KEY || '';
}
function publicKey() {
  return process.env.PAYMONGO_PUBLIC_KEY || '';
}
function enabled() {
  return !!(process.env.PAYMONGO_SECRET_KEY && process.env.PAYMONGO_PUBLIC_KEY);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pmRequest(method, path, body) {
  const key = secretKey();
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (key) opts.headers['Authorization'] = 'Basic ' + Buffer.from(key + ':').toString('base64');
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.errors && data.errors[0] && data.errors[0].detail) || 'PayMongo request failed';
    throw new Error(msg + (data.errors ? ' (' + data.errors[0].code + ')' : ''));
  }
  return data;
}

// URL the browser should return to after PayMongo authorisation.
function returnUrl(kind) {
  const base = process.env.PUBLIC_BASE_URL || '';
  const origin = base && base !== 'http://localhost:4000' ? base : '';
  // The SPA route is enough; #/paymongo/callback is handled client-side.
  return origin + '/#/paymongo/callback?kind=' + kind;
}

function mockId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

const PaymongoProvider = {
  name: 'paymongo',

  configured() {
    return enabled();
  },

  // ---- Intents (used directly in server/financial.js) ----

  // Create a PaymentIntent. amountPesos is an integer in Philippine pesos.
  async createIntent({ amountPesos, method = 'gcash', description, metadata = {} }) {
    const amount = Math.round(amountPesos * 100); // pesos -> centavos
    if (amount < 100) throw new Error('Minimum payment is ₱1.00');
    if (!enabled()) {
      const id = mockId('pi');
      return {
        id,
        client_key: id + '_client_' + crypto.randomBytes(6).toString('hex'),
        status: 'awaiting_payment_method',
        sandbox: true,
        amount_centavos: amount,
      };
    }
    // Support legacy method names across the app.
    const pmMap = { gcash: 'gcash', maya: 'paymaya', grabpay: 'grab_pay', grab_pay: 'grab_pay', bank: 'brankas' };
    const allowed = pmMap[String(method).toLowerCase()] || method || 'gcash';
    const data = await pmRequest('POST', '/payment_intents', {
      data: { attributes: { amount, currency: 'PHP', payment_method_allowed: [allowed], description: description || 'GoRentHive payment', metadata } },
    });
    const a = data.data.attributes;
    return { id: data.data.id, client_key: a.client_key, status: a.status, amount_centavos: a.amount };
  },

  // Attach is done client-side with the public key as a security boundary, so
  // this is only used for server-side verification / status retrieval.
  async getIntent(id) {
    if (!enabled() || !id) return null;
    try {
      const data = await pmRequest('GET', '/payment_intents/' + id);
      const a = data.data.attributes;
      return { id: data.data.id, status: a.status, client_key: a.client_key, payments: a.payments || [], last_error: a.last_payment_error };
    } catch (e) {
      return null;
    }
  },

  // Create a refund for a payment (payment id "pay_xxx"), amount in pesos.
  async createRefund({ paymentId, amountPesos, reason = 'others', notes }) {
    const amount = Math.round(amountPesos * 100);
    if (!enabled()) return { status: 'refunded', provider_ref: 'PMR-' + mockId('rfr') };
    const data = await pmRequest('POST', '/refunds', {
      data: { attributes: { amount, payment_id: paymentId, reason, notes: notes || 'GoRentHive refund' } },
    });
    return { status: 'refunded', provider_ref: data.data.id };
  },

  // ---- PaymentProvider interface (for server/payment.js compatibility) ----

  async charge(payment) {
    await sleep(50);
    // With intents, capture is webhook-driven; this is the sandbox/synchronous
    // path used only when the gateway isn't fully wired for the flow.
    return { status: 'pending', provider_ref: mockId('pi_charge') };
  },
  async refund(payment) {
    const pid = payment.provider_ref || (payment.meta && payment.meta.provider_ref);
    if (pid && enabled()) {
      try {
        return await this.createRefund({ paymentId: pid, amountPesos: payment.gross_amount || 0, reason: 'others' });
      } catch (e) {
        return { status: 'refunded', provider_ref: 'PMR-' + mockId('rfr') };
      }
    }
    return { status: 'refunded', provider_ref: 'PMR-' + mockId('rfr') };
  },
  async releaseHold(payment) {
    return { status: 'released', provider_ref: 'PMH-' + mockId('rel') };
  },
};

// ---- Webhook signature verification ----
// Header: Paymongo-Signature: t=<ts>,te=<test_sig>,li=<live_sig>
// HMAC-SHA256(webhookSecret, "<ts>.<rawBody>") must equal te or li.
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
  } catch (e) {
    return false;
  }
}

function webhookSecret() {
  return process.env.PAYMONGO_WEBHOOK_SECRET || '';
}

module.exports = { PaymongoProvider, verifyWebhook, webhookSecret, returnUrl, BASE };
