'use strict';

const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');

const router = express.Router();
const MAX_GPS_AGE_MS = 2 * 60 * 1000;
const MAX_GPS_ACCURACY_M = 100;
const MAX_PIN_ADJUST_M = 200;
const MAX_SAVED_LOCATIONS = 10;
const now = () => Date.now();
const validLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const validLng = (v) => Number.isFinite(v) && v >= -180 && v <= 180;

function normalizeText(v, max) {
  return String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (value) => value * Math.PI / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function verifiedFix(body) {
  const hasSeparateDeviceFix = body.gps_latitude !== undefined || body.gps_longitude !== undefined;
  const gpsLatitude = Number(hasSeparateDeviceFix ? body.gps_latitude : (body.latitude ?? body.lat));
  const gpsLongitude = Number(hasSeparateDeviceFix ? body.gps_longitude : (body.longitude ?? body.lng));
  const accuracy = Number(hasSeparateDeviceFix ? body.gps_accuracy_m : (body.accuracy_m ?? body.accuracy));
  const capturedAt = Number(hasSeparateDeviceFix ? body.gps_captured_at : (body.captured_at ?? body.timestamp));
  const source = String(body.source || 'gps').toLowerCase();

  if (source !== 'gps' && source !== 'device') return { error: 'A saved location must be verified from your device GPS.' };
  if (!validLat(gpsLatitude) || !validLng(gpsLongitude)) return { error: 'Invalid GPS coordinates.' };
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > MAX_GPS_ACCURACY_M) return { error: 'GPS accuracy is too low. Move to an open area and try again.' };
  if (!Number.isFinite(capturedAt) || Math.abs(now() - capturedAt) > MAX_GPS_AGE_MS) return { error: 'GPS reading is stale. Capture your location again.' };

  const selectedLatitude = Number(hasSeparateDeviceFix ? body.latitude : gpsLatitude);
  const selectedLongitude = Number(hasSeparateDeviceFix ? body.longitude : gpsLongitude);
  if (!validLat(selectedLatitude) || !validLng(selectedLongitude)) return { error: 'Invalid selected map pin.' };

  const adjustmentM = distanceMeters(gpsLatitude, gpsLongitude, selectedLatitude, selectedLongitude);
  if (adjustmentM > MAX_PIN_ADJUST_M) {
    return {
      error: `The map pin is too far from your verified GPS position. Keep it within ${MAX_PIN_ADJUST_M} meters and try again.`,
      code: 'pin_too_far_from_gps',
    };
  }

  return {
    latitude: selectedLatitude,
    longitude: selectedLongitude,
    accuracy,
    capturedAt,
    gpsLatitude,
    gpsLongitude,
    adjustmentM,
  };
}

router.post('/auth/address', requireAuth, async (req, res) => {
  if (req.body.latitude !== undefined || req.body.longitude !== undefined || req.body.lat !== undefined || req.body.lng !== undefined) {
    return res.status(400).json({ error: 'Coordinates cannot be edited manually. Use device GPS verification.', code: 'gps_required' });
  }

  const patch = { updated_at: now() };
  if (req.body.address !== undefined) patch.address = normalizeText(req.body.address, 180);
  if (req.body.barangay !== undefined) patch.barangay = normalizeText(req.body.barangay, 80);
  if (req.body.city !== undefined) patch.city = normalizeText(req.body.city, 80);
  if (req.body.province !== undefined) patch.province = normalizeText(req.body.province, 80);

  const { error } = await svcClient().from('users').update(patch).eq('id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.get('/profile/locations', requireAuth, async (req, res) => {
  const { data, error } = await svcClient().from('saved_locations').select('*').eq('user_id', req.user.id).order('is_default', { ascending: false }).order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ locations: data || [] });
});

router.post('/profile/locations', requireAuth, async (req, res) => {
  const count = await svcClient().from('saved_locations').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id);
  if (count.error) return res.status(500).json({ error: count.error.message });
  if ((count.count || 0) >= MAX_SAVED_LOCATIONS) return res.status(409).json({ error: `You can save up to ${MAX_SAVED_LOCATIONS} locations.` });

  const fix = verifiedFix(req.body || {});
  if (fix.error) return res.status(400).json({ error: fix.error, code: fix.code || 'gps_verification_required' });

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
  res.status(201).json({ location: data, pin_adjustment_m: Math.round(fix.adjustmentM) });
});

router.patch('/profile/locations/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid saved location.' });

  const patch = { updated_at: now() };
  const editsAddress = ['address','barangay','city','province'].some((key) => req.body[key] !== undefined);
  const changingPosition = req.body.latitude !== undefined || req.body.longitude !== undefined || req.body.accuracy_m !== undefined || req.body.lat !== undefined || req.body.lng !== undefined || req.body.gps_latitude !== undefined || req.body.gps_longitude !== undefined;

  if (editsAddress || changingPosition) {
    const fix = verifiedFix(req.body || {});
    if (fix.error) return res.status(400).json({ error: fix.error, code: fix.code || 'gps_verification_required' });
    Object.assign(patch, { latitude: fix.latitude, longitude: fix.longitude, accuracy_m: fix.accuracy, verified_by: 'gps', verified_at: now(), captured_at: fix.capturedAt });
  }

  if (req.body.label !== undefined) patch.label = normalizeText(req.body.label, 60);
  if (req.body.address !== undefined) patch.address = normalizeText(req.body.address, 180);
  if (req.body.barangay !== undefined) patch.barangay = normalizeText(req.body.barangay, 80);
  if (req.body.city !== undefined) patch.city = normalizeText(req.body.city, 80);
  if (req.body.province !== undefined) patch.province = normalizeText(req.body.province, 80);

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
