'use strict';

// Upload route: receives multipart files (multer) and stores them in the
// public Supabase Storage bucket `listing-photos`, returning the public URLs.
// Keeps the browser's `fetch('/api/upload', {body: FormData})` contract stable.
// The browser may write photos directly via Supabase Storage too; this route is
// a convenience for the existing app.js forms. Auth required (Supabase JWT).

const path = require('path');
const multer = require('multer');
const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Reject SVG (stored XSS vector) and anything that isn't a real raster/browser image.
    const ok = /^image\/(png|jpe?g|gif|webp|bmp)$/.test(file.mimetype) && /\.(png|jpe?g|jpeg|gif|webp|bmp)$/i.test(file.originalname);
    cb(null, !!ok);
  },
});

const URL = () => process.env.SUPABASE_URL || '';

router.post('/', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files provided' });
    const bucket = 'listing-photos';
    const urls = [];
    for (const file of req.files) {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      const objectPath = `uploads/${req.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const { error } = await svcClient().storage.from(bucket).upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
      if (error) throw new Error('Storage upload failed: ' + error.message);
      urls.push(`${URL()}/storage/v1/object/public/${bucket}/${objectPath}`);
    }
    res.json({ urls });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
