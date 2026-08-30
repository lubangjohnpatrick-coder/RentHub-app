'use strict';

const express = require('express');
const db = require('../db/schema');
const { requireAuth } = require('../auth');
const { notify, notifyMany } = require('../notify');
const router = express.Router();

// Create a rent request ("I need something")
router.post('/', requireAuth, (req, res) => {
  const { title, description, category, city, start_date, end_date, budget, latitude, longitude } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Describe what you need' });
  const info = db.prepare(
    `INSERT INTO rent_requests (requester_id, title, description, category, city, latitude, longitude, start_date, end_date, budget, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(req.user.id, title, description || '', category || '', city || '', latitude || null, longitude || null,
    start_date ? new Date(start_date).getTime() : null, end_date ? new Date(end_date).getTime() : null,
    budget || null, 'open', Date.now());

  // Notify nearby owners who have listings in matching category
  const owners = db.prepare(
    `SELECT DISTINCT owner_id FROM listings WHERE status='active' AND (? = '' OR category_id = (SELECT id FROM categories WHERE name=?))`
  ).all(category || '', category || '');
  notifyMany(owners.map(o => o.owner_id).filter(id => id !== req.user.id), 'rent_request',
    'Someone needs an item', `${req.user.full_name} is looking for "${title}"`, `/requests`);

  res.json({ id: info.lastInsertRowid });
});

// List requests (open) - feed
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM rent_requests WHERE status=\'open\' ORDER BY created_at DESC LIMIT 50').all();
  res.json(rows.map(r => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(r.requester_id);
    return { ...r, requester: user ? { id: user.id, full_name: user.full_name, avatar: user.avatar } : null };
  }));
});

// My requests
router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM rent_requests WHERE requester_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

// Close request
router.post('/:id/close', requireAuth, (req, res) => {
  const r = db.prepare('SELECT * FROM rent_requests WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.requester_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('UPDATE rent_requests SET status=\'closed\' WHERE id=?').run(r.id);
  res.json({ ok: true });
});

module.exports = router;
