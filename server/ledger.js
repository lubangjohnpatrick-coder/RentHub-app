'use strict';

// Financial ledger — server only. Uses the service-role Supabase client and
// a SECURITY DEFINER Postgres function so the running balance is updated
// atomically. Balances are NEVER derived from frontend values.

const { svcClient } = require('./supabase');
const crypto = require('crypto');

async function addEntry({ bookingId, userId, type, amount, meta = {} }) {
  const { data, error } = await svcClient()
    .rpc('ledger_entry', {
      p_booking_id: bookingId || null,
      p_user_id: userId || null,
      p_type: type,
      p_amount: amount,
      p_meta: JSON.stringify(meta),
    });
  if (error) throw new Error('Ledger error: ' + error.message);
  if (!data || !data.length) return { id: null, balance_after: 0 };
  return { id: data[0].entry_id, balance_after: data[0].new_balance };
}

async function getUserBalance(userId) {
  if (!userId) return 0;
  const { data, error } = await svcClient().rpc('get_user_balance', { p_user_id: userId });
  if (error) return 0;
  return data || 0;
}

function computeBookingSplit(rentalFee, deliveryFee) {
  const { computePlatformFee } = require('./settings');
  const platformFee = computePlatformFee(rentalFee);
  const ownerEarning = rentalFee - platformFee + deliveryFee;
  return { rentalFee, deliveryFee, platformFee, ownerEarning };
}

function makePaymentRef(prefix) {
  return prefix + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

module.exports = { addEntry, getUserBalance, computeBookingSplit, makePaymentRef };
