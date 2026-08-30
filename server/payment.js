'use strict';

// Provider-agnostic payment architecture.
// A real provider (GCash, Maya, Stripe) can be plugged in by implementing the
// PaymentProvider interface and setting gateway.provider = <that provider>.
// The rest of the system never touches provider internals.

const db = require('./db/schema');
const ledger = require('./ledger');

// ---------- Provider interface ----------
// {
//   name: 'sandbox' | 'gcash' | 'maya' | 'stripe',
//   charge(payment) -> { status: 'succeeded', provider_ref }
//   refund(payment) -> { status: 'refunded' }
//   releaseHold(payment) -> ...
// }

const SandboxProvider = {
  name: 'sandbox',
  async charge(payment) {
    // Simulates capturing a payment from the renter's chosen method.
    await sleep(60);
    return { status: 'succeeded', provider_ref: 'SB-' + Math.random().toString(36).slice(2, 10).toUpperCase() };
  },
  async refund(payment) {
    await sleep(40);
    return { status: 'refunded', provider_ref: 'SBR-' + Math.random().toString(36).slice(2, 8).toUpperCase() };
  },
  async releaseHold(payment) {
    await sleep(30);
    return { status: 'released', provider_ref: 'SBH-' + Math.random().toString(36).slice(2, 8).toUpperCase() };
  },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class Gateway {
  constructor() {
    this.provider = SandboxProvider; // swap this to plug in GCash/Maya/Stripe
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

// Record a payment row and update its status
function createPayment({ userId, bookingId, type, grossAmount, platformFee = 0, method, meta = {} }) {
  const ref = ledger.makePaymentRef(type.slice(0, 4).toUpperCase());
  const netAmount = grossAmount - platformFee;
  db.prepare(
    `INSERT INTO payments (payment_ref, user_id, booking_id, type, method, status, gross_amount, platform_fee, net_amount, meta, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(ref, userId, bookingId || null, type, method, 'pending', grossAmount, platformFee, netAmount, JSON.stringify(meta), Date.now(), Date.now());
  const row = db.prepare('SELECT * FROM payments WHERE payment_ref=?').get(ref);
  return row;
}

async function executeCharge(payment) {
  const res = await gateway.charge(payment);
  const status = res.status;
  db.prepare('UPDATE payments SET status=?, updated_at=? WHERE id=?').run(status, Date.now(), payment.id);
  if (status === 'succeeded') {
    // Money received; credit the relevant party as appropriate by caller
  }
  return { ...payment, status, provider_ref: res.provider_ref };
}

module.exports = { gateway, createPayment, executeCharge };
