'use strict';

const express = require('express');
const db = require('../db/schema');
const { requireAuth, requireAdmin } = require('../auth');
const router = express.Router();

router.get('/', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories WHERE is_active=1 ORDER BY sort_order').all();
  const subStmt = db.prepare('SELECT * FROM subcategories WHERE category_id=?');
  const withCount = db.prepare('SELECT COUNT(*) c FROM listings WHERE category_id=? AND status=\'active\'');
  res.json(cats.map((c) => {
    c.subcategories = subStmt.all(c.id);
    c.count = withCount.get(c.id).c;
    return c;
  }));
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { name, icon, color } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  db.prepare('INSERT OR IGNORE INTO categories (name, slug, icon, color, sort_order) VALUES (?,?,?,?,?)').run(
    name, slug, icon || '📦', color || '#95A5A6', 999
  );
  res.json({ ok: true });
});

router.post('/:id/subcategories', requireAuth, requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.prepare('INSERT INTO subcategories (category_id, name) VALUES (?,?)').run(req.params.id, name);
  res.json({ ok: true });
});

module.exports = router;
