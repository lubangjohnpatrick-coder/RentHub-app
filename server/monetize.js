'use strict';

// Monetization rules (GoRentHive):
//  - Commission: 8% of rental fee, min 20 (see settings.computePlatformFee)
//  - Premium membership: 1499/yr -> unlimited listings + seller dashboard
//  - Free users: 15 active listings/month; extra = 10/listing (one-time)
//  - Featured boost: 49 / 30 days, prioritised in search
// Server only — service-role via Supabase. All charges debit the wallet ledger.

const { svcClient } = require('./supabase');
const { addEntry, getUserBalance } = require('./ledger');
const revenue = require('./revenue');
const {
  getFreeListingLimit,
  getExtraListingFee,
  getPremiumFee,
  getFeaturedPlan,
} = require('./settings');

const NOW = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

async function isPremium(user) {
  return !!(user && user.premium_until && user.premium_until > NOW());
}

// Count active listings posted by a user in the current calendar month.
async function countListingsThisMonth(userId) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { count, error } = await svcClient()
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .gte('created_at', start.getTime());
  if (error) throw new Error('Count listings error: ' + error.message);
  return count || 0;
}

// Enforce free-plan cap on listing creation. Returns { allowed, over, fee }
// If over the cap, the extra listings incur a one-time 10 each charged to wallet.
async function enforceListingCap(user, newCount = 1) {
  if (await isPremium(user)) return { allowed: true, over: 0, fee: 0 };
  const limit = await getFreeListingLimit();
  const current = await countListingsThisMonth(user.id);
  const over = Math.max(0, current + newCount - limit);
  if (over === 0) return { allowed: true, over: 0, fee: 0 };
  const per = await getExtraListingFee();
  const fee = over * per;
  const bal = await getUserBalance(user.id);
  if (bal < fee) {
    return {
      allowed: false, over, fee, insufficient: true,
      error: `You've used your ${limit} free listings this month. ${over} extra listing(s) = ₱${fee}. Add funds to continue.`,
    };
  }
  return { allowed: true, over, fee, insufficient: false };
}

async function chargeListingOverage(user, over) {
  if (!over) return;
  const per = await getExtraListingFee();
  const fee = over * per;
  await addEntry({ userId: user.id, type: 'listing_fee', amount: -fee, meta: { listings: over, reason: 'extra_listing_over_free_cap' } });
  await revenue.addIncome('extra_listing', fee);
}

// Buy / renew premium membership (charge wallet, extend premium_until by 365 days).
async function purchasePremium(user) {
  const fee = await getPremiumFee();
  const bal = await getUserBalance(user.id);
  if (bal < fee) return { ok: false, error: `Premium costs ₱${fee}. Wallet balance is ₱${bal}. Please top up.`, fee };
  const base = user.premium_until && user.premium_until > NOW() ? user.premium_until : NOW();
  const premium_until = base + 365 * DAY_MS;
  const { data, error } = await svcClient()
    .from('users').update({ premium_until }).eq('id', user.id).select('premium_until').single();
  if (error) throw new Error('Premium update error: ' + error.message);
  await addEntry({ userId: user.id, type: 'premium', amount: -fee, meta: { premium_until, reason: 'premium_membership_1yr' } });
  await revenue.addIncome('premium', fee);
  return { ok: true, premium_until, fee };
}

// Boost a listing to featured for 30 days (charge wallet, set featured flags, log).
async function boostListing(user, listingId) {
  const { data: l, error } = await svcClient().from('listings').select('owner_id,id').eq('id', listingId).single();
  if (error || !l) return { ok: false, error: 'Listing not found' };
  if (l.owner_id !== user.id && user.role !== 'admin') return { ok: false, error: 'Not your listing' };
  const { fee, days } = await getFeaturedPlan();
  const bal = await getUserBalance(user.id);
  if (bal < fee) return { ok: false, error: `Featured boost costs ₱${fee}. Wallet balance is ₱${bal}. Please top up.`, fee };
  const startsAt = NOW();
  const endsAt = startsAt + days * DAY_MS;
  const { error: upErr } = await svcClient()
    .from('listings').update({ featured: true, featured_until: endsAt }).eq('id', listingId);
  if (upErr) throw new Error('Boost update error: ' + upErr.message);
  await addEntry({ userId: user.id, type: 'featured', amount: -fee, meta: { listing_id: listingId, ends_at: endsAt, reason: 'featured_boost' } });
  await revenue.addIncome('featured', fee);
  await svcClient().from('promotions').insert({
    listing_id: listingId, plan: 'premium', fee, starts_at: startsAt, ends_at: endsAt, status: 'active', created_at: startsAt,
  });
  await svcClient().from('featured_payments').insert({
    listing_id: listingId, user_id: user.id, plan: 'boost', amount: fee, status: 'succeeded', created_at: startsAt,
  });
  return { ok: true, fee, ends_at: endsAt };
}

// Seller dashboard: listings, sales (completed bookings), gross income, business summary.
async function sellerDashboard(user) {
  const { data: listings, error: lErr } = await svcClient()
    .from('listings').select('*').eq('owner_id', user.id).order('created_at', { ascending: false });
  if (lErr) throw new Error('Listings error: ' + lErr.message);
  const { data: bookings, error: bErr } = await svcClient()
    .from('bookings').select('*').eq('owner_id', user.id).order('created_at', { ascending: false });
  if (bErr) throw new Error('Bookings error: ' + bErr.message);

  const activeListings = (listings || []).filter((l) => l.status === 'active');
  const completed = (bookings || []).filter((b) => b.status === 'completed');
  const grossIncome = completed.reduce((s, b) => s + (b.rental_fee || 0) + (b.delivery_fee || 0), 0);
  const platformFees = completed.reduce((s, b) => s + (b.platform_fee || 0), 0);
  const netIncome = completed.reduce((s, b) => s + (b.amount_due_owner || 0), 0);
  const totalBookings = (bookings || []).length;
  const pendingBookings = (bookings || []).filter((b) => b.status === 'pending' || b.status === 'approved').length;
  const totalRentals = (listings || []).reduce((s, l) => s + (l.rental_count || 0), 0);

  return {
    premium: await isPremium(user),
    counts: {
      active_listings: activeListings.length,
      total_listings: (listings || []).length,
      total_bookings: totalBookings,
      pending_bookings: pendingBookings,
      completed_bookings: completed.length,
      total_rentals: totalRentals,
    },
    money: {
      gross_income: grossIncome,
      platform_fees: platformFees,
      net_income: netIncome,
    },
    listings: (listings || []).map((l) => ({
      id: l.id, title: l.title, status: l.status, price_per_day: l.price_per_day,
      featured: !!l.featured, featured_until: l.featured_until,
      rental_count: l.rental_count || 0, created_at: l.created_at,
    })),
    recent_bookings: (bookings || []).slice(0, 10).map((b) => ({
      id: b.id, booking_ref: b.booking_ref, listing_id: b.listing_id,
      rental_fee: b.rental_fee, platform_fee: b.platform_fee, amount_due_owner: b.amount_due_owner,
      status: b.status, created_at: b.created_at,
    })),
  };
}

module.exports = {
  isPremium,
  countListingsThisMonth,
  enforceListingCap,
  chargeListingOverage,
  purchasePremium,
  boostListing,
  sellerDashboard,
};
