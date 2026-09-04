'use strict';

// Launch-hardening endpoints. Mounted BEFORE legacy routes so old clients
// receive the hardened behavior too.
const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');
const policy = require('./rental-policy');

const router = express.Router();
const now = () => Date.now();

async function booking(id) {
  const { data } = await svcClient().from('bookings').select('*').eq('id', id).limit(1).maybeSingle();
  return data || null;
}
function party(b, u) { return b && (b.renter_id === u.id || b.owner_id === u.id || u.role === 'admin'); }

async function signAgreement(req, res) {
  const b = await booking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (!party(b, req.user)) return res.status(403).json({ error: 'Not your booking' });
  if (b.status !== 'approved') return res.status(400).json({ error: 'Booking must be approved before signing' });

  const [lr, rr, or] = await Promise.all([
    svcClient().from('listings').select('*').eq('id', b.listing_id).single(),
    svcClient().from('users').select('id,full_name').eq('id', b.renter_id).single(),
    svcClient().from('users').select('id,full_name').eq('id', b.owner_id).single(),
  ]);
  const rule = policy.lateFeeRule(lr.data || {}, b);
  let snapshot = {};
  try { snapshot = JSON.parse(b.agreement_snapshot || '{}'); } catch (_) { snapshot = {}; }
  if (!snapshot.version) snapshot = policy.agreementSnapshot({ booking: b, listing: lr.data, renter: rr.data, owner: or.data, rule });
  const body = policy.agreementText(snapshot);
  const isRenter = b.renter_id === req.user.id;

  const existing = await svcClient().from('rental_agreements').select('*').eq('booking_id', b.id).limit(1).maybeSingle();
  const agreement = {
    booking_id: b.id,
    listing_id: b.listing_id,
    agreement_version: policy.AGREEMENT_VERSION,
    body,
    created_at: existing.data && existing.data.created_at || now(),
    renter_signed_at: existing.data && existing.data.renter_signed_at || null,
    owner_signed_at: existing.data && existing.data.owner_signed_at || null,
  };
  if (isRenter) agreement.renter_signed_at = now(); else agreement.owner_signed_at = now();
  await svcClient().from('rental_agreements').upsert(agreement, { onConflict: 'booking_id' });
  await svcClient().from('bookings').update({
    agreement_version: policy.AGREEMENT_VERSION,
    agreement_snapshot: JSON.stringify(snapshot),
    late_fee_rule: JSON.stringify(rule),
    [isRenter ? 'agreement_signed_renter' : 'agreement_signed_owner']: true,
    updated_at: now(),
  }).eq('id', b.id);

  // IMPORTANT: both signatures do NOT activate the rental. Activation requires
  // owner check-in evidence, renter confirmation, then renter handover confirm.
  res.json({ ok: true, agreement, snapshot, status: 'approved' });
}

router.post('/bookings/:id/agreement-v2/sign', requireAuth, signAgreement);
// Compatibility alias used by the existing SPA.
router.post('/bookings/:id/sign-agreement', requireAuth, signAgreement);

// Evidence submission. Owner documents check-in; renter documents check-out.
// At least four photos are required to cover front/back/sides for disputes.
router.post('/bookings/:id/condition', requireAuth, async (req, res) => {
  const b = await booking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (!party(b, req.user)) return res.status(403).json({ error: 'Not your booking' });
  const phase = String(req.body.phase || '');
  if (!['checkin','checkout'].includes(phase)) return res.status(400).json({ error: 'Invalid condition phase' });
  if (phase === 'checkin' && req.user.id !== b.owner_id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'The owner must upload the pre-rental condition photos.' });
  }
  if (phase === 'checkout' && req.user.id !== b.renter_id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'The renter must upload the return condition photos.' });
  }
  if (phase === 'checkin' && b.status !== 'approved') return res.status(400).json({ error: 'Check-in documentation is allowed after booking approval.' });
  if (phase === 'checkout' && b.status !== 'active') return res.status(400).json({ error: 'Return documentation is allowed only for an active rental.' });

  const photos = Array.isArray(req.body.photos) ? req.body.photos.filter(Boolean).slice(0, 12) : [];
  if (photos.length < 4) return res.status(400).json({ error: 'Upload at least 4 clear photos: front, back, left side and right side.' });

  const { data: listing } = await svcClient().from('listings').select('serial_number').eq('id', b.listing_id).maybeSingle();
  const serial = String(req.body.serial_number || '').trim();
  if (listing && listing.serial_number && !serial) return res.status(400).json({ error: 'Serial number is required for this item.' });

  const rec = await svcClient().from('condition_records').insert({
    booking_id: b.id,
    phase,
    uploaded_by: req.user.id,
    photos: JSON.stringify(photos),
    serial_number: serial,
    accessories: String(req.body.accessories || '').slice(0, 1000),
    damage_notes: String(req.body.damage_notes || '').slice(0, 2000),
    status: 'submitted',
    created_at: now(),
  }).select().single();
  if (rec.error) return res.status(500).json({ error: rec.error.message });
  res.json({ ok: true, record: rec.data, requires_other_party_confirmation: true });
});

router.post('/bookings/:id/condition/:recordId/confirm', requireAuth, async (req, res) => {
  const b = await booking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (!party(b, req.user)) return res.status(403).json({ error: 'Not your booking' });
  const { data: rec } = await svcClient().from('condition_records').select('*').eq('id', req.params.recordId).eq('booking_id', b.id).maybeSingle();
  if (!rec) return res.status(404).json({ error: 'Condition record not found' });
  if (rec.uploaded_by === req.user.id) return res.status(400).json({ error: 'The other party must confirm this evidence.' });

  // Expected counterparty: renter confirms check-in; owner confirms check-out.
  if (rec.phase === 'checkin' && req.user.id !== b.renter_id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the renter can confirm pre-rental condition.' });
  if (rec.phase === 'checkout' && req.user.id !== b.owner_id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the owner can confirm return condition.' });

  const status = req.body.accept === false ? 'disputed' : 'confirmed';
  await svcClient().from('condition_records').update({ status, confirmed_by_other: req.user.id, confirmed_at: now() }).eq('id', rec.id);
  if (status === 'confirmed' && rec.phase === 'checkin') await svcClient().from('bookings').update({ checkin_confirmed: true, updated_at: now() }).eq('id', b.id);
  if (status === 'confirmed' && rec.phase === 'checkout') await svcClient().from('bookings').update({ checkout_confirmed: true, updated_at: now() }).eq('id', b.id);
  if (status === 'disputed') {
    await svcClient().from('bookings').update({ status: 'disputed', updated_at: now() }).eq('id', b.id);
    await svcClient().from('disputes').insert({
      booking_id: b.id,
      reporter_id: req.user.id,
      category: rec.phase === 'checkin' ? 'condition_at_handover' : 'condition_at_return',
      description: 'Condition documentation was disputed by the counterparty.',
      status: 'open', created_at: now(),
    });
  }
  res.json({ ok: true, status });
});

router.post('/bookings/:id/handover', requireAuth, async (req, res) => {
  const b = await booking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (req.user.id !== b.renter_id && req.user.role !== 'admin') return res.status(403).json({ error: 'The renter must confirm receipt of the item.' });
  if (b.status !== 'approved') return res.status(400).json({ error: 'Booking is not ready for handover' });
  if (!b.payment_confirmed && !b.escrow_payment) return res.status(400).json({ error: 'Payment must be confirmed before handover.' });
  if (!b.agreement_signed_renter || !b.agreement_signed_owner) return res.status(400).json({ error: 'Both parties must sign the rental agreement first.' });
  if (!b.checkin_confirmed) return res.status(400).json({ error: 'Confirm the pre-rental condition evidence first.' });
  await svcClient().from('bookings').update({ status: 'active', handover_confirmed: true, updated_at: now() }).eq('id', b.id);
  res.json({ ok: true, status: 'active' });
});

router.post('/bookings/:id/late-fee/refresh', requireAuth, async (req, res) => {
  const b = await booking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (!party(b, req.user)) return res.status(403).json({ error: 'Not your booking' });
  let rule;
  try { rule = JSON.parse(b.late_fee_rule || '{}'); } catch (_) { rule = {}; }
  if (!rule.kind) {
    const { data: l } = await svcClient().from('listings').select('*').eq('id', b.listing_id).single();
    rule = policy.lateFeeRule(l || {}, b);
  }
  const result = policy.calculateLateFee(b, rule, req.body.returned_at || now());
  await svcClient().from('bookings').update({ late_days: result.days, late_fee: result.fee, late_fee_rule: JSON.stringify(rule), updated_at: now() }).eq('id', b.id);
  res.json({ ok: true, ...result, rule });
});

// Guard the existing completion endpoint. The legacy financial handler runs
// after this middleware only when the return evidence is confirmed and any
// late-return charge fits within the refundable deposit. A late charge is
// proposed as a deposit deduction so the renter may accept or dispute it.
router.post('/bookings/:id/complete', requireAuth, async (req, res, next) => {
  const b = await booking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (req.user.id !== b.owner_id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the owner can complete this rental.' });
  if (b.status !== 'active') return next();
  if (!b.checkout_confirmed) return res.status(400).json({ error: 'The owner must confirm the renter\'s return photos before completing the rental.' });

  let rule;
  try { rule = JSON.parse(b.late_fee_rule || '{}'); } catch (_) { rule = {}; }
  if (!rule.kind) {
    const { data: l } = await svcClient().from('listings').select('*').eq('id', b.listing_id).single();
    rule = policy.lateFeeRule(l || {}, b);
  }
  const late = policy.calculateLateFee(b, rule, now());
  await svcClient().from('bookings').update({ late_days: late.days, late_fee: late.fee, late_fee_rule: JSON.stringify(rule), updated_at: now() }).eq('id', b.id);

  const requestedDamage = Math.max(0, Number(req.body.damageDeduction) || 0);
  const combined = requestedDamage + late.fee;
  if (combined > Number(b.security_deposit || 0)) {
    await svcClient().from('bookings').update({ status: 'disputed', updated_at: now() }).eq('id', b.id);
    await svcClient().from('disputes').insert({
      booking_id: b.id,
      reporter_id: req.user.id,
      category: 'late_or_damage_amount_exceeds_deposit',
      description: `Proposed late/damage charges total ₱${combined}, exceeding the ₱${b.security_deposit || 0} security deposit. Admin resolution required.`,
      status: 'open', created_at: now(),
    });
    return res.status(409).json({ error: 'Late/damage charges exceed the security deposit. The booking was moved to dispute review.', code: 'deposit_exceeded' });
  }
  req.body.damageDeduction = combined;
  const reasons = [];
  if (requestedDamage > 0) reasons.push(String(req.body.reason || 'Damage deduction'));
  if (late.fee > 0) reasons.push(`Late return: ${late.days} day(s), ₱${late.fee}`);
  req.body.reason = reasons.join(' | ');
  next();
});

module.exports = router;
