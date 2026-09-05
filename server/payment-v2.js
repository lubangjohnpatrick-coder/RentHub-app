'use strict';

const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');
const payment = require('./payment');
const ledger = require('./ledger');
const { PaymongoProvider, returnUrl } = require('./providers/paymongo');
const { findPaymentByIntent, settlePayment } = require('./paymongo-webhook');

const router = express.Router();
const now = () => Date.now();
const isProd = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const allowedMethod = (value) => ['gcash', 'maya'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'gcash';
const safeJson = (value) => { try { return JSON.parse(value || '{}'); } catch (_) { return {}; } };

router.get('/paymongo/config', requireAuth, (req, res) => {
  const secret = String(process.env.PAYMONGO_SECRET_KEY || '');
  const publicKey = String(process.env.PAYMONGO_PUBLIC_KEY || '');
  const gateway = String(process.env.GATEWAY || '').toLowerCase();
  const live = /^sk_live_/i.test(secret) && /^pk_live_/i.test(publicKey);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    enabled: gateway === 'paymongo' && !!secret && !!publicKey && (!isProd() || live),
    publicKey: gateway === 'paymongo' ? publicKey : '',
    gateway,
    live,
    methods: ['gcash', 'maya'],
  });
});

router.post('/wallet/paymongo/topup', requireAuth, async (req, res) => {
  try {
    if (String(process.env.GATEWAY || '').toLowerCase() !== 'paymongo' || !PaymongoProvider.configured()) {
      return res.status(503).json({ error: 'PayMongo is not configured.' });
    }
    const amount = Math.round(Number(req.body.amount));
    const method = allowedMethod(req.body.method);
    if (!Number.isFinite(amount) || amount < 50 || amount > 500000) {
      return res.status(400).json({ error: 'Top-up amount must be between ₱50 and ₱500,000.' });
    }

    const pay = await payment.createPayment({
      userId: req.user.id,
      bookingId: null,
      type: 'topup',
      grossAmount: amount,
      platformFee: 0,
      method: 'paymongo',
      meta: { requested_method: method },
    });
    const intent = await PaymongoProvider.createIntent({
      amountPesos: amount,
      method,
      description: 'GoRentHive wallet top-up ' + pay.payment_ref,
      metadata: { payment_ref: pay.payment_ref, user_id: String(req.user.id), purpose: 'wallet_topup' },
    });
    const meta = {
      ...safeJson(pay.meta),
      paymongo_intent_id: intent.id,
      paymongo_kind: 'topup',
      requested_method: method,
      return_url: returnUrl('topup'),
    };
    await svcClient().from('payments').update({ meta: JSON.stringify(meta), updated_at: now() }).eq('id', pay.id);

    res.json({
      ok: true,
      sandbox: !!intent.sandbox,
      payment_id: pay.id,
      client_key: intent.client_key,
      intent_id: intent.id,
      amount,
      method,
      return_url: meta.return_url,
    });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] PayMongo top-up intent failed`, e);
    res.status(502).json({ error: 'Could not start the payment. Please try again.', request_id: req.requestId });
  }
});

router.post('/paymongo/confirm', requireAuth, async (req, res) => {
  try {
    const intentId = String(req.body.intent_id || '').trim();
    const paymentId = Number(req.body.payment_id);
    let pay = null;

    if (Number.isFinite(paymentId) && paymentId > 0) {
      const { data, error } = await svcClient().from('payments').select('*').eq('id', paymentId).limit(1).maybeSingle();
      if (!error && data) { data.meta = safeJson(data.meta); pay = data; }
    }
    if (!pay && intentId) pay = await findPaymentByIntent(intentId);
    if (!pay) return res.status(404).json({ error: 'Payment not found.' });
    if (String(pay.user_id) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'This payment belongs to another account.' });
    }

    const meta = typeof pay.meta === 'object' ? pay.meta : safeJson(pay.meta);
    const storedIntent = String(meta.paymongo_intent_id || '');
    if (intentId && storedIntent && intentId !== storedIntent) {
      return res.status(400).json({ error: 'Payment intent does not match this payment.' });
    }

    if (pay.status !== 'succeeded') {
      const targetIntent = intentId || storedIntent;
      if (!targetIntent) return res.status(400).json({ error: 'Payment intent is missing.' });
      const intent = await PaymongoProvider.getIntent(targetIntent);
      if (!intent || intent.status !== 'succeeded') {
        return res.json({ ok: true, status: intent && intent.status ? intent.status : 'pending', payment_status: pay.status });
      }
      await settlePayment(pay, targetIntent, targetIntent);
    }

    const balance = await ledger.getUserBalance(pay.user_id);
    const bookingDraft = meta.paymongo_kind === 'booking' && meta.booking_draft && typeof meta.booking_draft === 'object'
      ? meta.booking_draft : null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      status: 'succeeded',
      balance,
      payment_id: pay.id,
      payment_ref: pay.payment_ref,
      kind: meta.paymongo_kind || pay.type || 'payment',
      booking_draft: bookingDraft,
    });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] PayMongo confirmation failed`, e);
    res.status(502).json({ error: 'Could not confirm the payment. Please try again.', request_id: req.requestId });
  }
});

module.exports = router;
module.exports._test = { allowedMethod };
