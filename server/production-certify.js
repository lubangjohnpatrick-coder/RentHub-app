'use strict';

// Read-only production certification harness. It never creates bookings,
// charges cards/wallets, changes GPS or mutates user/listing data.
//
// Public gate:
//   npm run certify:production
//
// Optional authenticated gate (recommended before declaring 95-97):
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   E2E_RENTER_EMAIL=... E2E_RENTER_PASSWORD=... \
//   E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... \
//   REQUIRE_AUTH_CERT=1 npm run certify:production

const { createClient } = require('@supabase/supabase-js');

const BASE = String(process.env.CERT_BASE_URL || 'https://gorenthive.online').replace(/\/$/, '');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
function skip(name, detail) {
  results.push({ name, ok: true, skipped: true, detail });
  console.log(`○ ${name} — skipped: ${detail}`);
}
async function get(url, opts = {}) {
  const res = await fetch(url, { redirect: opts.redirect || 'manual', headers: opts.headers || {} });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { res, text, json };
}
async function api(path, token) {
  return get(BASE + '/api' + path, { redirect: 'follow', headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

async function publicGate() {
  const readiness = await get(BASE + '/health/readiness', { redirect: 'follow' });
  check('Production readiness endpoint is green', readiness.res.status === 200 && readiness.json && readiness.json.readiness === 'ready', `HTTP ${readiness.res.status}`);
  if (readiness.json && readiness.json.checks) {
    for (const [key, value] of Object.entries(readiness.json.checks)) check(`Readiness: ${key}`, value === true);
  }

  const www = await get('https://www.gorenthive.online/', { redirect: 'manual' });
  check('www redirects permanently to canonical domain', www.res.status === 301 && /^https:\/\/gorenthive\.online\//.test(www.res.headers.get('location') || ''), `${www.res.status} ${www.res.headers.get('location') || ''}`);

  const home = await get(BASE + '/', { redirect: 'follow' });
  const csp = home.res.headers.get('content-security-policy') || '';
  check('Homepage is reachable', home.res.status === 200);
  check('CSP is enforced', /default-src 'self'/.test(csp) && /object-src 'none'/.test(csp));
  check('Arbitrary inline script elements are not allowed', /script-src(?:-elem)?[^;]*'self'/.test(csp) && !/script-src(?:-elem)?[^;]*'unsafe-inline'/.test(csp));
  check('HSTS is present', !!home.res.headers.get('strict-transport-security'));
  check('Permissions-Policy is present', /geolocation=\(self\)/.test(home.res.headers.get('permissions-policy') || ''));
  check('Request correlation ID is present', !!home.res.headers.get('x-request-id'));
  check('Current brand shell is served', /GoRentHive/.test(home.text) && /Rent What You Need/i.test(home.text));
  check('No stale escrow/delivery claims in server-rendered shell', !/escrow protected|provider-agnostic payment\s*&\s*escrow|get it delivered|platform delivery/i.test(home.text));

  const listings = await api('/listings');
  const rows = Array.isArray(listings.json) ? listings.json : [];
  check('Public listings API is healthy', listings.res.status === 200 && Array.isArray(listings.json), `HTTP ${listings.res.status}`);
  check('Public listings hide exact coordinates', rows.every((r) => !Object.prototype.hasOwnProperty.call(r, 'latitude') && !Object.prototype.hasOwnProperty.call(r, 'longitude')));
  check('Public listings hide item serial numbers', rows.every((r) => !Object.prototype.hasOwnProperty.call(r, 'serial_number')));
  check('Public owner profiles hide exact address data', rows.every((r) => !r.owner || (!Object.prototype.hasOwnProperty.call(r.owner, 'address') && !Object.prototype.hasOwnProperty.call(r.owner, 'barangay'))));
  check('Public listings do not advertise platform delivery', rows.every((r) => r.delivery_available === false && Number(r.delivery_fee || 0) === 0));

  const sitemap = await get(BASE + '/sitemap.xml', { redirect: 'follow' });
  check('Dynamic sitemap is reachable', sitemap.res.status === 200 && /<urlset/.test(sitemap.text));
  check('Sitemap uses canonical origin only', /https:\/\/gorenthive\.online\//.test(sitemap.text) && !/https:\/\/www\.gorenthive\.online\//.test(sitemap.text));

  const robots = await get(BASE + '/robots.txt', { redirect: 'follow' });
  check('robots.txt is reachable', robots.res.status === 200 && /sitemap/i.test(robots.text));

  if (rows.length) {
    const sample = rows.find((r) => r.images && r.images.length && !String(r.images[0]).includes('placeholder')) || rows[0];
    const page = await get(`${BASE}/listing/${sample.id}`, { redirect: 'follow' });
    check('Listing route has crawlable metadata', page.res.status === 200 && new RegExp(`<link rel="canonical" href="${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/listing/${sample.id}">`).test(page.text));
    if (sample.images && sample.images[0] && !String(sample.images[0]).includes('placeholder')) {
      check('Real listing photo is used for social metadata', page.text.includes(`property="og:image" content="${sample.images[0]}"`));
    }
  } else {
    skip('Listing-specific SEO sample', 'no active inventory yet');
  }

  return rows;
}

async function signIn(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error ? error.message : 'No session returned');
  return data.session.access_token;
}

async function authenticatedGate(publicRows) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const renterEmail = process.env.E2E_RENTER_EMAIL;
  const renterPassword = process.env.E2E_RENTER_PASSWORD;
  const ownerEmail = process.env.E2E_OWNER_EMAIL;
  const ownerPassword = process.env.E2E_OWNER_PASSWORD;
  const required = String(process.env.REQUIRE_AUTH_CERT || '') === '1';
  const complete = [url, anon, renterEmail, renterPassword, ownerEmail, ownerPassword].every(Boolean);
  if (!complete) {
    if (required) {
      check('Authenticated certification credentials configured', false, 'Set Supabase + dedicated E2E renter/owner credentials');
    } else {
      skip('Authenticated account/quote certification', 'dedicated E2E credentials not configured');
    }
    return;
  }

  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const renterToken = await signIn(client, renterEmail, renterPassword);
  const renterMe = await api('/auth/me', renterToken);
  const renter = renterMe.json && renterMe.json.user;
  check('E2E renter authenticates through production', renterMe.res.status === 200 && !!renter);
  check('E2E renter email/mobile are verified', !!(renter && renter.email_verified && renter.mobile_verified));
  check('E2E renter identity is verified', !!(renter && renter.identity_status === 'verified'));

  const locations = await api('/profile/locations', renterToken);
  const saved = locations.json && locations.json.locations;
  check('E2E renter has a GPS-verified saved location', locations.res.status === 200 && Array.isArray(saved) && saved.some((x) => x.verified_by === 'gps'));

  await client.auth.signOut();
  const ownerToken = await signIn(client, ownerEmail, ownerPassword);
  const ownerMe = await api('/auth/me', ownerToken);
  const owner = ownerMe.json && ownerMe.json.user;
  check('E2E owner authenticates through production', ownerMe.res.status === 200 && !!owner);
  check('E2E owner account is owner-enabled and verified', !!(owner && owner.is_owner && owner.email_verified && owner.mobile_verified && owner.identity_status === 'verified'));

  const ownerListing = publicRows.find((r) => r.owner && owner && String(r.owner.id) === String(owner.id));
  check('E2E owner has an active public test listing', !!ownerListing);
  if (ownerListing && renterToken) {
    const start = new Date(Date.now() + 35 * 86400000);
    const end = new Date(start.getTime() + 2 * 86400000);
    const date = (d) => d.toISOString().slice(0, 10);
    const quoteRes = await fetch(BASE + '/api/bookings/quote', {
      method: 'POST',
      headers: { Authorization: `Bearer ${renterToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ listing_id: ownerListing.id, start_date: date(start), end_date: date(end), pickup_option: 'pickup' }),
    });
    const quote = await quoteRes.json().catch(() => ({}));
    check('Production booking quote is reachable', quoteRes.status === 200, `HTTP ${quoteRes.status}`);
    if (quoteRes.status === 200) {
      check('Renter total is rental + refundable deposit', Number(quote.total) === Number(quote.rental_fee) + Number(quote.security_deposit));
      check('Owner commission is exactly 8%', Number(quote.platform_fee) === Math.round(Number(quote.rental_fee) * 0.08));
      check('Quote contains no delivery fee', Number(quote.delivery_fee) === 0 && quote.delivery_method === 'pickup');
    }
  }
}

(async () => {
  try {
    const rows = await publicGate();
    await authenticatedGate(rows);
  } catch (e) {
    check('Certification harness completed', false, e.message);
  }
  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped);
  console.log(`\nCertification result: ${results.length - failed.length}/${results.length} checks passed${skipped.length ? ` (${skipped.length} skipped)` : ''}.`);
  if (failed.length) process.exit(1);
})();
