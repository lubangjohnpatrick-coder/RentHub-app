'use strict';

// Authenticated image upload route.
// - listing (default): public listing-photos bucket
// - profile: public profile-photos bucket, one replaceable avatar per user
// - evidence: private rental-evidence bucket, scoped to a booking party
// - identity: private identity-docs bucket, scoped to the authenticated user
//
// Public images are metadata-sanitized before storage so phone EXIF/XMP data
// (including possible embedded GPS coordinates) is not published accidentally.

const multer = require('multer');
const express = require('express');
const crypto = require('crypto');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');

const router = express.Router();
const ALLOWED = {
  'image/png': [0x89, 0x50, 0x4E, 0x47],
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};
const EXTENSION = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 30 * 1024 * 1024;

function matchesSignature(buf, sig) {
  if (!sig || buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  if (sig[0] === 0x52 && sig[3] === 0x46) {
    return buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  }
  return true;
}

function stripJpegMetadata(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return buf;
  const out = [buf.subarray(0, 2)];
  let p = 2;
  while (p + 1 < buf.length) {
    if (buf[p] !== 0xFF) { out.push(buf.subarray(p)); break; }
    let markerStart = p;
    while (p < buf.length && buf[p] === 0xFF) p += 1;
    if (p >= buf.length) break;
    const marker = buf[p++];
    if (marker === 0xD9) { out.push(buf.subarray(markerStart, p)); break; }
    if (marker === 0xDA) { out.push(buf.subarray(markerStart)); break; }
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      out.push(buf.subarray(markerStart, p));
      continue;
    }
    if (p + 2 > buf.length) return buf;
    const len = buf.readUInt16BE(p);
    if (len < 2 || p + len > buf.length) return buf;
    const end = p + len;
    // APP1 = EXIF/XMP, APP13 = IPTC/Photoshop metadata, COM = comments.
    const sensitive = marker === 0xE1 || marker === 0xED || marker === 0xFE;
    if (!sensitive) out.push(buf.subarray(markerStart, end));
    p = end;
  }
  return Buffer.concat(out);
}

function stripPngMetadata(buf) {
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) return buf;
  const out = [buf.subarray(0, 8)];
  let p = 8;
  const drop = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const end = p + 12 + len;
    if (end > buf.length) return buf;
    const type = buf.toString('ascii', p + 4, p + 8);
    if (!drop.has(type)) out.push(buf.subarray(p, end));
    p = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

function stripWebpMetadata(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return buf;
  const chunks = [];
  let p = 12;
  while (p + 8 <= buf.length) {
    const type = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const padded = size + (size % 2);
    const end = p + 8 + padded;
    if (end > buf.length) return buf;
    if (type !== 'EXIF' && type !== 'XMP ') {
      let chunk = Buffer.from(buf.subarray(p, end));
      if (type === 'VP8X' && size >= 10) {
        // Clear EXIF/XMP feature flags after their chunks are removed.
        chunk[8] &= ~0x0C;
      }
      chunks.push(chunk);
    }
    p = end;
  }
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function sanitizePublicImage(file) {
  if (file.mimetype === 'image/jpeg') return stripJpegMetadata(file.buffer);
  if (file.mimetype === 'image/png') return stripPngMetadata(file.buffer);
  if (file.mimetype === 'image/webp') return stripWebpMetadata(file.buffer);
  return file.buffer;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 12, fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    const okMime = typeof ALLOWED[file.mimetype] === 'object';
    const okExt = /\.(png|jpe?g|webp)$/i.test(file.originalname || '');
    cb(null, okMime && okExt);
  },
});

const SUPABASE_URL = () => process.env.SUPABASE_URL || '';
const privateRef = (bucket, objectPath) => `private://${bucket}/${objectPath}`;

async function authorizeEvidence(req, bookingId) {
  const { data } = await svcClient().from('bookings').select('renter_id,owner_id').eq('id', bookingId).limit(1).maybeSingle();
  return !!(data && (data.renter_id === req.user.id || data.owner_id === req.user.id || req.user.role === 'admin'));
}

async function ensureProfileBucket() {
  const client = svcClient();
  const { data, error } = await client.storage.getBucket('profile-photos');
  if (data && !error) return;

  const missing = error && /bucket not found|not found/i.test(String(error.message || ''));
  if (!missing && error) throw new Error('Unable to check profile photo storage: ' + error.message);

  const { error: createError } = await client.storage.createBucket('profile-photos', {
    public: true,
    fileSizeLimit: MAX_FILE_BYTES,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });
  if (createError && !/already exists/i.test(String(createError.message || ''))) {
    throw new Error('Profile photo storage is not configured. Apply the latest Supabase migration or create the profile-photos bucket.');
  }
}

router.post('/', requireAuth, upload.array('files', 12), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No supported image files were provided. Use JPG, PNG or WEBP.' });
    const totalBytes = req.files.reduce((sum, file) => sum + Number(file.size || file.buffer.length || 0), 0);
    if (totalBytes > MAX_REQUEST_BYTES) return res.status(413).json({ error: 'The combined upload is too large. Upload fewer or smaller images.' });

    const scope = String(req.query.scope || req.body.scope || 'listing').toLowerCase();
    if (!['listing','profile','evidence','identity'].includes(scope)) return res.status(400).json({ error: 'Invalid upload scope' });

    let bucket = 'listing-photos';
    let prefix = `uploads/${req.user.id}`;
    let isPrivate = false;
    let fixedProfilePath = false;

    if (scope === 'profile') {
      if (req.files.length !== 1) return res.status(400).json({ error: 'Upload exactly one profile photo.' });
      await ensureProfileBucket();
      bucket = 'profile-photos';
      prefix = `users/${req.user.id}`;
      fixedProfilePath = true;
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
      const ext = EXTENSION[file.mimetype];
      if (!ext) return res.status(400).json({ error: 'Unsupported image type.' });
      const objectPath = fixedProfilePath
        ? `${prefix}/avatar${ext}`
        : `${prefix}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      const uploadBuffer = isPrivate ? file.buffer : sanitizePublicImage(file);
      const { error } = await svcClient().storage.from(bucket).upload(objectPath, uploadBuffer, {
        contentType: file.mimetype,
        cacheControl: isPrivate ? '0' : (fixedProfilePath ? '86400' : '31536000'),
        upsert: fixedProfilePath,
      });
      if (error) throw new Error('Storage upload failed: ' + error.message);
      urls.push(isPrivate
        ? privateRef(bucket, objectPath)
        : `${SUPABASE_URL()}/storage/v1/object/public/${bucket}/${objectPath}`);
    }
    res.json({ urls, scope, private: isPrivate });
  } catch (e) {
    const status = e && (e.code === 'LIMIT_FILE_SIZE' || e.code === 'LIMIT_FILE_COUNT') ? 413 : 500;
    res.status(status).json({ error: status === 413 ? 'Upload limits exceeded.' : e.message });
  }
});

module.exports = router;
module.exports._test = { stripJpegMetadata, stripPngMetadata, stripWebpMetadata };
