'use strict';

const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');

const router = express.Router();
const now = () => Date.now();
const MAX_GPS_AGE_MS = 2 * 60 * 1000;
const MAX_GPS_ACCURACY_M = 100;
const EARTH_KM = 6371.0088;

function validLat(v) { return Number.isFinite(v) && v >= -90 && v <= 90; }
function validLng(v) { return Number.isFinite(v) && v >= -180 && v <= 180; }
function toRad(v) { return v * Math.PI / 180; }
function distanceKm(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// GPS-only verification endpoint. Manual addresses/map pins may be saved through
// the normal profile endpoint but are never marked as verified location.
router.post('/auth/verify-location', requireAuth, async (req, res) => {
  const lat = Number(req.body.latitude ?? req.body.lat);
  const lng = Number(req.body.longitude ?? req.body.lng);
  const accuracy = Number(req.body.accuracy_m ?? req.body.accuracy);
  const capturedAt = Number(req.body.captured_at ?? req.body.timestamp);
  const source = String(req.body.source || '').toLowerCase();

  if (source !== 'gps' && source !== 'device') {
    return res.status(400).json({ error: 'Verified location must come from device GPS. Manual pins are not considered verified.', code: 'gps_required' });
  }
  if (!validLat(lat) || !validLng(lng)) return res.status(400).json({ error: 'Invalid coordinates' });
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > MAX_GPS_ACCURACY_M) {
    return res.status(400).json({ error: 'Location accuracy is too low. Move to an open area and try again.', code: 'poor_accuracy', max_accuracy_m: MAX_GPS_ACCURACY_M });
  }
  if (!Number.isFinite(capturedAt) || Math.abs(now() - capturedAt) > MAX_GPS_AGE_MS) {
    return res.status(400).json({ error: 'Location reading is stale. Please capture your current GPS location again.', code: 'stale_location' });
  }

  const patch = {
    latitude: lat, longitude: lng,
    location_status: 'verified', location_verified_by: 'gps',
    location_verified_at: now(), location_accuracy_m: accuracy,
    location_captured_at: capturedAt, updated_at: now(),
  };
  ['address','barangay','city','province'].forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const { error } = await svcClient().from('users').update(patch).eq('id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, location: { status: 'verified', latitude: lat, longitude: lng, accuracy_m: accuracy, verified_by: 'gps', verified_at: patch.location_verified_at } });
});

// Radius search is computed on the server from the user's verified GPS location.
// Exact listing coordinates are intentionally not returned here.
router.get('/listings/nearby', requireAuth, async (req, res) => {
  const radius = Math.min(100, Math.max(1, Number(req.query.radius_km || 10)));
  const { data: u } = await svcClient().from('users')
    .select('latitude,longitude,location_status,location_verified_by,location_verified_at,location_accuracy_m')
    .eq('id', req.user.id).maybeSingle();
  if (!u || u.location_status !== 'verified' || u.location_verified_by !== 'gps' || !validLat(Number(u.latitude)) || !validLng(Number(u.longitude))) {
    return res.status(428).json({ error: 'Verify your current GPS location before using radius search.', code: 'verified_location_required' });
  }

  const { data, error } = await svcClient().from('listings')
    .select('id,title,price_per_day,location_barangay,location_city,location_province,latitude,longitude,status,featured,avg_rating')
    .eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).filter((l) => validLat(Number(l.latitude)) && validLng(Number(l.longitude)))
    .map((l) => ({
      id: l.id, title: l.title, price_per_day: l.price_per_day,
      location_barangay: l.location_barangay, location_city: l.location_city, location_province: l.location_province,
      featured: !!l.featured, avg_rating: l.avg_rating,
      distance_km: distanceKm(Number(u.latitude), Number(u.longitude), Number(l.latitude), Number(l.longitude)),
    }))
    .filter((l) => l.distance_km <= radius)
    .sort((a, b) => a.distance_km - b.distance_km)
    .map((l) => ({ ...l, distance_km: Math.round(l.distance_km * 10) / 10 }));

  res.json({ ok: true, radius_km: radius, count: items.length, listings: items });
});

module.exports = router;
