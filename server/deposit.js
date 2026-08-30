'use strict';

const settings = require('./settings');

// Tiered deposit system: the refundable security deposit scales with the item's
// estimated replacement value so cheap items don't overburden renters while
// valuable items keep owners protected. Tier amounts and value-band boundaries
// are configurable via admin_settings (never frontend).
const TIERS = ['low', 'medium', 'high'];

function tierInfo(tier, lang) {
  const amount = tierDeposit(tier);
  return {
    key: tier,
    deposit: amount,
    label: lang === 'fil' ? { low: 'Mababa', medium: 'Katamtaman', high: 'Mataas' }[tier] : tier[0].toUpperCase() + tier.slice(1),
  };
}

function tierDeposit(tier) {
  return parseInt(settings.getSetting('deposit_tier_' + tier, { low: '300', medium: '1000', high: '3500' }[tier]), 10) || 0;
}

// Which tier an item's estimated value should fall into.
function recommendedTier(estimatedValue) {
  const v = parseInt(estimatedValue || '0', 10);
  const lowMax = parseInt(settings.getSetting('deposit_tier_low_max_value', '3000'), 10) || 3000;
  const medMax = parseInt(settings.getSetting('deposit_tier_medium_max_value', '15000'), 10) || 15000;
  if (v <= lowMax) return 'low';
  if (v <= medMax) return 'medium';
  return 'high';
}

// Validate an owner's tier selection against the item value so a cheap item
// can't be saddled with a high deposit (renter burden) nor a valuable item
// under-protected with a tiny deposit.
function validateTierSelection(tier, estimatedValue) {
  if (!TIERS.includes(tier)) return { ok: false, error: 'Invalid deposit tier.' };
  const rec = recommendedTier(estimatedValue);
  if (tier !== rec) {
    const recInfo = tierInfo(rec);
    return { ok: false, error: `Deposit tier does not match this item's estimated value (recommended: ${recInfo.label} — ₱${recInfo.deposit}).` };
  }
  return { ok: true };
}

module.exports = { TIERS, tierInfo, tierDeposit, recommendedTier, validateTierSelection };
