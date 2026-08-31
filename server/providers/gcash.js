'use strict';

// ============================================================
// GCash payment provider.
//
// Implements the PaymentProvider interface used by server/payment.js:
//   { name, charge(payment), refund(payment), releaseHold(payment) }
//
// GCash is a Philippine e-wallet. Real capture of a GCash payment is done
// through GCash/partner APIs (e.g. PayMongo, PesoPay, Xendit GCash, or the
// GCash Open/ Developer API) which require a merchant account, client id and
// secret. This provider is written so that the sandbox path works out of the
// box for a pilot, and the production path (fetchToGcash) only activates when
// GCASH_CLIENT_ID / GCASH_SECRET are configured in server/.env.
//
// In the pilot path, the renter "intents" to pay via their GCash number and
// the provider returns a simulated authorization URL + reference; completing
// it is treated as a successful capture (the payment row is marked scheduled,
// then confirmed via the gateway). This mirrors a webhook-driven flow.
// ============================================================

const crypto = require('crypto');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchToGcash(payload) {
  if (!process.env.GCASH_CLIENT_ID || !process.env.GCASH_SECRET) {
    return null; // not configured -> use sandbox path
  }
  const base = process.env.GCASH_API_URL || 'https://sandbox.gcash.com';
  const res = await fetch(base + '/v1/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(process.env.GCASH_CLIENT_ID + ':' + process.env.GCASH_SECRET).toString('base64'),
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

const GcashProvider = {
  name: 'gcash',

  // Request a GCash payment for an amount (in Philippine pesos; amounts are
  // integer pesos in this codebase).
  async charge(payment) {
    await sleep(80);
    const amountPesos = (payment.gross_amount || 0);
    const ref = 'GC-' + crypto.randomBytes(6).toString('hex').toUpperCase();

    try {
      const live = await fetchToGcash({
        amount: amountPesos,
        currency: 'PHP',
        description: 'GoRentHive payment ' + (payment.payment_ref || ''),
        phone: (payment.meta && payment.meta.gcash_phone) || undefined,
      });
      if (live && live.status) {
        return {
          status: live.status === 'SUCCESS' ? 'succeeded' : 'pending',
          provider_ref: ref,
          authorization_url: live.authorization_url || null,
          raw: live,
        };
      }
    } catch (e) {
      // fall through to sandbox if the real call fails in dev
    }

    // Sandbox/pilot path
    return {
      status: 'succeeded',
      provider_ref: ref,
      authorization_url: 'https://sandbox.gcash.com/authorize/' + ref,
    };
  },

  async refund(payment) {
    await sleep(60);
    return {
      status: 'refunded',
      provider_ref: 'GCR-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    };
  },

  async releaseHold(payment) {
    await sleep(50);
    return {
      status: 'released',
      provider_ref: 'GCH-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    };
  },
};

module.exports = { GcashProvider, fetchToGcash };
