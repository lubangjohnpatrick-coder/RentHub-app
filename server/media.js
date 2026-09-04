'use strict';

const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');

const router = express.Router();

function parsePrivateRef(ref) {
  const s = String(ref || '');
  if (!s.startsWith('private://')) return null;
  const rest = s.slice('private://'.length);
  const slash = rest.indexOf('/');
  if (slash < 1) return null;
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
}

async function canRead(req, bucket, objectPath) {
  if (req.user.role === 'admin') return true;
  if (bucket === 'identity-docs') return objectPath.startsWith(`users/${req.user.id}/`);
  if (bucket === 'rental-evidence') {
    const m = objectPath.match(/^bookings\/(\d+)\//);
    if (!m) return false;
    const { data } = await svcClient().from('bookings').select('renter_id,owner_id').eq('id', Number(m[1])).limit(1).maybeSingle();
    return !!(data && (data.renter_id === req.user.id || data.owner_id === req.user.id));
  }
  return false;
}

router.get('/media/sign', requireAuth, async (req, res) => {
  const parsed = parsePrivateRef(req.query.ref);
  if (!parsed || !['identity-docs','rental-evidence'].includes(parsed.bucket)) return res.status(400).json({ error: 'Invalid private media reference' });
  if (!(await canRead(req, parsed.bucket, parsed.path))) return res.status(403).json({ error: 'Not authorized to view this media' });
  const { data, error } = await svcClient().storage.from(parsed.bucket).createSignedUrl(parsed.path, 15 * 60);
  if (error || !data?.signedUrl) return res.status(500).json({ error: error?.message || 'Could not sign media URL' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ url: data.signedUrl, expires_in: 900 });
});

module.exports = router;
