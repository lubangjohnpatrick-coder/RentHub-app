'use strict';

const express = require('express');
const db = require('../db/schema');
const { requireAuth } = require('../auth');
const ledger = require('../ledger');
const { createPayment, executeCharge } = require('../payment');
const router = express.Router();

// Wallet status + recent entries
router.get('/', requireAuth, (req, res) => {
  const u = db.prepare('SELECT wallet_balance FROM users WHERE id=?').get(req.user.id);
  const entries = db.prepare('SELECT * FROM ledger_entries WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id);
  const payouts = db.prepare('SELECT * FROM payouts WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.user.id);
  res.json({ balance: u.wallet_balance, entries, payouts });
});

// Top up wallet via the provider gateway (sandbox in demo)
router.post('/topup', requireAuth, async (req, res) => {
  const { amount, method, reference } = req.body || {};
  const amt = parseInt(amount || '0', 10);
  if (amt <= 0 || amt > 1000000) return res.status(400).json({ error: 'Invalid top-up amount' });
  if (!req.user.is_owner && !req.user.is_business) {
    // keep demo simple: any verified user may top up
  }
  const pay = createPayment({
    userId: req.user.id, type: 'topup', grossAmount: amt, platformFee: 0,
    method: method || 'gcash', meta: { reference: reference || '' },
  });
  try {
    const done = await executeCharge(pay);
    if (done.status !== 'succeeded') {
      return res.status(502).json({ error: 'Payment provider declined the top-up.' });
    }
    ledger.addEntry({ userId: req.user.id, type: 'topup', amount: amt, meta: { ref: pay.payment_ref, method } });
    const bal = ledger.getUserBalance(req.user.id);
    res.json({ ok: true, balance: bal, payment: { ...done, amount: amt } });
  } catch (e) {
    res.status(502).json({ error: 'Top-up failed: ' + (e.message || 'provider error') });
  }
});

// Withdraw (simulated - mark payout)
router.post('/withdraw', requireAuth, (req, res) => {
  const { amount, method, account } = req.body || {};
  const amt = parseInt(amount || '0', 10);
  if (amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const u = db.prepare('SELECT wallet_balance FROM users WHERE id=?').get(req.user.id);
  if (u.wallet_balance < amt) return res.status(400).json({ error: 'Insufficient balance' });
  const ref = ledger.makePaymentRef('PAYOUT');
  const p = db.prepare('INSERT INTO payments (payment_ref, user_id, type, status, gross_amount, platform_fee, net_amount, method, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    ref, req.user.id, 'withdrawal', 'pending', amt, 0, amt, method || 'bank', Date.now(), Date.now()
  );
  db.prepare('INSERT INTO payouts (payment_id, user_id, amount, status, method, account, created_at) VALUES (?,?,?,?,?,?,?)').run(
    p.lastInsertRowid, req.user.id, amt, 'pending', method || 'bank', account || '', Date.now()
  );
  db.prepare('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=?').run(amt, req.user.id);
  ledger.addEntry({ userId: req.user.id, type: 'payout', amount: -amt, meta: { ref } });
  res.json({ ok: true, balance: db.prepare('SELECT wallet_balance FROM users WHERE id=?').get(req.user.id).wallet_balance });
});

// Transactions (payments for this user)
router.get('/payments', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json(rows);
});

module.exports = router;
