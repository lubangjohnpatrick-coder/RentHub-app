'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const INDEX = path.join(PUBLIC, 'index.html');
const SW = path.join(PUBLIC, 'service-worker.js');
const { CSS_SOURCES, JS_SOURCES } = require('./build-assets');
const APP_ROUTE_RE = /^\/(?:api|explore|categories|listing|booking|list|rent|earn|pricing|how-it-works|trust-safety|about|help|contact|legal|register|login|owner|dashboard|premium|messages|favorites|wallet|me|profile|requests|motors|business|admin|verify)(?:\/|$|\?)/;

function assert(condition, message) { if (!condition) throw new Error(message); }
function localPath(url) { if (!url || !url.startsWith('/') || url.startsWith('//')) return null; const clean = url.split(/[?#]/, 1)[0]; return path.join(PUBLIC, clean.replace(/^\/+/, '')); }
function collectIndexAssets(html) { const assets = new Set(); const re = /(?:src|href)=["'](\/[^"']+)["']/g; let m; while ((m = re.exec(html))) { if (!APP_ROUTE_RE.test(m[1])) assets.add(m[1]); } return [...assets]; }
function collectServiceWorkerAssets(source) { const block = source.match(/const APP_SHELL\s*=\s*\[([\s\S]*?)\];/); assert(block, 'service-worker.js must declare APP_SHELL'); return [...block[1].matchAll(/["'](\/[^"']+)["']/g)].map((m) => m[1]); }
function assertAssetsExist(urls, sourceName) { for (const url of urls) { const file = localPath(url); if (!file || url === '/') continue; assert(fs.existsSync(file), `${sourceName} references missing asset: ${url}`); } }

function main() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const sw = fs.readFileSync(SW, 'utf8');
  const indexAssets = collectIndexAssets(html);
  const swAssets = collectServiceWorkerAssets(sw);
  assertAssetsExist(indexAssets, 'index.html');
  assertAssetsExist(swAssets, 'service-worker.js');

  for (const source of [...CSS_SOURCES, ...JS_SOURCES]) assert(fs.existsSync(path.join(PUBLIC, source)), `Missing bundle source: ${source}`);
  for (const required of ['/dist/app.css', '/dist/app.js']) {
    assert(html.includes(required), `index.html must load ${required}`);
    assert(sw.includes(required), `service-worker.js must cache ${required}`);
  }

  const cssLinks = (html.match(/<link rel="stylesheet"/g) || []).length;
  const scripts = (html.match(/<script[^>]+src=/g) || []).length;
  assert(cssLinks <= 2, `Production shell should use at most two stylesheets; found ${cssLinks}`);
  assert(scripts <= 3, `Production shell should use at most three external scripts; found ${scripts}`);
  assert(!html.includes('/css/homepage-v2') && !html.includes('/js/homepage-v2'), 'Source-layer homepage assets must not be loaded directly in production');
  assert(!html.includes('/js/aesthetic-polish.js') && !html.includes('/js/marketplace-pro.js'), 'Source override modules must ship through the production bundle');
  assert((html.match(/<main\b/g) || []).length === 1, 'index.html should contain exactly one top-level <main>');
  assert(!/PLACEHOLDER|Lorem ipsum/i.test(html), 'index.html contains placeholder content');
  console.log(`Asset audit passed: ${indexAssets.length} index assets, ${swAssets.length} precached assets, ${cssLinks} stylesheet, ${scripts} scripts.`);
}

main();
