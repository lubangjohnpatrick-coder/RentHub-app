'use strict';

const express = require('express');
const { requireAuth } = require('./auth-service');
const router = express.Router();

// Public pricing advertises Pro and Business as Coming Soon. Keep the legacy
// premium compatibility code available for existing-account reads, but reject
// every new purchase server-side so a browser/API call cannot bypass the UI.
router.post('/account/premium', requireAuth, (req, res) => {
  res.status(409).json({
    error: 'GoRentHive Pro is not available for purchase yet. No subscription charge was made.',
    code: 'plan_not_released',
    plan: 'pro',
    planned_price_php: 299,
  });
});

module.exports = router;
