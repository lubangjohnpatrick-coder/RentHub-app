'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { svcClient } = require('./supabase');
const prerender = require('./prerender');

const router = express.Router();
const CANON = prerender.CANON;
const STATIC_PATHS = [
  '/', '/explore', '/categories', '/rent', '/earn', '/pricing', '/how-it-works',
  '/trust-safety', '/about', '/help', '/contact', '/list', '/login', '/register',
  '/owner', '/legal/terms', '/legal/privacy', '/legal/rental_agreement', '/legal/prohibited',
];

function xml(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function html(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function cleanText(v, max = 160) {
  const text = String(v || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}
function isoDate(value) {
  const n = Number(value);
  const d = Number.isFinite(n) ? new Date(n) : new Date(value || 0);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

router.get('/sitemap.xml', async (req, res) => {
  try {
    const { data, error } = await svcClient().from('listings')
      .select('id,updated_at,created_at')
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(10000);
    if (error) throw error;

    const staticUrls = STATIC_PATHS.map((p) => `<url><loc>${xml(CANON + p)}</loc><changefreq>${p === '/' ? 'daily' : 'weekly'}</changefreq><priority>${p === '/' ? '1.0' : '0.7'}</priority></url>`);
    const listingUrls = (data || []).map((row) => {
      const lastmod = isoDate(row.updated_at || row.created_at);
      return `<url><loc>${xml(`${CANON}/listing/${row.id}`)}</loc>${lastmod ? `<lastmod>${xml(lastmod)}</lastmod>` : ''}<changefreq>daily</changefreq><priority>0.8</priority></url>`;
    });
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...staticUrls, ...listingUrls].join('\n')}\n</urlset>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=1800');
    res.send(body);
  } catch (_) {
    const fallback = path.join(__dirname, '..', 'public', 'sitemap.xml');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).send(fs.readFileSync(fallback, 'utf8'));
  }
});

async function listingRoute(pathname) {
  const match = String(pathname || '').match(/^\/listing\/(\d+)$/);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isFinite(id) || id <= 0) return null;

  try {
    const [listingResult, imageResult] = await Promise.all([
      svcClient().from('listings').select('id,title,description,price_per_day,location_city,location_province,status').eq('id', id).limit(1).maybeSingle(),
      svcClient().from('listing_images').select('url,is_primary,sort_order').eq('listing_id', id),
    ]);
    const l = listingResult.data;
    if (!l || l.status !== 'active') {
      return {
        title: 'Rental Listing | GoRentHive',
        desc: 'This GoRentHive rental listing is not currently available.',
        noscript: '<noscript><div style="max-width:800px;margin:0 auto;padding:48px 20px;text-align:center"><h1>Listing unavailable</h1><p>This rental is not currently available.</p></div></noscript>',
        noindex: true,
      };
    }
    const location = [l.location_city, l.location_province].filter(Boolean).join(', ');
    const title = `${cleanText(l.title, 62)} for Rent${location ? ` in ${cleanText(location, 45)}` : ''} | GoRentHive`;
    const descBase = cleanText(l.description, 140) || `Rent ${cleanText(l.title, 80)} on GoRentHive.`;
    const desc = cleanText(`${descBase}${location ? ` Available in ${location}.` : ''}`, 158);
    const images = (imageResult.data || []).slice().sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const ogImage = images[0] && /^https:\/\//i.test(String(images[0].url || '')) ? images[0].url : `${CANON}/icons/icon-512.png`;
    const price = Number(l.price_per_day || 0);
    const noscript = `<noscript><div style="max-width:800px;margin:0 auto;padding:48px 20px;text-align:center"><h1>${html(l.title)}</h1><p>${html(desc)}</p>${price > 0 ? `<p><strong>₱${price.toLocaleString('en-PH')}/day</strong></p>` : ''}<p><a href="/explore">Browse more rentals</a></p></div></noscript>`;
    return { title, desc, ogImage, noscript, noindex: false };
  } catch (_) {
    return null;
  }
}

module.exports = router;
module.exports.listingRoute = listingRoute;
module.exports.STATIC_PATHS = STATIC_PATHS;
