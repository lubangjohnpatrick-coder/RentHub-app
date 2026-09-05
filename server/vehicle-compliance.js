'use strict';

// Vehicle rentals are a higher-risk category. This module keeps them out of
// public discovery and blocks booking until the owner/vehicle and renter/driver
// have current verification records. It intentionally stores regulatory data
// server-side and exposes only safe status fields publicly.

const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');

const router = express.Router();
const now = () => Date.now();
let categoryCache = { ids: new Set(), loadedAt: 0 };

function text(v, max = 180) { return String(v || '').trim().slice(0, max); }
function isVehicleCategoryName(name) {
  return /(^|\b)(vehicle|vehicles|car|cars|motorcycle|motorcycles|truck|trucks|van|vans)(\b|$)/i.test(String(name || ''));
}
function expiryMs(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}
function unexpired(v) { return expiryMs(v) > now(); }
function complianceCurrent(row) {
  return !!row && row.status === 'verified' && row.or_cr_verified === true && row.ltfrb_verified === true &&
    row.insurance_verified === true && row.ctpl_verified === true && row.rental_use_covered === true &&
    unexpired(row.or_cr_expiry) && unexpired(row.ltfrb_expiry) && unexpired(row.insurance_expiry) && unexpired(row.ctpl_expiry);
}
function driverCurrent(row) {
  return !!row && row.status === 'verified' && unexpired(row.license_expiry);
}
function publicCompliance(row, required = true) {
  return {
    required,
    verified: required ? complianceCurrent(row) : false,
    status: row ? row.status : 'missing',
    registration_verified: !!(row && row.or_cr_verified),
    ltfrb_authority_verified: !!(row && row.ltfrb_verified),
    rental_insurance_verified: !!(row && row.insurance_verified && row.rental_use_covered),
    ctpl_verified: !!(row && row.ctpl_verified),
  };
}

async function vehicleCategoryIds() {
  if (now() - categoryCache.loadedAt < 5 * 60 * 1000) return categoryCache.ids;
  const { data, error } = await svcClient().from('categories').select('id,name');
  if (error) throw error;
  categoryCache = {
    ids: new Set((data || []).filter((c) => isVehicleCategoryName(c.name)).map((c) => String(c.id))),
    loadedAt: now(),
  };
  return categoryCache.ids;
}

async function listingInfo(listingId) {
  const { data: listing, error } = await svcClient().from('listings').select('id,owner_id,category_id,status,title').eq('id', listingId).limit(1).maybeSingle();
  if (error) throw error;
  if (!listing) return null;
  const ids = await vehicleCategoryIds();
  return { listing, isVehicle: ids.has(String(listing.category_id)) };
}

async function getCompliance(listingId) {
  const { data, error } = await svcClient().from('vehicle_compliance').select('*').eq('listing_id', listingId).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getDriverVerification(userId) {
  const { data, error } = await svcClient().from('driver_verifications').select('*').eq('user_id', userId).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Fail closed for public discovery: unverified vehicles are not advertised.
router.get('/listings', (req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = function wrappedJson(body) {
    if (!Array.isArray(body) || !body.length) return sendJson(body);
    Promise.resolve().then(async () => {
      const vehicleRows = body.filter((row) => isVehicleCategoryName(row && row.category && row.category.name));
      if (!vehicleRows.length) return sendJson(body);
      const ids = vehicleRows.map((r) => r.id).filter(Boolean);
      const { data, error } = await svcClient().from('vehicle_compliance').select('*').in('listing_id', ids);
      const map = new Map((data || []).map((r) => [String(r.listing_id), r]));
      const filtered = body.filter((row) => {
        if (!isVehicleCategoryName(row && row.category && row.category.name)) return true;
        if (error) return false;
        return complianceCurrent(map.get(String(row.id)));
      }).map((row) => {
        if (!isVehicleCategoryName(row && row.category && row.category.name)) return row;
        return { ...row, vehicle_compliance: publicCompliance(map.get(String(row.id)), true) };
      });
      return sendJson(filtered);
    }).catch((e) => {
      console.error(`[${req.requestId || 'no-request-id'}] vehicle discovery filter failed`, e);
      const safe = body.filter((row) => !isVehicleCategoryName(row && row.category && row.category.name));
      sendJson(safe);
    });
    return res;
  };
  next();
});

// Public safe status used by the listing UI. No plate, document number, home
// address, license number, or other private regulatory data is returned.
router.get('/vehicles/compliance/:listingId/public', async (req, res) => {
  try {
    const info = await listingInfo(req.params.listingId);
    if (!info) return res.status(404).json({ error: 'Listing not found' });
    if (!info.isVehicle) return res.json(publicCompliance(null, false));
    const row = await getCompliance(info.listing.id);
    res.json(publicCompliance(row, true));
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] vehicle compliance status failed`, e);
    res.status(500).json({ error: 'Could not load vehicle verification status.' });
  }
});

router.get('/vehicles/compliance/:listingId', requireAuth, async (req, res) => {
  try {
    const info = await listingInfo(req.params.listingId);
    if (!info) return res.status(404).json({ error: 'Listing not found' });
    if (!info.isVehicle) return res.status(400).json({ error: 'This listing is not a vehicle.' });
    if (req.user.id !== info.listing.owner_id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your vehicle listing.' });
    res.json({ compliance: await getCompliance(info.listing.id), public_status: publicCompliance(await getCompliance(info.listing.id), true) });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] private vehicle compliance load failed`, e);
    res.status(500).json({ error: 'Could not load vehicle compliance details.' });
  }
});

router.put('/vehicles/compliance/:listingId', requireAuth, async (req, res) => {
  try {
    const info = await listingInfo(req.params.listingId);
    if (!info) return res.status(404).json({ error: 'Listing not found' });
    if (!info.isVehicle) return res.status(400).json({ error: 'Vehicle compliance only applies to vehicle listings.' });
    if (req.user.id !== info.listing.owner_id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the owner can submit vehicle compliance details.' });

    const b = req.body || {};
    const row = {
      listing_id: info.listing.id,
      owner_id: info.listing.owner_id,
      make: text(b.make, 80), model: text(b.model, 80), model_year: Math.max(1900, Math.min(2100, Number(b.model_year) || 0)) || null,
      plate_number: text(b.plate_number, 32).toUpperCase(), vin_last6: text(b.vin_last6, 6).toUpperCase(),
      or_cr_reference: text(b.or_cr_reference, 100), or_cr_expiry: expiryMs(b.or_cr_expiry),
      ltfrb_authority_reference: text(b.ltfrb_authority_reference, 120), ltfrb_expiry: expiryMs(b.ltfrb_expiry),
      insurance_reference: text(b.insurance_reference, 120), insurance_expiry: expiryMs(b.insurance_expiry),
      ctpl_reference: text(b.ctpl_reference, 120), ctpl_expiry: expiryMs(b.ctpl_expiry),
      rental_use_covered: b.rental_use_covered === true,
      or_cr_verified: false, ltfrb_verified: false, insurance_verified: false, ctpl_verified: false,
      status: 'pending', reviewer_id: null, reviewed_at: null, review_notes: '', updated_at: now(),
    };
    const required = ['plate_number','or_cr_reference','or_cr_expiry','ltfrb_authority_reference','ltfrb_expiry','insurance_reference','insurance_expiry','ctpl_reference','ctpl_expiry'];
    const missing = required.filter((k) => !row[k]);
    if (!row.rental_use_covered) missing.push('rental_use_covered');
    if (missing.length) return res.status(400).json({ error: 'Complete all required vehicle compliance fields before review.', missing });

    const { data, error } = await svcClient().from('vehicle_compliance').upsert(row, { onConflict: 'listing_id' }).select().single();
    if (error) throw error;
    res.json({ ok: true, compliance: data, public_status: publicCompliance(data, true) });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] vehicle compliance submission failed`, e);
    res.status(500).json({ error: 'Could not save vehicle compliance details.' });
  }
});

router.post('/admin/vehicles/compliance/:listingId/verify', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const current = await getCompliance(req.params.listingId);
    if (!current) return res.status(404).json({ error: 'Vehicle compliance submission not found.' });
    const b = req.body || {};
    const flags = {
      or_cr_verified: b.or_cr_verified === true,
      ltfrb_verified: b.ltfrb_verified === true,
      insurance_verified: b.insurance_verified === true,
      ctpl_verified: b.ctpl_verified === true,
      rental_use_covered: b.rental_use_covered === true,
    };
    const allCurrent = unexpired(current.or_cr_expiry) && unexpired(current.ltfrb_expiry) && unexpired(current.insurance_expiry) && unexpired(current.ctpl_expiry);
    const verified = Object.values(flags).every(Boolean) && allCurrent && b.decision !== 'rejected';
    const status = b.decision === 'rejected' ? 'rejected' : (verified ? 'verified' : 'pending');
    const update = { ...flags, status, reviewer_id: req.user.id, reviewed_at: now(), review_notes: text(b.review_notes, 1000), updated_at: now() };
    const { data, error } = await svcClient().from('vehicle_compliance').update(update).eq('listing_id', req.params.listingId).select().single();
    if (error) throw error;
    res.json({ ok: true, compliance: data, public_status: publicCompliance(data, true) });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] vehicle compliance review failed`, e);
    res.status(500).json({ error: 'Could not review vehicle compliance.' });
  }
});

router.get('/vehicles/driver-verification', requireAuth, async (req, res) => {
  try { res.json({ verification: await getDriverVerification(req.user.id) }); }
  catch (e) { res.status(500).json({ error: 'Could not load driver verification.' }); }
});

router.put('/vehicles/driver-verification', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const row = {
      user_id: req.user.id,
      license_last4: text(b.license_last4, 4).toUpperCase(),
      license_class: text(b.license_class, 40).toUpperCase(),
      license_expiry: expiryMs(b.license_expiry),
      status: 'pending', reviewer_id: null, reviewed_at: null, review_notes: '', updated_at: now(),
    };
    if (row.license_last4.length !== 4 || !row.license_class || !row.license_expiry) return res.status(400).json({ error: 'Provide the last 4 characters, license class, and expiry date.' });
    const { data, error } = await svcClient().from('driver_verifications').upsert(row, { onConflict: 'user_id' }).select().single();
    if (error) throw error;
    res.json({ ok: true, verification: data });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] driver verification submission failed`, e);
    res.status(500).json({ error: 'Could not save driver verification.' });
  }
});

router.post('/admin/vehicles/driver-verification/:userId/verify', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const current = await getDriverVerification(req.params.userId);
    if (!current) return res.status(404).json({ error: 'Driver verification submission not found.' });
    const verified = req.body && req.body.decision !== 'rejected' && unexpired(current.license_expiry);
    const status = req.body && req.body.decision === 'rejected' ? 'rejected' : (verified ? 'verified' : 'pending');
    const { data, error } = await svcClient().from('driver_verifications').update({
      status, reviewer_id: req.user.id, reviewed_at: now(), review_notes: text(req.body && req.body.review_notes, 1000), updated_at: now(),
    }).eq('user_id', req.params.userId).select().single();
    if (error) throw error;
    res.json({ ok: true, verification: data });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] driver verification review failed`, e);
    res.status(500).json({ error: 'Could not review driver verification.' });
  }
});

// Booking gate. The generic booking engine remains unchanged for normal items.
// For vehicle listings we require current vehicle compliance + enhanced renter
// identity + a current verified driver's license record.
router.post(['/bookings', '/bookings/quote', '/bookings/paymongo'], requireAuth, async (req, res, next) => {
  try {
    const draft = req.body && req.body.booking_draft && typeof req.body.booking_draft === 'object' ? req.body.booking_draft : (req.body || {});
    const listingId = Number(draft.listing_id);
    if (!listingId) return next();
    const info = await listingInfo(listingId);
    if (!info || !info.isVehicle) return next();

    const compliance = await getCompliance(listingId);
    if (!complianceCurrent(compliance)) return res.status(423).json({
      error: 'This vehicle is not currently eligible for rental. Registration, LTFRB authority, CTPL and rental-use insurance must be verified and current.',
      code: 'vehicle_compliance_required',
    });
    if (Number(req.user.identity_level || 1) < 3) return res.status(428).json({
      error: 'Vehicle rentals require government-ID identity verification.', code: 'enhanced_identity_required', required: 3,
    });
    const driver = await getDriverVerification(req.user.id);
    if (!driverCurrent(driver)) return res.status(428).json({
      error: 'Complete driver-license verification before booking a self-drive vehicle.', code: 'driver_verification_required',
    });
    next();
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] vehicle booking gate failed`, e);
    res.status(503).json({ error: 'Vehicle eligibility could not be verified. Please try again later.' });
  }
});

module.exports = router;
module.exports._test = { isVehicleCategoryName, expiryMs, unexpired, complianceCurrent, driverCurrent, publicCompliance };
