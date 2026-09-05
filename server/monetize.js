'use strict';

// Monetization rules (GoRentHive):
//  - Commission: 8% of the completed rental amount (see settings.computePlatformFee)
//  - Free users: first 5 active listings; extra listings use the configured overage fee
//  - Legacy Premium billing remains only for backwards compatibility while the
//    new Pro (₱299/mo) and Business (₱999/mo) plans are labelled Coming Soon.
//  - Featured boost: configured one-time fee / duration, prioritised in search.
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

// Historical function name retained for compatibility. The public plan is an
// active-listing allowance, so count currently active inventory rather than
// every listing created during a calendar month.
async function countListingsThisMonth(userId) {
  const { count, error } = await svcClient()
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .eq('status', 'active');
  if (error) throw new Error('Count active listings error: ' + error.message);
  return count || 0;
}

// Charge only for the newly-added over-cap inventory. Without the incremental
// calculation, an owner with six active listings would be charged again for
// the sixth listing when creating the seventh.
async function enforceListingCap(user, newCount = 1) {
  if (await isPremium(user)) return { allowed: true, over: 0, fee: 0 };
  const limit = await getFreeListingLimit();
  const current = await countListingsThisMonth(user.id);
  const beforeOver = Math.max(0, current - limit);
  const afterOver = Math.max(0, current + Math.max(1, Number(newCount) || 1) - limit);
  const over = Math.max(0, afterOver - beforeOver);
  if (over === 0) return { allowed: true, over: 0, fee: 0 };
  const per = await getExtraListingFee();
  const fee = over * per;
  const bal = await getUserBalance(user.id);
  if (bal < fee) {
    return {
      allowed: false, over, fee, insufficient: true,
      error: `Your ${limit} free active listings are already in use. ${over} additional listing(s) = ₱${fee}. Add funds to continue.`,
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

// Legacy purchase path retained for existing premium accounts only. A release
// guard mounted before the private compatibility routes rejects new purchases
// while the new Pro/Business plan contracts remain Coming Soon.
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
