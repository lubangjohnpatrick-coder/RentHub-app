'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const publicFiles = [
  'public/index.html',
  'public/js/app.js',
  'public/js/launch-ready.js',
  'public/js/ui-shell.js',
  'public/js/profile-experience.js',
];
const publicText = publicFiles.map(read).join('\n').toLowerCase();

const bannedPublicClaims = [
  'escrow protected',
  'provider-agnostic payment & escrow',
  'provider agnostic payment & escrow',
  'get it delivered',
  'platform delivery',
];
for (const phrase of bannedPublicClaims) {
  assert(!publicText.includes(phrase), `Banned/stale public claim found: ${phrase}`);
}

const ui = read('public/js/ui-shell.js');
const index = read('public/index.html');
const serverIndex = read('server/index.js');
const readiness = read('server/readiness.js');
const experience = read('public/css/experience.css');

assert(ui.includes('hydrateMarketplacePreview'), 'Homepage must hydrate with real listing photos when available');
assert(ui.includes('REAL LISTING'), 'Real listing imagery must be explicitly distinguished from fallback visuals');
assert(ui.includes("API.get('/listings')"), 'Homepage must source live listing visuals from the marketplace API');
assert(!ui.includes('₱750/day') && !ui.includes('₱250/day'), 'Homepage must not contain fake sample rental pricing');
assert(index.includes('/css/experience.css'), 'Production shell must load consolidated experience.css');
assert(!index.includes('marketplace-preview.css') && !index.includes('ux-polish.css'), 'Retired presentation layers must stay removed');
assert(serverIndex.includes("contentSecurityPolicy"), 'Production server must enforce a Content-Security-Policy');
assert(serverIndex.includes("Permissions-Policy"), 'Production server must send a Permissions-Policy');
assert(serverIndex.includes("X-Request-ID"), 'Production server must attach request IDs');
assert(serverIndex.includes("require('./readiness')"), 'Production readiness route must be mounted');
assert(readiness.includes("/health/readiness"), 'Readiness endpoint must exist');
assert(readiness.includes("profile-photos") && readiness.includes("rental-evidence") && readiness.includes("identity-docs"), 'Readiness must check required storage buckets');
assert(experience.includes('@media(max-width:420px)'), 'Experience layer must explicitly support ~390px mobile screens');
assert(experience.includes('prefers-reduced-motion'), 'Experience layer must respect reduced motion');

console.log('Production contract test passed.');
