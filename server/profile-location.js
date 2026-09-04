'use strict';

const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');

const router = express.Router();
const MAX_GPS_AGE_MS = 2 * 60 * 1000;
const MAX_GPS_ACCURACY_M = 100;
const now = () => Date.now();
const validLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const validLng = (v) => Number.isFinite(v) && v >= -180 && v <= 180;

function normalizeText(v, max) {
  return String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function verifiedFix(body) {
  const latitude = Number(body.latitude ?? body.lat);
  const longitude = Number(body.longitude ?? body.lng);
  const accuracy = Number(body.accuracy_m ?? body.accuracy);
  const capturedAt = Number(body.captured_at ?? body.timestamp);
  const source = String(body.source || '').toLowerCase();

  if (source !== 'gps' && source !== 'device') return { error: 'A saved location must be verified from your device GPS.' };
  if (!validLat(latitude) || !validLng(longitude)) return { error: 'Invalid GPS coordinates.' };
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > MAX_GPS_ACCURACY_M) return { error: 'GPS accuracy is too low. Move to an open area and try again.' };
  if (!Number.isFinite(capturedAt) || Math.abs(now() - capturedAt) > MAX_GPS_AGE_MS) return { error: 'GPS reading is stale. Capture your location again.' };
  return { latitude, longitude, accuracy, capturedAt };
}

router.get('/profile/locations', requireAuth, async (req, res) => {
  const { data, error } = await svcClient().from('saved_locations').select('*').eq('user_id', req.user.id).order('is_default', { ascending: false }).order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ locations: data || [] });
});

router.post('/profile/locations', requireAuth, async (req, res) => {
  const fix = verifiedFix(req.body || {});
  if (fix.error) return res.status(400).json({ error: fix.error, code: 'gps_verification_required' });

  const label = normalizeText(req.body.label || 'Saved location', 60);
  const address = normalizeText(req.body.address, 180);
  const barangay = normalizeText(req.body.barangay, 80);
  const city = normalizeText(req.body.city, 80);
  const province = normalizeText(req.body.province, 80);
  const makeDefault = !!req.body.is_default;
  const ts = now();

  if (makeDefault) await svcClient().from('saved_locations').update({ is_default: false, updated_at: ts }).eq('user_id', req.user.id);

  const row = {
    user_id: req.user.id, label, address, barangay, city, province,
    latitude: fix.latitude, longitude: fix.longitude,
    accuracy_m: fix.accuracy, verified_by: 'gps', verified_at: ts,
    captured_at: fix.capturedAt, is_default: makeDefault,
    created_at: ts, updated_at: ts,
  };
  const { data, error } = await svcClient().from('saved_locations').insert(row).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ location: data });
});

router.patch('/profile/locations/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid saved location.' });

  const patch = { updated_at: now() };
  if (req.body.label !== undefined) patch.label = normalizeText(req.body.label, 60);
  if (req.body.address !== undefined) patch.address = normalizeText(req.body.address, 180);
  if (req.body.barangay !== undefined) patch.barangay = normalizeText(req.body.barangay, 80);
  if (req.body.city !== undefined) patch.city = normalizeText(req.body.city, 80);
  if (req.body.province !== undefined) patch.province = normalizeText(req.body.province, 80);

  const changingPosition = req.body.latitude !== undefined || req.body.longitude !== undefined || req.body.accuracy_m !== undefined;
  if (changingPosition) {
    const fix = verifiedFix(req.body || {});
    if (fix.error) return res.status(400).json({ error: fix.error, code: 'gps_verification_required' });
    Object.assign(patch, { latitude: fix.latitude, longitude: fix.longitude, accuracy_m: fix.accuracy, verified_by: 'gps', verified_at: now(), captured_at: fix.capturedAt });
  }

  if (req.body.is_default === true) {
    await svcClient().from('saved_locations').update({ is_default: false, updated_at: now() }).eq('user_id', req.user.id);
    patch.is_default = true;
  }

  const { data, error } = await svcClient().from('saved_locations').update(patch).eq('id', id).eq('user_id', req.user.id).select('*').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Saved location not found.' });
  res.json({ location: data });
});

router.delete('/profile/locations/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid saved location.' });
  const { error } = await svcClient().from('saved_locations').delete().eq('id', id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
