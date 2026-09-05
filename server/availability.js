'use strict';

const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const now = () => Date.now();

function parseRange(v, fallback) {
  const t = new Date(v || fallback).getTime();
  return Number.isFinite(t) ? t : new Date(fallback).getTime();
}
function safeNote(v) { return String(v || '').trim().slice(0, 200); }
async function listingOwner(listingId) {
  const { data, error } = await svcClient().from('listings').select('id,owner_id').eq('id', listingId).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}
function canManage(listing, user) { return !!(listing && user && (listing.owner_id === user.id || user.role === 'admin')); }

router.get('/listings/:id/availability', async (req, res) => {
  try {
    const listingId = Number(req.params.id);
    if (!listingId) return res.status(400).json({ error: 'Invalid listing.' });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const from = parseRange(req.query.from, today.toISOString());
    const defaultTo = new Date(from + 90 * DAY_MS).toISOString();
    const to = parseRange(req.query.to, defaultTo);
    if (to < from) return res.status(400).json({ error: 'Invalid availability range.' });
    if (to - from > 366 * DAY_MS) return res.status(400).json({ error: 'Availability range is limited to 366 days.' });

    const [bookingRes, blockRes] = await Promise.all([
      svcClient().from('bookings').select('start_date,end_date,status')
        .eq('listing_id', listingId)
        .in('status', ['pending','approved','active','returned','disputed'])
        .lt('start_date', to + DAY_MS).gt('end_date', from - DAY_MS)
        .order('start_date', { ascending: true }),
      svcClient().from('listing_availability_blocks').select('id,start_at,end_at')
        .eq('listing_id', listingId).lte('start_at', to).gte('end_at', from)
        .order('start_at', { ascending: true }),
    ]);
    if (bookingRes.error) throw bookingRes.error;
    if (blockRes.error) throw blockRes.error;

    const booked = (bookingRes.data || []).map((b) => ({ start_date: b.start_date, end_date: b.end_date, status: 'unavailable', source: 'booking' }));
    const blocked = (blockRes.data || []).map((b) => ({ start_date: b.start_at, end_date: b.end_at, status: 'unavailable', source: 'owner_block' }));
    res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=40');
    res.json({ listing_id: listingId, from, to, unavailable: [...booked, ...blocked].sort((a,b) => a.start_date - b.start_date) });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] availability load failed`, e);
    res.status(500).json({ error: 'Could not load listing availability.' });
  }
});

router.get('/listings/:id/availability/manage', requireAuth, async (req, res) => {
  try {
    const listingId = Number(req.params.id);
    const listing = await listingOwner(listingId);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (!canManage(listing, req.user)) return res.status(403).json({ error: 'Only the owner can manage this calendar.' });
    const { data, error } = await svcClient().from('listing_availability_blocks').select('*').eq('listing_id', listingId).order('start_at', { ascending: true });
    if (error) throw error;
    res.json({ listing_id: listingId, blocks: data || [] });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] availability management load failed`, e);
    res.status(500).json({ error: 'Could not load owner availability.' });
  }
});

router.post('/listings/:id/availability/blocks', requireAuth, async (req, res) => {
  try {
    const listingId = Number(req.params.id);
    const listing = await listingOwner(listingId);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (!canManage(listing, req.user)) return res.status(403).json({ error: 'Only the owner can block dates.' });
    const startAt = parseRange(req.body.start_at, 'invalid');
    const endAt = parseRange(req.body.end_at, 'invalid');
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) return res.status(400).json({ error: 'Choose a valid start and end.' });
    if (endAt - startAt > 366 * DAY_MS) return res.status(400).json({ error: 'A single block cannot exceed one year.' });
    const { data, error } = await svcClient().from('listing_availability_blocks').insert({ listing_id: listingId, owner_id: listing.owner_id, start_at: startAt, end_at: endAt, note: safeNote(req.body.note), created_at: now() }).select().single();
    if (error) throw error;
    res.json({ ok: true, block: data });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] availability block failed`, e);
    res.status(500).json({ error: 'Could not block those dates.' });
  }
});

router.delete('/listings/:id/availability/blocks/:blockId', requireAuth, async (req, res) => {
  try {
    const listingId = Number(req.params.id);
    const listing = await listingOwner(listingId);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (!canManage(listing, req.user)) return res.status(403).json({ error: 'Only the owner can change this calendar.' });
    const { error } = await svcClient().from('listing_availability_blocks').delete().eq('id', Number(req.params.blockId)).eq('listing_id', listingId).eq('owner_id', listing.owner_id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] availability unblock failed`, e);
    res.status(500).json({ error: 'Could not remove that blocked period.' });
  }
});

module.exports = router;
module.exports._test = { parseRange, safeNote };
