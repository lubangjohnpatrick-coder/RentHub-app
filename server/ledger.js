'use strict';

// Financial ledger. All money movement for a booking is recorded here with running balances.
// Balances are NEVER derived from frontend values; they are computed server-side.

const db = require('./db/schema');
const crypto = require('crypto');

function addEntry({ bookingId, userId, type, amount, meta = {} }) {
  // balance_after represents the user's wallet balance after this entry
  const user = userId ? db.prepare('SELECT wallet_balance FROM users WHERE id=?').get(userId) : null;
  const before = user ? user.wallet_balance : 0;
  const stmt = db.prepare(
    'INSERT INTO ledger_entries (booking_id, user_id, type, amount, balance_after, meta, created_at) VALUES (?,?,?,?,?,?,?)'
  );
  const info = stmt.run(bookingId || null, userId || null, type, amount, before + amount, JSON.stringify(meta), Date.now());
  if (userId) {
    db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?').run(amount, userId);
  }
  return { id: info.lastInsertRowid, balance_after: before + amount };
}

function getUserBalance(userId) {
  const u = db.prepare('SELECT wallet_balance FROM users WHERE id=?').get(userId);
  return u ? u.wallet_balance : 0;
}

// The full commission split for a booking. Returns the exact cents/peso figures.
function computeBookingSplit(rentalFee, deliveryFee) {
  const platformFee = require('./settings').computePlatformFee(rentalFee);
  // Owner earns rentalFee - platformFee + deliveryFee (delivery maybe partly platform). For MVP owner gets full delivery fee.
  const ownerEarning = rentalFee - platformFee + deliveryFee;
  return { rentalFee, deliveryFee, platformFee, ownerEarning };
}

function recordBookingLedger(booking) {
  const split = computeBookingSplit(booking.rental_fee, booking.delivery_fee);
  // Renter paid: rentalFee + deliveryFee + deposit + platformFee collected in gross
  // Actually platform fee is deducted from rentalFee on owner side; renter total includes it.
  return split;
}

function makePaymentRef(prefix) {
  return prefix + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

module.exports = {
  addEntry,
  getUserBalance,
  computeBookingSplit,
  recordBookingLedger,
  makePaymentRef,
};
