'use strict';

// Two-party handover confirmation. The owner generates a short-lived PIN only
// after agreement + condition prerequisites are complete; the renter enters it
// at physical handover. This replaces a one-click activation and creates an
// auditable confirmation point without exposing phone numbers or exact homes.

const express = require('express');
const crypto = require('crypto');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');

const router = express.Router();
const now = () => Date.now();
const TTL_MS = 30 * 60 * 1000;

function normalizeCode(v) { return String(v || '').replace(/\D/g, '').slice(0, 6); }
function codeHash(bookingId, code) {
  const secret = String(process.env.APP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'gorenthive-handover');
  return crypto.createHash('sha256').update(`${secret}|${bookingId}|${normalizeCode(code)}`).digest('hex');
}
function readyForHandover(b) {
  return !!b && b.status === 'approved' && b.payment_confirmed === true && b.agreement_signed_renter === true && b.agreement_signed_owner === true && b.checkin_confirmed === true;
}
async function booking(id) {
  const { data, error } = await svcClient().from('bookings').select('*').eq('id', id).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

router.post('/bookings/:id/handover-code', requireAuth, async (req, res) => {
  try {
    const b = await booking(req.params.id);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    if (req.user.id !== b.owner_id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the owner can generate the handover PIN.' });
    if (!readyForHandover(b)) return res.status(409).json({
      error: 'Complete payment confirmation, both agreement signatures, and renter-confirmed pre-rental condition evidence first.',
      code: 'handover_not_ready',
    });
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const expiresAt = now() + TTL_MS;
    const { error } = await svcClient().from('booking_handover_codes').upsert({
      booking_id: b.id,
      code_hash: codeHash(b.id, code),
      generated_by: req.user.id,
      expires_at: expiresAt,
      attempts: 0,
      used_at: null,
      created_at: now(),
      updated_at: now(),
    }, { onConflict: 'booking_id' });
    if (error) throw error;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, code, expires_at: expiresAt, valid_for_minutes: 30 });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] handover PIN generation failed`, e);
    res.status(500).json({ error: 'Could not generate the handover PIN.' });
  }
});

router.post('/bookings/:id/handover-code/confirm', requireAuth, async (req, res) => {
  try {
    const b = await booking(req.params.id);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    if (req.user.id !== b.renter_id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the renter can confirm physical handover.' });
    if (!readyForHandover(b)) return res.status(409).json({ error: 'This booking is not ready for handover.', code: 'handover_not_ready' });
    const code = normalizeCode(req.body && req.body.code);
    if (code.length !== 6) return res.status(400).json({ error: 'Enter the 6-digit handover PIN.' });

    const { data: rec, error } = await svcClient().from('booking_handover_codes').select('*').eq('booking_id', b.id).limit(1).maybeSingle();
    if (error) throw error;
    if (!rec || rec.used_at) return res.status(400).json({ error: 'No active handover PIN exists. Ask the owner to generate a new one.' });
    if (Number(rec.expires_at || 0) <= now()) return res.status(410).json({ error: 'The handover PIN expired. Ask the owner to generate a new one.' });
    if (Number(rec.attempts || 0) >= 5) return res.status(429).json({ error: 'Too many incorrect attempts. Ask the owner to generate a new PIN.' });

    const expected = Buffer.from(String(rec.code_hash || ''), 'hex');
    const supplied = Buffer.from(codeHash(b.id, code), 'hex');
    const valid = expected.length === supplied.length && expected.length > 0 && crypto.timingSafeEqual(expected, supplied);
    if (!valid) {
      await svcClient().from('booking_handover_codes').update({ attempts: Number(rec.attempts || 0) + 1, updated_at: now() }).eq('booking_id', b.id);
      return res.status(400).json({ error: 'Incorrect handover PIN.' });
    }

    const stamped = now();
    const upd = await svcClient().from('bookings').update({ status: 'active', handover_confirmed: true, updated_at: stamped }).eq('id', b.id).eq('status', 'approved').select('id,status').single();
    if (upd.error) throw upd.error;
    await svcClient().from('booking_handover_codes').update({ used_at: stamped, updated_at: stamped }).eq('booking_id', b.id);
    res.json({ ok: true, status: 'active', handover_confirmed_at: stamped });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] handover PIN confirmation failed`, e);
    res.status(500).json({ error: 'Could not confirm handover.' });
  }
});

// Compatibility guard: old clients may still call the one-click endpoint.
// Fail closed and direct them to the two-party PIN confirmation flow.
router.post('/bookings/:id/handover', requireAuth, async (req, res) => {
  res.status(409).json({
    error: 'A 6-digit handover PIN is now required. The owner generates it at handover and the renter confirms it in-app.',
    code: 'handover_pin_required',
  });
});

module.exports = router;
module.exports._test = { normalizeCode, codeHash, readyForHandover, TTL_MS };
