'use strict';

// Provider-agnostic payment gateway (server only, Supabase-backed).
// Providers implement: { name, charge(), refund(), releaseHold() }.
// Default: sandbox. Set GATEWAY=gcash (+ GCASH_CLIENT_ID/GCASH_SECRET) in
// server/.env to use the real GCash integration path.

const crypto = require('crypto');
const { svcClient } = require('./supabase');

const SandboxProvider = {
  name: 'sandbox',
  async charge(payment) {
    await sleep(60);
    return { status: 'succeeded', provider_ref: 'SB-' + crypto.randomBytes(5).toString('hex').toUpperCase() };
  },
  async refund(payment) {
    await sleep(40);
    return { status: 'refunded', provider_ref: 'SBR-' + crypto.randomBytes(4).toString('hex').toUpperCase() };
  },
  async releaseHold(payment) {
    await sleep(30);
    return { status: 'released', provider_ref: 'SBH-' + crypto.randomBytes(4).toString('hex').toUpperCase() };
  },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class Gateway {
  constructor() {
    this.provider = this._pick();
  }
  _pick() {
    const name = (process.env.GATEWAY || 'sandbox').toLowerCase();
    if (name === 'gcash') {
      const { GcashProvider } = require('./providers/gcash');
      return GcashProvider;
    }
    return SandboxProvider;
  }
  async charge(payment) {
    return this.provider.charge(payment);
  }
  async refund(payment) {
    return this.provider.refund(payment);
  }
  async releaseHold(payment) {
    return this.provider.releaseHold(payment);
  }
}

const gateway = new Gateway();

async function createPayment({ userId, bookingId, type, grossAmount, platformFee = 0, method, meta = {} }) {
  const ref = 'PAY-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const netAmount = grossAmount - platformFee;
  const now = Date.now();
  const { data, error } = await svcClient()
    .from('payments')
    .insert({
      payment_ref: ref, user_id: userId, booking_id: bookingId || null, type,
      method: method || gateway.provider.name, status: 'pending',
      gross_amount: grossAmount, platform_fee: platformFee, net_amount: netAmount,
      meta: JSON.stringify(meta), created_at: now, updated_at: now,
    })
    .select()
    .single();
  if (error) throw new Error('createPayment: ' + error.message);
  return data;
}

async function executeCharge(payment) {
  const res = await gateway.charge(payment);
  await svcClient().from('payments')
    .update({ status: res.status, updated_at: Date.now() })
    .eq('id', payment.id);
  return { ...payment, status: res.status, provider_ref: res.provider_ref, authorization_url: res.authorization_url };
}

async function getPayment(paymentRef) {
  const { data, error } = await svcClient()
    .from('payments').select('*').eq('payment_ref', paymentRef).limit(1).maybeSingle();
  if (error || !data) return null;
  try { data.meta = JSON.parse(data.meta || '{}'); } catch (e) { data.meta = {}; }
  return data;
}

module.exports = { gateway, createPayment, executeCharge, getPayment, SandboxProvider };
