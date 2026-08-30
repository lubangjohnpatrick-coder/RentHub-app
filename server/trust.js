'use strict';

// Trust-score & risk-based pricing.
//
// Trust reflects a user's reliability as a marketplace participant so that a
// well-rated, experienced renter can be offered a reduced security deposit.
// The score is purely server-side (never computed from the frontend) and driven
// by verifiable transaction history: ratings received, completed/cancelled
// rentals, and the successful-return rate.

const settings = require('./settings');

// Successful-return rate as a 0-100 percentage, or null when there is not yet
// enough rental history to meaningfully compute one. Cancels reduce the rate;
// completed (successfully returned) rentals raise it.
function successfulReturnRate(user) {
  if (!user) return null;
  const done = parseInt(user.successful_rentals, 10) || 0;
  const cancelled = parseInt(user.cancelled_rentals, 10) || 0;
  const total = done + cancelled;
  if (total <= 0) return null;
  return Math.round((done / total) * 100);
}

// Average star rating from accumulated rating_sum / review_count (0-5), or null
// when the user has no ratings yet.
function averageRating(user) {
  if (!user) return null;
  const count = parseInt(user.review_count, 10) || 0;
  if (count <= 0) return null;
  return (parseInt(user.rating_sum, 10) || 0) / count;
}

// Composite 0-100 trust score based on verifiable history:
//   - rating component   (0-40): scales the average 1-5 rating.
//   - experience         (0-30): rewards volume of completed rentals (capped).
//   - successful-return  (0-30): rewards a clean return record.
function trustScore(user) {
  if (!user) return 0;
  let score = 0;

  const avg = averageRating(user);
  if (avg != null) {
    // 5.0 -> 40, 1.0 -> 8, so even minimum ratings still grant a small base.
    score += Math.round((avg / 5) * 40);
  }

  const done = parseInt(user.successful_rentals, 10) || 0;
  score += Math.min(30, done * 3); // up to 30 after 10 rentals

  const rate = successfulReturnRate(user);
  if (rate != null) score += Math.round((rate / 100) * 30);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function trustLevel(score) {
  if (score >= 80) return 'High';
  if (score >= 50) return 'Moderate';
  if (score >= 20) return 'Low';
  return 'New';
}

// Structured trust profile exposed to other users and used for pricing.
function userTrust(user) {
  const score = trustScore(user);
  return {
    trust_score: score,
    trust_level: trustLevel(score),
    successful_return_rate: successfulReturnRate(user),
    average_rating: averageRating(user)
      ? Math.round(averageRating(user) * 10) / 10
      : null,
    review_count: user ? parseInt(user.review_count, 10) || 0 : 0,
    successful_rentals: user ? parseInt(user.successful_rentals, 10) || 0 : 0,
    cancelled_rentals: user ? parseInt(user.cancelled_rentals, 10) || 0 : 0,
  };
}

// Risk-based deposit pricing: a renter whose trust score meets the configured
// minimum gets a percentage discount off the required security deposit. Returns
// { enabled, discount_pct, effective_deposit }. With no qualifying trust the
// original deposit is returned unchanged.
function depositDiscount(user, deposit) {
  const enabled = settings.getSetting('trust_deposit_discount_enabled', '1') !== '0';
  const minScore = parseInt(settings.getSetting('trust_deposit_min_score', '80'), 10) || 80;
  const pct = parseInt(settings.getSetting('trust_deposit_discount_pct', '50'), 10) || 0;
  const amount = Math.max(0, parseInt(deposit, 10) || 0);

  if (!enabled || pct <= 0 || amount <= 0) {
    return { enabled, discount_pct: 0, effective_deposit: amount };
  }

  const score = trustScore(user);
  if (score < minScore) {
    return { enabled, discount_pct: 0, effective_deposit: amount, trust_score: score, min_score: minScore };
  }

  const effective = Math.round(amount * (100 - Math.max(0, Math.min(100, pct))) / 100);
  return { enabled, discount_pct: pct, effective_deposit: effective, trust_score: score, min_score: minScore };
}

module.exports = {
  successfulReturnRate,
  averageRating,
  trustScore,
  trustLevel,
  userTrust,
  depositDiscount,
};
