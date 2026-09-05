'use strict';

const assert = require('assert');
const vehicle = require('./vehicle-compliance')._test;
const handover = require('./handover-code')._test;

assert(vehicle.isVehicleCategoryName('Vehicles'));
assert(vehicle.isVehicleCategoryName('Cars & Vans'));
assert(vehicle.isVehicleCategoryName('Motorcycles'));
assert(!vehicle.isVehicleCategoryName('Cameras'));
assert(!vehicle.isVehicleCategoryName('Party & Events'));

const future = Date.now() + 86400000;
const compliant = {
  status: 'verified',
  or_cr_verified: true,
  ltfrb_verified: true,
  insurance_verified: true,
  ctpl_verified: true,
  rental_use_covered: true,
  or_cr_expiry: future,
  ltfrb_expiry: future,
  insurance_expiry: future,
  ctpl_expiry: future,
};
assert.strictEqual(vehicle.complianceCurrent(compliant), true);
assert.strictEqual(vehicle.complianceCurrent({ ...compliant, rental_use_covered: false }), false);
assert.strictEqual(vehicle.complianceCurrent({ ...compliant, ltfrb_expiry: Date.now() - 1 }), false);
assert.strictEqual(vehicle.driverCurrent({ status: 'verified', license_expiry: future }), true);
assert.strictEqual(vehicle.driverCurrent({ status: 'pending', license_expiry: future }), false);

assert.strictEqual(handover.normalizeCode('12-34 56'), '123456');
assert.strictEqual(handover.normalizeCode('1234567'), '123456');
assert.strictEqual(handover.readyForHandover({
  status: 'approved', payment_confirmed: true,
  agreement_signed_renter: true, agreement_signed_owner: true,
  checkin_confirmed: true,
}), true);
assert.strictEqual(handover.readyForHandover({
  status: 'approved', payment_confirmed: true,
  agreement_signed_renter: true, agreement_signed_owner: false,
  checkin_confirmed: true,
}), false);
assert.strictEqual(handover.codeHash(123, '123456'), handover.codeHash(123, '123456'));
assert.notStrictEqual(handover.codeHash(123, '123456'), handover.codeHash(123, '654321'));

console.log('marketplace upgrades regression tests passed');
