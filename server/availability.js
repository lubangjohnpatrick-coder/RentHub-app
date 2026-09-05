'use strict';

const express = require('express');
const { svcClient } = require('./supabase');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;

function parseRange(v, fallback) {
  const t = new Date(v || fallback).getTime();
  return Number.isFinite(t) ? t : new Date(fallback).getTime();
}

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

    const { data, error } = await svcClient().from('bookings').select('start_date,end_date,status')
      .eq('listing_id', listingId)
      .in('status', ['pending','approved','active','returned','disputed'])
      .lt('start_date', to + DAY_MS)
      .gt('end_date', from - DAY_MS)
      .order('start_date', { ascending: true });
    if (error) throw error;

    res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=40');
    res.json({
      listing_id: listingId,
      from,
      to,
      unavailable: (data || []).map((b) => ({ start_date: b.start_date, end_date: b.end_date, status: 'unavailable' })),
    });
  } catch (e) {
    console.error(`[${req.requestId || 'no-request-id'}] availability load failed`, e);
    res.status(500).json({ error: 'Could not load listing availability.' });
  }
});

module.exports = router;
