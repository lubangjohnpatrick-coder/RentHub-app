'use strict';

// GoRentHive is not a delivery provider. Normalize listings and bookings so the
// platform never charges a delivery fee, dispatches a courier, or presents an
// owner/renter-arranged handover as a GoRentHive transport service.
module.exports = function noPlatformDelivery(req, res, next) {
  const path = String(req.path || '');

  // Retire all legacy courier-management endpoints. Users may independently
  // arrange a third-party courier, but that occurs outside GoRentHive's dispatch
  // and fee flow.
  if (/^\/bookings\/[^/]+\/delivery(?:\/|$)/.test(path)) {
    return res.status(410).json({
      error: 'GoRentHive does not operate or dispatch delivery services. Arrange pickup, a safe meetup, or an independent third-party courier directly with the other party.',
      code: 'platform_delivery_retired',
    });
  }

  if (!req.body || typeof req.body !== 'object') return next();

  const isBookingRequest = req.method === 'POST' && (
    path === '/bookings' || path === '/bookings/quote' || path === '/bookings/paymongo'
  );
  if (isBookingRequest) {
    const target = req.body.booking_draft && typeof req.body.booking_draft === 'object'
      ? req.body.booking_draft : req.body;
    target.delivery_requested = false;
    target.delivery_method = 'pickup';
    target.distance_km = 0;
    target.vehicle_type = '';
    target.delivery_fee = 0;
    // Keep pickup_option / meeting-point fields intact for direct handover.
  }

  // Existing clients may still submit the old listing delivery fields. Keep
  // accepting those clients, but normalize the data to the current business
  // model: no GoRentHive delivery option or delivery revenue.
  const isListingWrite = ['POST','PUT','PATCH'].includes(req.method) && (/^\/listings(?:\/[^/]+)?$/.test(path));
  if (isListingWrite) {
    req.body.delivery_available = false;
    req.body.delivery_fee = 0;
    req.body.pickup_available = true;
  }

  next();
};
