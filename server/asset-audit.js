'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const INDEX = path.join(PUBLIC, 'index.html');
const SW = path.join(PUBLIC, 'service-worker.js');

const retiredAssets = [
  '/css/brand-refresh.css',
  '/css/homepage-redesign.css',
  '/css/theme-unification.css',
  '/css/reference-homepage.css',
  '/css/marketplace-preview.css',
  '/css/ux-polish.css',
  '/js/brand-refresh.js',
  '/js/homepage-redesign.js',
  '/js/reference-homepage.js',
  '/js/terms-fix.js',
];

const APP_ROUTE_RE = /^\/(?:api|explore|categories|listing|booking|list|rent|earn|pricing|how-it-works|trust-safety|about|help|contact|legal|register|login|owner|dashboard|premium|messages|favorites|wallet|me|profile|requests|admin|verify)(?:\/|$|\?)/;

function localPath(url) {
  if (!url || !url.startsWith('/') || url.startsWith('//')) return null;
  const clean = url.split(/[?#]/, 1)[0];
  return path.join(PUBLIC, clean.replace(/^\/+/, ''));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function collectIndexAssets(html) {
  const assets = new Set();
  const re = /(?:src|href)=["'](\/[^"']+)["']/g;
  let match;
  while ((match = re.exec(html))) {
    const url = match[1];
    if (APP_ROUTE_RE.test(url)) continue;
    assets.add(url);
  }
  return [...assets];
}

function collectServiceWorkerAssets(source) {
  const block = source.match(/const APP_SHELL\s*=\s*\[([\s\S]*?)\];/);
  assert(block, 'service-worker.js must declare APP_SHELL');
  return [...block[1].matchAll(/["'](\/[^"']+)["']/g)].map((m) => m[1]);
}

function assertAssetsExist(urls, sourceName) {
  for (const url of urls) {
    const file = localPath(url);
    if (!file || url === '/') continue;
    assert(fs.existsSync(file), `${sourceName} references missing asset: ${url}`);
  }
}

function main() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const sw = fs.readFileSync(SW, 'utf8');

  for (const retired of retiredAssets) {
    assert(!html.includes(retired), `index.html still loads retired asset: ${retired}`);
    assert(!sw.includes(retired), `service-worker.js still caches retired asset: ${retired}`);
  }

  const indexAssets = collectIndexAssets(html);
  const swAssets = collectServiceWorkerAssets(sw);
  assertAssetsExist(indexAssets, 'index.html');
  assertAssetsExist(swAssets, 'service-worker.js');

  const required = [
    '/css/styles.css',
    '/css/launch-ready.css',
    '/css/app-theme.css',
    '/css/profile-experience.css',
    '/css/experience.css',
    '/js/app.js',
    '/js/location-hardening.js',
    '/js/launch-ready.js',
    '/js/private-media.js',
    '/js/legal-acceptance.js',
    '/js/ui-shell.js',
    '/js/profile-experience.js',
  ];
  for (const asset of required) {
    assert(html.includes(asset), `index.html must load required production asset: ${asset}`);
    if (!asset.includes('supabase-config')) assert(sw.includes(asset), `service-worker.js must cache production asset: ${asset}`);
  }

  assert((html.match(/<main\b/g) || []).length === 1, 'index.html should contain exactly one top-level <main>');
  assert(!/PLACEHOLDER|Lorem ipsum/i.test(html), 'index.html contains placeholder content');
  assert(!html.includes('terms-fix.js'), 'hotfix filename must not return to production shell');
  assert((html.match(/<link rel="stylesheet"/g) || []).length <= 6, 'Production shell has too many stylesheet layers; consolidate ownership');

  console.log(`Asset audit passed: ${indexAssets.length} index assets, ${swAssets.length} precached assets.`);
}

main();
