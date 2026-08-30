'use strict';

const express = require('express');
const db = require('../db/schema');
const { requireAuth } = require('../auth');
const settings = require('../settings');
const { notify } = require('../notify');
const router = express.Router();

// Submit a mutual rating (owner <-> renter) on a completed booking.
// Each party (owner and renter) can rate the other at most once per booking.
router.post('/', requireAuth, (req, res) => {
  const { booking_id, rating, comment, target_user_id, listing_id } = req.body || {};
  if (!booking_id || !rating || !target_user_id) return res.status(400).json({ error: 'Missing fields' });
  const ratingN = parseInt(rating, 10);
  if (ratingN < 1 || ratingN > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(booking_id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (b.status !== 'completed') return res.status(400).json({ error: 'Only completed rentals can be rated' });

  // Only the two parties involved may rate, and only on each other.
  const isRenter = Number(b.renter_id) === Number(req.user.id);
  const isOwner = Number(b.owner_id) === Number(req.user.id);
  if (!isRenter && !isOwner) return res.status(403).json({ error: 'Only booking parties can rate' });
  const expectedTarget = isRenter ? b.owner_id : b.renter_id;
  if (Number(target_user_id) !== Number(expectedTarget)) {
    return res.status(400).json({ error: 'You may only rate the other party on this booking' });
  }

  const dedup = settings.getSetting('review_dedup_enabled', '1') !== '0';
  if (dedup) {
    const existing = db.prepare('SELECT id FROM booking_reviews WHERE booking_id=? AND reviewer_id=?').get(booking_id, req.user.id);
    if (existing) return res.status(409).json({ error: 'You already rated this booking' });
    db.prepare('INSERT INTO booking_reviews (booking_id, reviewer_id, target_user_id, rating, comment, created_at) VALUES (?,?,?,?,?,?)').run(
      booking_id, req.user.id, target_user_id, ratingN, comment || '', Date.now()
    );
  }

  // Rating the target user
  db.prepare('UPDATE users SET rating_sum=rating_sum+?, review_count=review_count+1 WHERE id=?').run(ratingN, target_user_id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(target_user_id);
  db.prepare('UPDATE users SET vessel_rating=? WHERE id=?').run((u.rating_sum / u.review_count).toFixed(2), target_user_id);

  // Listing review if provided (renter reviewing the item)
  if (listing_id && comment !== undefined) {
    const exists = db.prepare('SELECT id FROM listing_reviews WHERE listing_id=? AND author_id=?').get(listing_id, req.user.id);
    if (!exists) {
      db.prepare('INSERT INTO listing_reviews (listing_id, author_id, rating, comment, created_at) VALUES (?,?,?,?,?)').run(
        listing_id, req.user.id, ratingN, comment || '', Date.now()
      );
    }
  }

  notify(target_user_id, 'new_review', 'New rating received', `You received a ${ratingN}-star rating`, `/profile/${target_user_id}`);
  res.json({ ok: true, new_rating: (u.rating_sum / u.review_count).toFixed(2) });
});

module.exports = router;
