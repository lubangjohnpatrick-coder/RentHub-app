'use strict';

const express = require('express');
const delivery = require('../delivery');
const settings = require('../settings');
const router = express.Router();

// Public config for the booking UI (no secrets). Lets the UI know whether
// Lalamove delivery is enabled, which vehicles are available, and the tariff.
router.get('/config', (req, res) => {
  res.json({
    enabled: delivery.gateway.enabled(),
    provider: delivery.gateway.driver.name,
    vehicles: delivery.VEHICLES,
    base_fee: parseInt(settings.getSetting('lalamove_base_fee', '70'), 10) || 70,
    per_km: parseInt(settings.getSetting('lalamove_per_km', '20'), 10) || 20,
    vehicle_surcharge: Object.fromEntries(delivery.VEHICLES.map((v) => [
      v, parseInt(settings.getSetting('lalamove_vehicle_' + v, '0'), 10) || 0,
    ])),
  });
});

module.exports = router;
