'use strict';

const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');

const router = express.Router();
const now = () => Date.now();
const MAX_GPS_AGE_MS = 2 * 60 * 1000;
const MAX_SEARCH_LOCATION_AGE_MS = 15 * 60 * 1000;
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

  const verifiedAt = now();
  const patch = {
    latitude: lat,
    longitude: lng,
    location_status: 'verified',
    location_verified_by: 'gps',
    location_verified_at: verifiedAt,
    location_accuracy_m: accuracy,
    location_captured_at: capturedAt,
    updated_at: verifiedAt,
  };
  ['address','barangay','city','province'].forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const { error } = await svcClient().from('users').update(patch).eq('id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, location: { status: 'verified', latitude: lat, longitude: lng, accuracy_m: accuracy, verified_by: 'gps', verified_at: verifiedAt, captured_at: capturedAt } });
});

// Radius search always uses the authenticated user's recently captured GPS fix.
// Client-supplied lat/lng/distance are ignored. Exact listing coordinates are
// used only server-side for distance calculation and are never returned.
router.get('/listings/nearby', requireAuth, async (req, res) => {
  const radius = Math.min(100, Math.max(1, Number(req.query.radius_km || 10)));
  const q = String(req.query.q || '').trim().toLowerCase();
  const category = req.query.category ? String(req.query.category) : '';

  const { data: u } = await svcClient().from('users')
    .select('latitude,longitude,location_status,location_verified_by,location_verified_at,location_captured_at,location_accuracy_m')
    .eq('id', req.user.id).maybeSingle();
  const capturedAt = Number(u && (u.location_captured_at || u.location_verified_at));
  if (!u || u.location_status !== 'verified' || u.location_verified_by !== 'gps' ||
      !validLat(Number(u.latitude)) || !validLng(Number(u.longitude)) ||
      !Number.isFinite(capturedAt) || now() - capturedAt > MAX_SEARCH_LOCATION_AGE_MS) {
    return res.status(428).json({ error: 'Capture your current GPS location again to search by radius.', code: 'fresh_verified_location_required' });
  }

  let query = svcClient().from('listings')
    .select('id,title,description,price_per_day,security_deposit,category_id,owner_id,location_barangay,location_city,location_province,latitude,longitude,status,featured,is_bundle,rental_count')
    .eq('status', 'active');
  if (category) query = query.eq('category_id', category);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  let candidates = (data || []).filter((l) => validLat(Number(l.latitude)) && validLng(Number(l.longitude)));
  if (q) candidates = candidates.filter((l) => (String(l.title || '') + ' ' + String(l.description || '')).toLowerCase().includes(q));

  // Filter by radius before secondary lookups so we only retrieve public card
  // metadata for listings that may actually be returned.
  candidates = candidates.map((l) => ({
    ...l,
    distance_km: distanceKm(Number(u.latitude), Number(u.longitude), Number(l.latitude), Number(l.longitude)),
  })).filter((l) => l.distance_km <= radius);

  const listingIds = candidates.map((l) => l.id);
  const ownerIds = [...new Set(candidates.map((l) => l.owner_id).filter(Boolean))];
  const [imgRes, ownerRes, reviewRes] = await Promise.all([
    listingIds.length ? svcClient().from('listing_images').select('listing_id,url,is_primary,sort_order').in('listing_id', listingIds) : Promise.resolve({ data: [], error: null }),
    ownerIds.length ? svcClient().from('users').select('id,full_name,identity_status,vessel_rating,successful_rentals').in('id', ownerIds) : Promise.resolve({ data: [], error: null }),
    listingIds.length ? svcClient().from('listing_reviews').select('listing_id,rating').in('listing_id', listingIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (imgRes.error || ownerRes.error || reviewRes.error) {
    return res.status(500).json({ error: (imgRes.error || ownerRes.error || reviewRes.error).message });
  }

  const images = {};
  for (const row of imgRes.data || []) (images[row.listing_id] = images[row.listing_id] || []).push(row);
  const owners = new Map((ownerRes.data || []).map((o) => [o.id, o]));
  const ratings = {};
  for (const row of reviewRes.data || []) {
    const x = ratings[row.listing_id] || (ratings[row.listing_id] = { sum: 0, count: 0 });
    x.sum += Number(row.rating) || 0;
    x.count += 1;
  }

  const items = candidates
    .sort((a, b) => a.distance_km - b.distance_km)
    .map((l) => {
      const rating = ratings[l.id];
      return {
        id: l.id,
        title: l.title,
        description: l.description,
        price_per_day: l.price_per_day,
        security_deposit: l.security_deposit,
        category_id: l.category_id,
        location_barangay: l.location_barangay,
        location_city: l.location_city,
        location_province: l.location_province,
        featured: !!l.featured,
        is_bundle: !!l.is_bundle,
        avg_rating: rating && rating.count ? Math.round((rating.sum / rating.count) * 10) / 10 : 0,
        rental_count: Number(l.rental_count || 0),
        images: (images[l.id] || []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.sort_order || 0) - (b.sort_order || 0)).map((x) => x.url),
        owner: owners.get(l.owner_id) || { id: l.owner_id, full_name: 'Owner' },
        distance_km: Math.round(l.distance_km * 10) / 10,
      };
    });

  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, radius_km: radius, count: items.length, listings: items });
});

module.exports = router;
