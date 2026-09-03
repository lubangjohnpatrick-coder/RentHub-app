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

const ALLOWED = {
  'image/png': [0x89, 0x50, 0x4E, 0x47],      // \x89PNG
  'image/jpeg': [0xFF, 0xD8, 0xFF],          // \xFF\xD8\xFF
  'image/gif': [0x47, 0x49, 0x46, 0x38],     // GIF8
  'image/webp': [0x52, 0x49, 0x46, 0x46],    // RIFF...WEBP
  'image/bmp': [0x42, 0x4D],                 // BM
};

// Verify the first bytes actually match the declared image type. This defeats
// ".exe renamed to .jpg" and other content-spoofing against the mimetype.
function matchesSignature(buf, sig) {
  if (!sig || buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  // WebP: next 4 bytes must be 'WEBP' at offset 8.
  if (sig[0] === 0x52 && sig[3] === 0x46) {
    return buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  }
  return true;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Reject SVG (stored XSS vector) and anything that isn't a real raster image,
    // and only accept when the declared mimetype is one we can signature-check.
    const okMime = typeof ALLOWED[file.mimetype] === 'object';
    const okExt = /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.originalname);
    cb(null, okMime && okExt);
    // (Signature check happens after arbitrary bytes are read; no cb(error) here
    // because we still want to reject clearly in the route below.)
  },
});

const URL = () => process.env.SUPABASE_URL || '';

router.post('/', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files provided' });
    const bucket = 'listing-photos';
    const urls = [];
    for (const file of req.files) {
      // Deep content check: the actual bytes must match the declared type.
      // Multer's fileFilter already narrowed to allowed types; this is the
      // second, authoritative filter against spoofed content.
      if (!matchesSignature(file.buffer, ALLOWED[file.mimetype])) {
        return res.status(400).json({ error: `File "${file.originalname}" is not a valid ${file.mimetype.replace('image/', '').toUpperCase()} image.` });
      }
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
