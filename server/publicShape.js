'use strict';

// Shared response-shape helpers. Public marketplace responses intentionally do
// not expose exact listing coordinates. Distance is calculated server-side by
// the verified-radius endpoint and only the rounded distance is returned.

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    full_name: u.full_name || '',
    avatar: u.avatar || '',
    role: u.role || 'user',
    is_owner: !!u.is_owner,
    is_business: !!u.is_business,
    premium_until: u.premium_until || null,
    is_premium: !!(u.premium_until && u.premium_until > Date.now()),
    mobile_verified: !!u.mobile_verified,
    email_verified: !!u.email_verified,
    identity_status: u.identity_status || 'none',
    identity_level: u.identity_level || 1,
    address: u.address || '',
    barangay: u.barangay || '',
    city: u.city || '',
    province: u.province || '',
    location_verified: u.location_status === 'verified',
    location_status: u.location_status || 'none',
    location_verified_by: u.location_verified_by || '',
    vessel_rating: u.vessel_rating || 0,
    review_count: u.review_count || 0,
    successful_rentals: u.successful_rentals || 0,
    cancelled_rentals: u.cancelled_rentals || 0,
    trust_score: Number(u.vessel_rating || 0),
    trust_level: trustLevel(u.vessel_rating || 0, u.review_count || 0),
    successful_return_rate: successRate(u),
    verificationBadge: !!u.email_verified && !!u.mobile_verified && u.identity_status === 'verified',
    locationBadge: u.location_status === 'verified',
  };
}

function trustLevel(rating, count) {
  if (count <= 0) return 'new';
  if (rating >= 4.5) return 'gold';
  if (rating >= 4) return 'trusted';
  if (rating >= 3) return 'verified';
  return 'new';
}

function successRate(u) {
  const total = (u.successful_rentals || 0) + (u.cancelled_rentals || 0);
  if (total <= 0) return null;
  return Math.round((u.successful_rentals / total) * 1000) / 1000;
}

async function listingRow({ row, images, category, owner, reviews }) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    price_per_day: row.price_per_day,
    security_deposit: row.security_deposit || 0,
    estimated_value: row.estimated_value || 0,
    deposit_tier: row.deposit_tier || 'low',
    deposit_tier_info: depositTierInfo(row.deposit_tier, row.security_deposit),
    location_city: row.location_city || '',
    location_barangay: row.location_barangay || '',
    location_province: row.location_province || '',
    // latitude/longitude deliberately omitted from all public listing shapes.
    distance_km: row.distance_km != null ? row.distance_km : null,
    // GoRentHive does not operate a delivery service. Old DB columns can remain
    // for migration compatibility but are never advertised as platform delivery.
    delivery_available: false,
    pickup_available: true,
    delivery_fee: 0,
    min_verification_level: row.min_verification_level || 2,
    rules: row.rules || '',
    condition: row.condition || '',
    accessories: row.accessories || '',
    serial_number: row.serial_number,
    featured: !!row.featured,
    status: row.status,
    is_bundle: !!row.is_bundle,
    bundle_items: safeJson(row.bundle_items, []),
    view_count: row.view_count || 0,
    favorite_count: row.favorite_count || 0,
    rental_count: row.rental_count || 0,
    created_at: row.created_at,
    images: (images && images.length ? images : ['/images/svg/placeholder.svg']),
    category: category ? { id: category.id, name: category.name, icon: category.icon, color: category.color } : null,
    owner: owner ? { ...publicUser(owner), is_owner: true } : null,
    reviews: reviews || [],
    avg_rating: row.avg_rating != null ? String(row.avg_rating) : null,
  };
}

function depositTierInfo(tier, amount) {
  const map = { low: { key: 'low', deposit: 0.1, label: 'Low' }, medium: { key: 'medium', deposit: 0.2, label: 'Medium' }, high: { key: 'high', deposit: 0.3, label: 'High' } };
  const t = map[tier] || map.low;
  return { key: t.key, deposit: t.deposit, label: t.label, amount: Math.round((amount || 0) * t.deposit) };
}

function safeJson(s, fb) {
  try { const v = JSON.parse(s); return v == null ? fb : v; } catch (e) { return fb; }
}

function computeDeposit(estimatedValue, tier) {
  const pct = { low: 0.1, medium: 0.2, high: 0.3 }[tier] || 0.1;
  return Math.round((estimatedValue || 0) * pct);
}

module.exports = { publicUser, listingRow, trustLevel, safeJson, computeDeposit };
