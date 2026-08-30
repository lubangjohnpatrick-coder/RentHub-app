'use strict';

const express = require('express');
const db = require('../db/schema');
const { requireAuth, publicUser } = require('../auth');
const { getFeaturedPlans } = require('../settings');
const verify = require('../verify');
const ledger = require('../ledger');
const settings = require('../settings');
const deposit = require('../deposit');
const { notify } = require('../notify');
const { distanceKm } = require('../location');
const router = express.Router();

function listingRow(l) {
  if (!l) return null;
  const owner = db.prepare('SELECT * FROM users WHERE id=?').get(l.owner_id);
  let images = db.prepare('SELECT url FROM listing_images WHERE listing_id=? ORDER BY is_primary DESC, sort_order').all(l.id).map((i) => i.url);
  if (images.length === 0) images = ['/images/svg/placeholder.svg'];
  const cat = l.category_id ? db.prepare('SELECT * FROM categories WHERE id=?').get(l.category_id) : null;
  const reviews = db.prepare('SELECT rating, comment, created_at, author_id FROM listing_reviews WHERE listing_id=? ORDER BY created_at DESC LIMIT 5').all(l.id);
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    price_per_day: l.price_per_day,
    security_deposit: l.security_deposit,
    estimated_value: l.estimated_value || 0,
    deposit_tier: l.deposit_tier || 'low',
    deposit_tier_info: deposit.tierInfo(l.deposit_tier || 'low'),
    location_city: l.location_city,
    location_barangay: l.location_barangay,
    location_province: l.location_province,
    latitude: l.latitude,
    longitude: l.longitude,
    distance_km: l._distanceKm != null ? Math.round(l._distanceKm * 10) / 10 : null,
    delivery_available: !!l.delivery_available,
    pickup_available: !!l.pickup_available,
    delivery_fee: l.delivery_fee,
    min_verification_level: l.min_verification_level,
    rules: l.rules,
    condition: l.condition,
    accessories: l.accessories,
    serial_number: l.serial_number,
    featured: !!l.featured,
    status: l.status,
    is_bundle: !!l.is_bundle,
    bundle_items: l.bundle_items ? JSON.parse(l.bundle_items) : [],
    view_count: l.view_count,
    favorite_count: l.favorite_count,
    rental_count: l.rental_count,
    created_at: l.created_at,
    images,
    category: cat ? { id: cat.id, name: cat.name, icon: cat.icon, color: cat.color } : null,
    owner: owner ? {
      ...publicUser(owner),
      is_owner: !!owner.is_owner,
    } : null,
    reviews,
    avg_rating: reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null,
  };
}

// Derive the refundable deposit from the owner-selected tier + item value.
// The server (never the client) decides the final deposit amount.
function depositFromBody(b) {
  const value = b.estimated_value !== undefined ? parseInt(b.estimated_value, 10) : null;
  const tier = b.deposit_tier || 'low';
  if (value === null || Number.isNaN(value)) return { error: 'Estimated item value is required (in ₱).' };
  if (value < 1) return { error: 'Estimated item value must be at least ₱1.' };
  if (value > 1000000) return { error: 'Estimated item value looks too high. Please re-check.' };
  const check = deposit.validateTierSelection(tier, value);
  if (!check.ok) return { error: check.error };
  return { value, tier, deposit: deposit.tierDeposit(tier) };
}

// Search / explore
router.get('/', (req, res) => {
  const { q, category, city, minPrice, maxPrice, sort, featured, bundle, radius, lat, lng, owner } = req.query;
  let where = 'l.status = \'active\'';
  const params = [];

  if (q) {
    where += ` AND (l.title LIKE ? OR l.description LIKE ?)`;
    const like = '%' + q + '%';
    params.push(like, like);
  }
  if (category) { where += ' AND l.category_id = ?'; params.push(category); }
  if (city) { where += ' AND l.location_city = ?'; params.push(city); }
  if (owner) { where += ' AND l.owner_id = ?'; params.push(owner); }
  if (minPrice) { where += ' AND l.price_per_day >= ?'; params.push(minPrice); }
  if (maxPrice) { where += ' AND l.price_per_day <= ?'; params.push(maxPrice); }
  if (featured === '1') where += ' AND l.featured = 1';
  if (bundle === '1') where += ' AND l.is_bundle = 1';

  let order = 'l.featured DESC, l.created_at DESC';
  if (sort === 'price_asc') order = 'l.featured DESC, l.price_per_day ASC';
  if (sort === 'price_desc') order = 'l.featured DESC, l.price_per_day DESC';
  if (sort === 'rating') order = 'l.featured DESC, rating.avg DESC';
  if (sort === 'popular') order = 'l.featured DESC, l.rental_count DESC';

  const qs = `SELECT l.* FROM listings l ${order.includes('rating.') ? 'LEFT JOIN (SELECT listing_id, AVG(rating) avg FROM listing_reviews GROUP BY listing_id) rating ON rating.listing_id=l.id' : ''} WHERE ${where} ORDER BY ${order} LIMIT 100`;
  let rows;
  try {
    rows = db.prepare(qs).all(...params);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid search' });
  }

  // radius filter — uses the listing's own coordinates, else the owner's verified location
  if (radius && lat && lng) {
    const maxKm = parseFloat(radius);
    const qLat = parseFloat(lat), qLng = parseFloat(lng);
    for (const l of rows) {
      let lLat = l.latitude, lLng = l.longitude;
      if (lLat == null || lLng == null) {
        const owner = db.prepare('SELECT latitude, longitude FROM users WHERE id=?').get(l.owner_id);
        if (owner) { lLat = owner.latitude; lLng = owner.longitude; }
      }
      const dist = distanceKm(qLat, qLng, lLat, lLng);
      if (dist == null || dist > maxKm) l._outOfRadius = true;
      else l._distanceKm = dist;
    }
    rows = rows.filter((l) => !l._outOfRadius);
  }

  res.json(rows.map(listingRow));
});

// Trending / popular / bundles / featured groups
router.get('/collections', (req, res) => {
  const trending = db.prepare('SELECT * FROM listings WHERE status=\'active\' ORDER BY rental_count DESC, view_count DESC LIMIT 8').all().map(listingRow);
  const featured = db.prepare('SELECT * FROM listings WHERE status=\'active\' AND featured=1 ORDER BY RANDOM() LIMIT 8').all().map(listingRow);
  const bundles = db.prepare('SELECT * FROM listings WHERE status=\'active\' AND is_bundle=1 LIMIT 8').all().map(listingRow);
  const topOwners = db.prepare('SELECT * FROM users WHERE is_owner=1 AND successful_rentals>0 ORDER BY vessel_rating DESC, successful_rentals DESC LIMIT 8').all()
    .map((u) => ({ ...publicUser(u), itemCount: db.prepare('SELECT COUNT(*) c FROM listings WHERE owner_id=? AND status=\'active\'').get(u.id).c }));
  res.json({ trending, featured, bundles, topOwners });
});

// Nearby (locations list)
router.get('/locations', (req, res) => {
  const cities = db.prepare('SELECT DISTINCT location_city, COUNT(*) c FROM listings WHERE status=\'active\' GROUP BY location_city ORDER BY c DESC LIMIT 20').all();
  res.json(cities);
});

// Single listing detail
router.get('/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE listings SET view_count=view_count+1 WHERE id=?').run(l.id);
  res.json(listingRow(l));
});

// Related listings
router.get('/:id/related', (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!l) return res.json([]);
  const rows = db.prepare('SELECT * FROM listings WHERE status=\'active\' AND category_id=? AND id!=? ORDER BY rental_count DESC LIMIT 6').all(l.category_id, l.id);
  res.json(rows.map(listingRow));
});

// Create listing
router.post('/', requireAuth, (req, res) => {
  const b = req.body || {};
  // Owner must have accepted current Terms & Conditions and be fully verified to list.
  if (!verify.hasAcceptedTerms(req.user)) {
    return res.status(428).json({ error: 'Accept the current Terms & Conditions before listing an item.', code: 'terms_required' });
  }
  if (!verify.isFullyVerified(req.user)) {
    return res.status(428).json({ error: 'Verify your email, phone and identity before listing an item.', code: 'verify_required', missing: verify.verificationStatus(req.user).missing });
  }
  if (!b.title || !b.price_per_day || !b.location_city) {
    return res.status(400).json({ error: 'Title, price and city required' });
  }
  let catId = b.category_id || null;
  if (!catId && b.categoryName) {
    const cat = db.prepare('SELECT id FROM categories WHERE name=?').get(b.categoryName);
    if (cat) catId = cat.id;
  }
  let subId = null;
  if (b.subcategoryName) {
    const sub = db.prepare('SELECT id FROM subcategories WHERE name=? AND category_id=?').get(b.subcategoryName, catId);
    if (sub) subId = sub.id;
  }
  const bundleItems = b.bundle_items && Array.isArray(b.bundle_items) ? JSON.stringify(b.bundle_items) : '[]';
  const now = Date.now();
  const dep = depositFromBody(b);
  if (dep.error) return res.status(400).json({ error: dep.error });
  const info = db.prepare(
    `INSERT INTO listings (owner_id, category_id, subcategory_id, title, description, price_per_day, security_deposit,
       estimated_value, deposit_tier,
       location_barangay, location_city, location_province, latitude, longitude, delivery_available, pickup_available,
       delivery_fee, min_verification_level, rules, cancellation_policy, condition, accessories, serial_number,
       is_bundle, bundle_items, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    req.user.id, catId, subId, b.title, b.description || '', parseInt(b.price_per_day, 10), dep.deposit,
    dep.value, dep.tier,
    b.location_barangay || '', b.location_city, b.location_province || '', b.latitude || null, b.longitude || null,
    b.delivery_available ? 1 : 0, b.pickup_available !== false ? 1 : 0, parseInt(b.delivery_fee || '0', 10),
    parseInt(b.min_verification_level || '2', 10), b.rules || '', b.cancellation_policy || 'standard',
    b.condition || '', b.accessories || '', b.serial_number || '', b.is_bundle ? 1 : 0, bundleItems, 'active', now, now
  );
  const lid = info.lastInsertRowid;
  (b.images || []).forEach((url, i) => {
    db.prepare('INSERT INTO listing_images (listing_id, url, is_primary, sort_order) VALUES (?,?,?,?)').run(lid, url, i === 0 ? 1 : 0, i);
  });
  notify(req.user.id, 'listing_created', 'Listing published', `Your listing "${b.title}" is now live and available to renters.`, `/listing/${lid}`);
  const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(lid);
  res.json(listingRow(listing));
});

// Update listing
router.put('/:id', requireAuth, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  if (l.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const b = req.body || {};
  let estValue = l.estimated_value || 0;
  let depTier = l.deposit_tier || 'low';
  let secDeposit = l.security_deposit;
  if (b.estimated_value !== undefined || b.deposit_tier !== undefined) {
    const dep = depositFromBody({ estimated_value: b.estimated_value !== undefined ? b.estimated_value : l.estimated_value, deposit_tier: b.deposit_tier || l.deposit_tier });
    if (dep.error) return res.status(400).json({ error: dep.error });
    estValue = dep.value;
    depTier = dep.tier;
    secDeposit = dep.deposit;
  } else if (b.security_deposit !== undefined) {
    secDeposit = parseInt(b.security_deposit, 10);
  }
  db.prepare(
    `UPDATE listings SET title=?, description=?, price_per_day=?, security_deposit=?, estimated_value=?, deposit_tier=?, status=?, updated_at=? WHERE id=?`
  ).run(b.title || l.title, b.description !== undefined ? b.description : l.description,
    b.price_per_day ? parseInt(b.price_per_day, 10) : l.price_per_day,
    secDeposit, estValue, depTier,
    b.status || l.status, Date.now(), l.id);
  if (b.images && Array.isArray(b.images)) {
    db.prepare('DELETE FROM listing_images WHERE listing_id=?').run(l.id);
    b.images.forEach((url, i) => db.prepare('INSERT INTO listing_images (listing_id, url, is_primary, sort_order) VALUES (?,?,?,?)').run(l.id, url, i === 0 ? 1 : 0, i));
  }
  const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(l.id);
  res.json(listingRow(listing));
});

// Delete listing
router.delete('/:id', requireAuth, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  if (l.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM listings WHERE id=?').run(l.id);
  res.json({ ok: true });
});

// Favorite toggle
router.post('/:id/favorite', requireAuth, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  const existing = db.prepare('SELECT id FROM favorites WHERE user_id=? AND listing_id=?').get(req.user.id, l.id);
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE id=?').run(existing.id);
    db.prepare('UPDATE listings SET favorite_count = MAX(0, favorite_count-1) WHERE id=?').run(l.id);
  } else {
    db.prepare('INSERT INTO favorites (user_id, listing_id, created_at) VALUES (?,?,?)').run(req.user.id, l.id, Date.now());
    db.prepare('UPDATE listings SET favorite_count = favorite_count+1 WHERE id=?').run(l.id);
  }
  res.json({ favorited: !existing });
});

// Promote / feature a listing
router.post('/:id/promote', requireAuth, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  if (l.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { plan } = req.body || {};
  const fees = getFeaturedPlans();
  if (!plan || !fees[plan]) return res.status(400).json({ error: 'Invalid promotion plan' });
  const fee = fees[plan];
  const bal = db.prepare('SELECT wallet_balance FROM users WHERE id=?').get(req.user.id);
  if (bal.wallet_balance < fee) return res.status(400).json({ error: 'Insufficient wallet balance to promote' });
  const days = plan === 'basic' ? 7 : plan === 'plus' ? 14 : 30;
  ledger.addEntry({ userId: req.user.id, type: 'promotion', amount: -fee, meta: { listing_id: l.id, plan } });
  db.prepare('UPDATE listings SET featured=1, featured_until=? WHERE id=?').run(Date.now() + days * 24 * 60 * 60 * 1000, l.id);
  db.prepare('INSERT INTO promotions (listing_id, plan, fee, starts_at, ends_at, status, created_at) VALUES (?,?,?,?,?,?,?)').run(
    l.id, plan, fee, Date.now(), Date.now() + days * 24 * 60 * 60 * 1000, 'active', Date.now()
  );
  db.prepare('INSERT INTO featured_payments (listing_id, user_id, plan, amount, status, created_at) VALUES (?,?,?,?,?,?)').run(
    l.id, req.user.id, plan, fee, 'succeeded', Date.now()
  );
  res.json({ ok: true, fee, days, balance: db.prepare('SELECT wallet_balance FROM users WHERE id=?').get(req.user.id).wallet_balance });
});

module.exports = router;
