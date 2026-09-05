'use strict';

// PayMongo webhook handler (mounted in server/index.js with express.raw).
// Production rule: webhook authentication fails CLOSED. A missing webhook
// secret must never make an unsigned callback acceptable.

const { svcClient } = require('./supabase');
const { verifyWebhook, webhookSecret } = require('./providers/paymongo');

async function findPaymentByIntent(intentId) {
  if (!intentId) return null;
  // Do not require pending here: the browser callback may race the webhook and
  // still needs to discover an already-settled payment safely.
  const { data, error } = await svcClient()
    .from('payments').select('*').filter('meta', 'like', '%' + String(intentId).replace(/[%_]/g, '') + '%')
    .limit(1).maybeSingle();
  if (error || !data) return null;
  try { data.meta = JSON.parse(data.meta || '{}'); } catch (e) { data.meta = {}; }
  return data;
}

async function settlePayment(payment, providerPaymentId, providerRef) {
  if (!payment) throw new Error('Payment is required');
  const ref = providerRef || providerPaymentId || '';

  // settle_payment_credit locks the payment + user wallet and performs the
  // pending->succeeded transition and wallet credit in a single transaction.
  // This prevents webhook/browser-confirm races from double-crediting wallets.
  const { data, error } = await svcClient().rpc('settle_payment_credit', {
    p_payment_id: payment.id,
    p_provider_ref: ref,
  });
  if (error) throw new Error('Payment settlement failed: ' + error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const status = row && row.settlement_status ? row.settlement_status : 'unknown';
  return { status, balance: row && row.new_balance != null ? row.new_balance : null };
}

async function handleEvent(event) {
  const type = event.attributes && event.attributes.type;
  const resource = (event.attributes && event.attributes.data) || {};
  if (type === 'payment_intent.succeeded') {
    const intentId = resource.id;
    const payment = await findPaymentByIntent(intentId);
    if (!payment) return { handled: false, reason: 'no matching payment' };
    const payId = resource.attributes && resource.attributes.payments && resource.attributes.payments[0] && resource.attributes.payments[0].id;
    return { handled: true, result: await settlePayment(payment, payId || null, intentId) };
  }
  if (type === 'payment.paid') {
    const pm = resource.attributes || {};
    const intentId = pm.payment_intent && pm.payment_intent.id;
    const payment = await findPaymentByIntent(intentId);
    if (!payment) return { handled: false, reason: 'no matching payment' };
    return { handled: true, result: await settlePayment(payment, resource.id, resource.id) };
  }
  return { handled: false, reason: 'unhandled event ' + type };
}

async function handleWebhook(req, res) {
  try {
    const sig = req.headers['paymongo-signature'] || '';
    const secret = webhookSecret();
    if (!secret) {
      console.error('PayMongo webhook rejected: PAYMONGO_WEBHOOK_SECRET is not configured');
      return res.status(503).json({ error: 'Payment webhook is not configured' });
    }
    const rawBody = req.body.toString('utf8');
    if (!verifyWebhook(rawBody, sig, secret)) return res.status(401).json({ error: 'Invalid signature' });

    const payload = JSON.parse(rawBody);
    const event = payload && payload.data && payload.data.attributes;
    if (!event) return res.status(400).json({ error: 'Malformed event' });
    await handleEvent(event);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('PayMongo webhook error:', e.message);
    return res.status(500).json({ error: 'Payment webhook processing failed' });
  }
}

module.exports = { handleWebhook, handleEvent, settlePayment, findPaymentByIntent };
