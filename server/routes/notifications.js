'use strict';

const express = require('express');
const db = require('../db/schema');
const { requireAuth } = require('../auth');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json(rows.map(n => ({
    id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, is_read: n.is_read, created_at: n.created_at,
  })));
});

module.exports = router;
