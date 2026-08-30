'use strict';

// Provider-agnostic delivery gateway (mirrors server/payment.js).
// Swap `this.driver` to plug in a real Lalamove client; the rest of the app
// talks only to this interface (quote / createDeliveryOrder). The sandbox
// driver simulates quotes and orders so the full flow works in the demo.

const settings = require('./settings');

const VEHICLES = ['motorcycle', 'car', 'truck'];

function baseFee() { return parseInt(settings.getSetting('lalamove_base_fee', '70'), 10) || 70; }
function perKm() { return parseInt(settings.getSetting('lalamove_per_km', '20'), 10) || 20; }
function vehicleSurcharge(v) {
  return parseInt(settings.getSetting('lalamove_vehicle_' + (v || 'motorcycle'), '0'), 10) || 0;
}
function enabled() { return settings.getSetting('lalamove_enabled', '1') === '1'; }

// Quote a delivery cost from distance + vehicle type using the configured
// tariff. The provider decides the exact number.
class SandboxDelivery {
  constructor() { this.name = 'sandbox'; }
  quote({ distanceKm, vehicleType }) {
    const d = Math.max(0, Number(distanceKm) || 0);
    const v = VEHICLES.includes(vehicleType) ? vehicleType : 'motorcycle';
    const fee = baseFee() + Math.round(perKm() * d) + vehicleSurcharge(v);
    return { fee, distanceKm: d, vehicleType: v };
  }
  createOrder({ bookingRef, phase, origin, dropoff, distanceKm, vehicleType, fee }) {
    const v = VEHICLES.includes(vehicleType) ? vehicleType : 'motorcycle';
    const id = 'LLM-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    return {
      providerOrderId: id,
      status: 'accepted',
      driverName: 'Driver ' + Math.floor(Math.random() * 900 + 100),
      driverPhone: '0917' + String(Math.floor(Math.random() * 90000000 + 10000000)),
      trackingUrl: 'https://track.lalamove.demo/' + id.toLowerCase(),
      quote: { distanceKm, vehicleType: v, fee },
    };
  }
}

class DeliveryGateway {
  constructor() {
    // Swap this to plug in a real Lalamove client.
    this.driver = new SandboxDelivery();
    this.enabled = () => enabled();
  }
  quote(args) { return this.driver.quote(args); }
  createDeliveryOrder(args) { return this.driver.createOrder(args); }
}

const gateway = new DeliveryGateway();

module.exports = { gateway, VEHICLES };
