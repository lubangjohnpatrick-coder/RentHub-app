'use strict';

// Launch-hardening endpoints. These deliberately keep agreement signing,
// evidence confirmation, handover and late-fee calculation server-authoritative.
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

router.post('/bookings/:id/agreement-v2/sign', requireAuth, async (req, res) => {
  const b = await booking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (!party(b, req.user)) return res.status(403).json({ error: 'Not your booking' });
  if (!['approved','active'].includes(b.status)) return res.status(400).json({ error: 'Booking must be approved before signing' });

  const [lr, rr, or] = await Promise.all([
    svcClient().from('listings').select('*').eq('id', b.listing_id).single(),
    svcClient().from('users').select('id,full_name').eq('id', b.renter_id).single(),
    svcClient().from('users').select('id,full_name').eq('id', b.owner_id).single(),
  ]);
  const rule = policy.lateFeeRule(lr.data || {}, b);
  let snapshot = {};
  try { snapshot = JSON.parse(b.agreement_snapshot || '{}'); } catch (e) { snapshot = {}; }
  if (!snapshot.version) snapshot = policy.agreementSnapshot({ booking: b, listing: lr.data, renter: rr.data, owner: or.data, rule });
  const body = policy.agreementText(snapshot);
  const isRenter = b.renter_id === req.user.id;

  const existing = await svcClient().from('rental_agreements').select('*').eq('booking_id', b.id).limit(1).maybeSingle();
  const agreement = {
    booking_id: b.id, listing_id: b.listing_id, agreement_version: policy.AGREEMENT_VERSION,
    body, created_at: existing.data && existing.data.created_at || now(),
    renter_signed_at: existing.data && existing.data.renter_signed_at || null,
    owner_signed_at: existing.data && existing.data.owner_signed_at || null,
  };
  if (isRenter) agreement.renter_signed_at = now(); else agreement.owner_signed_at = now();
  await svcClient().from('rental_agreements').upsert(agreement, { onConflict: 'booking_id' });
  await svcClient().from('bookings').update({
    agreement_version: policy.AGREEMENT_VERSION,
    agreement_snapshot: JSON.stringify(snapshot), late_fee_rule: JSON.stringify(rule),
    [isRenter ? 'agreement_signed_renter' : 'agreement_signed_owner']: true, updated_at: now(),
  }).eq('id', b.id);

  // Signing no longer activates a rental. Activation happens at handover after
  // both signatures and confirmed pre-rental condition evidence.
  res.json({ ok: true, agreement, snapshot, status: b.status });
});

router.post('/bookings/:id/condition/:recordId/confirm', requireAuth, async (req, res) => {
  const b = await booking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (!party(b, req.user)) return res.status(403).json({ error: 'Not your booking' });
  const { data: rec } = await svcClient().from('condition_records').select('*').eq('id', req.params.recordId).eq('booking_id', b.id).maybeSingle();
  if (!rec) return res.status(404).json({ error: 'Condition record not found' });
  if (rec.uploaded_by === req.user.id) return res.status(400).json({ error: 'The other party must confirm this evidence' });
  const status = req.body.accept === false ? 'disputed' : 'confirmed';
  await svcClient().from('condition_records').update({ status, confirmed_by_other: req.user.id, confirmed_at: now() }).eq('id', rec.id);
  if (status === 'confirmed' && rec.phase === 'checkin') await svcClient().from('bookings').update({ checkin_confirmed: true, updated_at: now() }).eq('id', b.id);
  if (status === 'confirmed' && rec.phase === 'checkout') await svcClient().from('bookings').update({ checkout_confirmed: true, updated_at: now() }).eq('id', b.id);
  res.json({ ok: true, status });
});

router.post('/bookings/:id/handover', requireAuth, async (req, res) => {
  const b = await booking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (!party(b, req.user)) return res.status(403).json({ error: 'Not your booking' });
  if (b.status !== 'approved') return res.status(400).json({ error: 'Booking is not ready for handover' });
  if (!b.agreement_signed_renter || !b.agreement_signed_owner) return res.status(400).json({ error: 'Both parties must sign the rental agreement first' });
  if (!b.checkin_confirmed) return res.status(400).json({ error: 'Pre-rental condition evidence must be confirmed first' });
  await svcClient().from('bookings').update({ status: 'active', handover_confirmed: true, updated_at: now() }).eq('id', b.id);
  res.json({ ok: true, status: 'active' });
});

router.post('/bookings/:id/late-fee/refresh', requireAuth, async (req, res) => {
  const b = await booking(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (!party(b, req.user)) return res.status(403).json({ error: 'Not your booking' });
  let rule;
  try { rule = JSON.parse(b.late_fee_rule || '{}'); } catch (e) { rule = {}; }
  if (!rule.kind) {
    const { data: l } = await svcClient().from('listings').select('*').eq('id', b.listing_id).single();
    rule = policy.lateFeeRule(l || {}, b);
  }
  const result = policy.calculateLateFee(b, rule, req.body.returned_at || now());
  await svcClient().from('bookings').update({ late_days: result.days, late_fee: result.fee, late_fee_rule: JSON.stringify(rule), updated_at: now() }).eq('id', b.id);
  res.json({ ok: true, ...result, rule });
});

module.exports = router;
