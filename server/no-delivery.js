'use strict';

// GoRentHive is not a delivery provider. Normalize booking requests so the
// core financial engine never charges a platform delivery fee or creates a
// GoRentHive-arranged courier booking. Owners/renters may still agree on a
// pickup/meetup or independently arrange a third-party courier off this flow.
module.exports = function noPlatformDelivery(req, res, next) {
  if (!req.body || typeof req.body !== 'object') return next();
  const isBookingRequest = req.method === 'POST' && (
    req.path === '/bookings' || req.path === '/bookings/quote' || req.path === '/bookings/paymongo'
  );
  if (!isBookingRequest) return next();

  const target = req.body.booking_draft && typeof req.body.booking_draft === 'object'
    ? req.body.booking_draft : req.body;
  target.delivery_requested = false;
  target.delivery_method = 'pickup';
  target.distance_km = 0;
  target.vehicle_type = '';
  // Keep pickup_option / meeting point fields intact for owner-renter handover.
  next();
};
