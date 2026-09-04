'use strict';

// Authenticated image upload route.
// - listing (default): public listing-photos bucket
// - profile: public profile-photos bucket, scoped to the authenticated user
// - evidence: private rental-evidence bucket, scoped to a booking party
// - identity: private identity-docs bucket, scoped to the authenticated user

const path = require('path');
const multer = require('multer');
const express = require('express');
const crypto = require('crypto');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');

const router = express.Router();
const ALLOWED = {
  'image/png': [0x89, 0x50, 0x4E, 0x47],
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/gif': [0x47, 0x49, 0x46, 0x38],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

function matchesSignature(buf, sig) {
  if (!sig || buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  if (sig[0] === 0x52 && sig[3] === 0x46) {
    return buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  }
  return true;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 12, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okMime = typeof ALLOWED[file.mimetype] === 'object';
    const okExt = /\.(png|jpe?g|gif|webp)$/i.test(file.originalname);
    cb(null, okMime && okExt);
  },
});

const SUPABASE_URL = () => process.env.SUPABASE_URL || '';
const privateRef = (bucket, objectPath) => `private://${bucket}/${objectPath}`;

async function authorizeEvidence(req, bookingId) {
  const { data } = await svcClient().from('bookings').select('renter_id,owner_id').eq('id', bookingId).limit(1).maybeSingle();
  return !!(data && (data.renter_id === req.user.id || data.owner_id === req.user.id || req.user.role === 'admin'));
}

router.post('/', requireAuth, upload.array('files', 12), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files provided' });
    const scope = String(req.query.scope || req.body.scope || 'listing').toLowerCase();
    if (!['listing','profile','evidence','identity'].includes(scope)) return res.status(400).json({ error: 'Invalid upload scope' });

    let bucket = 'listing-photos';
    let prefix = `uploads/${req.user.id}`;
    let isPrivate = false;

    if (scope === 'profile') {
      if (req.files.length !== 1) return res.status(400).json({ error: 'Upload exactly one profile photo.' });
      bucket = 'profile-photos';
      prefix = `users/${req.user.id}`;
    }
    if (scope === 'identity') {
      bucket = 'identity-docs';
      prefix = `users/${req.user.id}`;
      isPrivate = true;
      if (req.files.length > 3) return res.status(400).json({ error: 'Too many identity images' });
    }
    if (scope === 'evidence') {
      const bookingId = Number(req.query.booking_id || req.body.booking_id);
      if (!Number.isFinite(bookingId) || bookingId <= 0) return res.status(400).json({ error: 'booking_id is required for rental evidence' });
      if (!(await authorizeEvidence(req, bookingId))) return res.status(403).json({ error: 'You are not a party to this booking' });
      bucket = 'rental-evidence';
      prefix = `bookings/${bookingId}/${req.user.id}`;
      isPrivate = true;
    }

    const urls = [];
    for (const file of req.files) {
      if (!matchesSignature(file.buffer, ALLOWED[file.mimetype])) {
        return res.status(400).json({ error: `File "${file.originalname}" does not match its declared image type.` });
      }
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      const objectPath = `${prefix}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      const { error } = await svcClient().storage.from(bucket).upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        cacheControl: isPrivate ? '0' : '86400',
        upsert: false,
      });
      if (error) throw new Error('Storage upload failed: ' + error.message);
      urls.push(isPrivate
        ? privateRef(bucket, objectPath)
        : `${SUPABASE_URL()}/storage/v1/object/public/${bucket}/${objectPath}`);
    }
    res.json({ urls, scope, private: isPrivate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
