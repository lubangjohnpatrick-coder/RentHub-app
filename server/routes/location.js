'use strict';

const express = require('express');
const settings = require('../settings');
const router = express.Router();

// Public config for the location-security UI: radius filter options and
// whether location verification is required. No secrets.
router.get('/config', (req, res) => {
  const raw = settings.getSetting('location_radius_options', '5,10,25');
  const radiusOptions = raw.split(',').map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n) && n > 0);
  res.json({
    require_location: settings.getSetting('require_location', '1') === '1',
    radius_options: radiusOptions.length ? radiusOptions : [5, 10, 25],
    location_verified: false,
  });
});

module.exports = router;
