'use strict';

const db = require('./db/schema');

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  return row.value;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO admin_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'
  ).run(key, String(value), Date.now());
}

// Platform fee for a rental price. Fee = max(percent, minFee) capped by maxFee if set.
function computePlatformFee(rentalPrice) {
  const percent = parseFloat(getSetting('platform_percent', '4')) || 4;
  const minFee = parseInt(getSetting('platform_min_fee', '20'), 10) || 20;
  const maxFeeRaw = getSetting('platform_max_fee', '');
  let fee = Math.round((rentalPrice * percent) / 100);
  if (fee < minFee) fee = minFee;
  if (maxFeeRaw && fee > parseInt(maxFeeRaw, 10)) fee = parseInt(maxFeeRaw, 10);
  return fee;
}

function getFeaturedPlans() {
  return {
    basic: parseInt(getSetting('featured_fee_basic', '49'), 10),
    plus: parseInt(getSetting('featured_fee_plus', '99'), 10),
    premium: parseInt(getSetting('featured_fee_premium', '199'), 10),
  };
}

module.exports = { getSetting, setSetting, computePlatformFee, getFeaturedPlans };
