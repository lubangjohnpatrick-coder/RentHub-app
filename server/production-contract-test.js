'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const ui = read('public/js/ui-shell.js');
const launch = read('public/js/launch-ready.js');
const index = read('public/index.html');
const serverIndex = read('server/index.js');
const readiness = read('server/readiness.js');
const guard = read('server/request-guard.js');
const experience = read('public/css/experience.css');
const publicShape = read('server/publicShape.js');
const listingsV2 = read('server/listings-v2.js');
const seo = read('server/seo.js');
const upload = read('server/upload.js');

// The large legacy app.js remains a compatibility core for now. Public-facing
// views are owned by ui-shell.js / launch-ready.js, and launch-ready.js contains
// an explicit compatibility wording sanitizer for old strings that may still
// exist inside the legacy core. Test the effective layers, not dead source text.
const effectivePublicText = `${index}\n${ui}`.toLowerCase();
const bannedEffectiveClaims = [
  'escrow protected',
  'provider-agnostic payment & escrow',
  'provider agnostic payment & escrow',
  'get it delivered',
  'platform delivery',
];
for (const phrase of bannedEffectiveClaims) {
  assert(!effectivePublicText.includes(phrase), `Banned/stale effective public claim found: ${phrase}`);
}
assert(launch.includes("replaceText(n, 'Escrow protected', 'Protected payments')"), 'Legacy escrow wording must be sanitized at runtime');
assert(launch.includes("replaceText(n, 'Provider-agnostic payment & escrow for deposits.', 'Protected payments and refundable deposits.')"), 'Legacy payment/escrow wording must be sanitized at runtime');
assert(launch.includes("replaceText(n, 'Pick up or get it delivered. Record condition.', 'Pick up or meet the owner. Record condition.')"), 'Legacy delivery wording must be sanitized at runtime');
assert(launch.includes("replaceText(n, 'Platform fee (4%)', 'Owner commission (8%)')"), 'Legacy fee wording must be sanitized at runtime');

assert(ui.includes('hydrateMarketplacePreview'), 'Homepage must hydrate with real listing photos when available');
assert(experience.includes('REAL LISTING'), 'Real listing imagery must be explicitly distinguished from fallback visuals');
assert(ui.includes("API.get('/listings')"), 'Homepage must source live listing visuals from the marketplace API');
assert(!ui.includes('₱750/day') && !ui.includes('₱250/day'), 'Homepage must not contain fake sample rental pricing');
assert(index.includes('/css/experience.css'), 'Production shell must load consolidated experience.css');
assert(!index.includes('marketplace-preview.css') && !index.includes('ux-polish.css'), 'Retired presentation layers must stay removed');

assert(serverIndex.includes('contentSecurityPolicy'), 'Production server must enforce a Content-Security-Policy');
assert(serverIndex.includes('scriptSrcAttr'), 'CSP must separate legacy event attributes from script elements');
assert(serverIndex.includes('Permissions-Policy'), 'Production server must send a Permissions-Policy');
assert(serverIndex.includes('X-Request-ID'), 'Production server must attach request IDs');
assert(serverIndex.includes("require('./readiness')"), 'Production readiness route must be mounted');
assert(serverIndex.includes("require('./request-guard')"), 'Production request guard must be mounted');
assert(serverIndex.includes("require('./listings-v2')"), 'Hardened listing discovery must be mounted before legacy routes');
assert(serverIndex.includes("require('./seo')"), 'Dynamic listing SEO must be mounted');
assert(guard.includes('429'), 'Request guard must return HTTP 429 on abuse');

assert(readiness.includes('/health/readiness'), 'Readiness endpoint must exist');
assert(readiness.includes('paymentLiveKey'), 'Production readiness must require a live payment key');
assert(readiness.includes('smsVerificationSender') && readiness.includes('emailVerificationSender'), 'Production readiness must verify communication providers');
assert(readiness.includes('profile-photos') && readiness.includes('rental-evidence') && readiness.includes('identity-docs'), 'Readiness must check required storage buckets');

assert(!publicShape.includes('latitude: row.latitude') && !publicShape.includes('longitude: row.longitude'), 'Public listing responses must not expose exact coordinates');
assert(publicShape.includes('delivery_available: false') && publicShape.includes('delivery_fee: 0'), 'Public listing shape must not advertise platform delivery');
assert(listingsV2.includes(".eq('status', 'active')"), 'Public listing discovery must return active inventory only');
assert(listingsV2.includes("query = query.eq('category_id', category)"), 'Category must be an AND filter');
assert(listingsV2.includes("query = query.ilike('location_city'"), 'City must be an AND filter');
assert(listingsV2.includes('title.ilike') && listingsV2.includes('description.ilike'), 'Keyword search must only OR title/description fields');

assert(seo.includes("router.get('/sitemap.xml'"), 'Dynamic sitemap must exist');
assert(seo.includes(".eq('status', 'active')"), 'Dynamic sitemap must only include active listings');
assert(seo.includes('listingRoute'), 'Listing-specific metadata renderer must exist');
assert(seo.includes('ogImage'), 'Listing social metadata should use real listing photography when present');

assert(upload.includes('stripJpegMetadata') && upload.includes('stripPngMetadata') && upload.includes('stripWebpMetadata'), 'Public image metadata must be sanitized before storage');
assert(experience.includes('@media(max-width:420px)'), 'Experience layer must explicitly support ~390px mobile screens');
assert(experience.includes('prefers-reduced-motion'), 'Experience layer must respect reduced motion');

console.log('Production contract test passed.');
