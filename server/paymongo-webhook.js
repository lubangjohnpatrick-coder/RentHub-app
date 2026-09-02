'use strict';

// PayMongo webhook handler (mounted in server/index.js with express.raw).
// Verifies the Paymongo-Signature and reconciles successful payments against
// GoRentHive payment rows (topup / booking) using the stored intent id.

const { svcClient } = require('./supabase');
const { verifyWebhook, webhookSecret } = require('./providers/paymongo');
const ledger = require('./ledger');

const now = () => Date.now();

// Find a pending payment row by its PayMongo intent id (stored in meta).
async function findPaymentByIntent(intentId) {
  if (!intentId) return null;
  const { data, error } = await svcClient()
    .from('payments')
    .select('*')
    .filter('meta', 'like', '%' + intentId + '%')
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  try { data.meta = JSON.parse(data.meta || '{}'); } catch (e) { data.meta = {}; }
  return data;
}

// Finalise a payment that PayMongo reports as successfully paid.
async function settlePayment(payment, providerPaymentId, providerRef) {
  const userId = payment.user_id;

  // idempotency: only settle once
  if (payment.status === 'succeeded') return { status: 'already' };

  // Persist the provider ref before moving money.
  const meta = { ...(payment.meta || {}), provider_ref: providerRef || providerPaymentId };
  await svcClient().from('payments')
    .update({ status: 'succeeded', provider_ref: providerRef || providerPaymentId, meta: JSON.stringify(meta), updated_at: now() })
    .eq('id', payment.id);

  // Credit the wallet. Direct booking payments land as a wallet top-up so the
  // existing wallet-escrow booking flow can draw from the balance.
  await ledger.addEntry({ userId, type: 'topup', amount: payment.gross_amount, meta: { payment_ref: payment.payment_ref, paymongo: true } });
  return { status: 'succeeded' };
}

async function handleEvent(event) {
  const type = event.attributes && event.attributes.type;
  const resource = (event.attributes && event.attributes.data) || {};
  if (type === 'payment_intent.succeeded') {
    const intentId = resource.id;
    const payment = await findPaymentByIntent(intentId);
    if (!payment) return { handled: false, reason: 'no matching pending payment' };
    const payId = (resource.attributes && resource.attributes.payments && resource.attributes.payments[0] && resource.attributes.payments[0].id) || null;
    return { handled: true, result: await settlePayment(payment, payId, intentId) };
  }
  if (type === 'payment.paid') {
    // payment.paid gives the payment + payment_intent in attributes.
    const pm = resource.attributes || {};
    const intentId = pm.payment_intent && pm.payment_intent.id;
    const payment = await findPaymentByIntent(intentId);
    if (!payment) return { handled: false, reason: 'no matching pending payment' };
    return { handled: true, result: await settlePayment(payment, resource.id, resource.id) };
  }
  return { handled: false, reason: 'unhandled event ' + type };
}

async function handleWebhook(req, res) {
  try {
    const sig = req.headers['paymongo-signature'] || '';
    const secret = webhookSecret();
    const rawBody = req.body.toString('utf8');
    if (secret && !verifyWebhook(rawBody, sig, secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    const payload = JSON.parse(rawBody);
    const event = payload && payload.data && payload.data.attributes;
    if (!event) return res.status(400).json({ error: 'Malformed event' });
    await handleEvent(event);
    // Always ack quickly; PayMongo retries on non-2xx.
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('PayMongo webhook error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

module.exports = { handleWebhook, handleEvent, settlePayment, findPaymentByIntent };
