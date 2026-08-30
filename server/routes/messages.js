'use strict';

const express = require('express');
const db = require('../db/schema');
const { requireAuth, publicUser } = require('../auth');
const { detectCircumvention, notify } = require('../notify');
const router = express.Router();

// My conversations
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT * FROM messages WHERE sender_id=? OR receiver_id=? ORDER BY created_at DESC`
  ).all(req.user.id, req.user.id);
  const conv = new Map();
  for (const m of rows) {
    const key = m.sender_id === req.user.id ? 'u' + m.receiver_id : 'u' + m.sender_id;
    if (!conv.has(key)) conv.set(key, {
      other_id: m.sender_id === req.user.id ? m.receiver_id : m.sender_id,
      last: m,
      unread: m.receiver_id === req.user.id && !m.is_read ? 1 : 0,
      booking_id: m.booking_id,
    });
    else if (m.receiver_id === req.user.id && !m.is_read && conv.get(key).unread === 0) conv.get(key).unread = 1;
  }
  const out = [];
  for (const c of conv.values()) {
    const other = db.prepare('SELECT * FROM users WHERE id=?').get(c.other_id);
    // number of unread
    const unread = db.prepare('SELECT COUNT(*) c FROM messages WHERE sender_id=? AND receiver_id=? AND is_read=0').get(c.other_id, req.user.id).c;
    c.other = publicUser(other);
    c.unread = unread;
    c.booking_id = c.last.booking_id;
    c.last_time = c.last.created_at;
    c.prev = c.last.body;
    out.push(c);
  }
  res.json(out);
});

// Thread with a user (optionally per booking)
router.get('/:userId', requireAuth, (req, res) => {
  const otherId = parseInt(req.params.userId, 10);
  const bookingId = req.query.booking_id ? parseInt(req.query.booking_id, 10) : null;
  let rows;
  if (bookingId) {
    rows = db.prepare(
      `SELECT * FROM messages WHERE ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)) AND booking_id=? ORDER BY created_at ASC`
    ).all(req.user.id, otherId, otherId, req.user.id, bookingId);
  } else {
    rows = db.prepare(
      `SELECT * FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at ASC`
    ).all(req.user.id, otherId, otherId, req.user.id);
  }
  db.prepare('UPDATE messages SET is_read=1 WHERE sender_id=? AND receiver_id=?').run(otherId, req.user.id);
  const other = db.prepare('SELECT * FROM users WHERE id=?').get(otherId);
  res.json({ messages: rows, other: publicUser(other) });
});

// Send message
router.post('/', requireAuth, (req, res) => {
  const { receiver_id, body, booking_id } = req.body || {};
  if (!receiver_id || !body) return res.status(400).json({ error: 'Receiver and message required' });
  const warning = detectCircumvention(body);

  // Anti-circumvention: before there is a CONFIRMED in-app booking, messages that
  // contain phone/GCash/Maya/social/payment details are BLOCKED so transactions
  // can't be moved off-platform. After a confirmed booking, the parties may exchange
  // contact details (still logged with a warning) for coordination.
  if (warning) {
    const confirmed = db.prepare(
      `SELECT id FROM bookings
       WHERE status IN ('approved','active','completed')
         AND ((renter_id=? AND owner_id=?) OR (renter_id=? AND owner_id=?))
       LIMIT 1`
    ).get(req.user.id, receiver_id, receiver_id, req.user.id);
    if (!confirmed) {
      return res.status(400).json({
        error: 'Payments and contact details must stay inside RentHub until a booking is confirmed. Do not share phone numbers, payment apps or social handles before confirming your rental in-app.',
        code: 'circumvention_blocked',
      });
    }
  }

  db.prepare('INSERT INTO messages (booking_id, sender_id, receiver_id, body, warning, created_at) VALUES (?,?,?,?,?,?)').run(
    booking_id || null, req.user.id, receiver_id, body, warning, Date.now()
  );
  notify(receiver_id, 'new_message', 'New message', `${req.user.full_name}: ${body.slice(0, 80)}`, `/messages/${req.user.id}`);
  res.json({ ok: true, warning });
});

module.exports = router;
