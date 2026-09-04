'use strict';

// Server-side settings backed by Supabase admin_settings.
// Server only — uses the service-role client.

const { svcClient } = require('./supabase');

async function getSetting(key, fallback) {
  try {
    const { data, error } = await svcClient()
      .from('admin_settings').select('value').eq('key', key).limit(1).single();
    if (error || !data) return fallback;
    return data.value;
  } catch (e) {
    return fallback;
  }
}

async function setSetting(key, value) {
  const { error } = await svcClient()
    .from('admin_settings')
    .upsert({ key, value: String(value), updated_at: Date.now() }, { onConflict: 'key' });
  if (error) throw new Error('Settings error: ' + error.message);
}

// GoRentHive commission is exactly the configured percentage of the rental
// fee (8% by default). There is intentionally no minimum commission: the
// owner keeps 92% of the rental fee at the default rate.
async function computePlatformFee(rentalPrice) {
  const percent = parseFloat((await getSetting('platform_percent', '8'))) || 8;
  const fee = Math.round((Math.max(0, Number(rentalPrice) || 0) * percent) / 100);
  return Math.max(0, fee);
}

// Historical snapshot rate used at the moment a booking is created, so later
// changes to the commission setting never rewrite the history of a past booking.
async function getPlatformRate() {
  const percent = parseFloat((await getSetting('platform_percent', '8'))) || 8;
  return { percent, minFee: 0 };
}

// Free-plan monthly active-listing cap (premium = unlimited).
async function getFreeListingLimit() {
  return parseInt(await getSetting('free_listing_limit', '15'), 10) || 15;
}

// One-time fee per extra listing posted while over the free cap.
async function getExtraListingFee() {
  return parseInt(await getSetting('extra_listing_fee', '10'), 10) || 10;
}

// Premium membership yearly fee in pesos.
async function getPremiumFee() {
  return parseInt(await getSetting('premium_fee', '1499'), 10) || 1499;
}

// Featured/boost: fee and duration in days.
async function getFeaturedPlan() {
  const fee = parseInt(await getSetting('featured_fee', '49'), 10) || 49;
  const days = parseInt(await getSetting('featured_days', '30'), 10) || 30;
  return { fee, days };
}

// Legacy multi-tier plans kept for backwards-compat.
async function getFeaturedPlans() {
  const basic = parseInt(await getSetting('featured_fee_basic', '49'), 10);
  const plus = parseInt(await getSetting('featured_fee_plus', '99'), 10);
  const premium = parseInt(await getSetting('featured_fee_premium', '199'), 10);
  return { basic, plus, premium };
}

module.exports = {
  getSetting,
  setSetting,
  computePlatformFee,
  getPlatformRate,
  getFreeListingLimit,
  getExtraListingFee,
  getPremiumFee,
  getFeaturedPlan,
  getFeaturedPlans,
};
