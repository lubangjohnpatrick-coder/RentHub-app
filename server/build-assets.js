'use strict';

/**
 * GoRentHive production asset builder.
 *
 * Source stays modular and reviewable. Production ships one CSS bundle and
 * one application JS bundle (plus Supabase vendor/config) so the browser does
 * not execute a long chain of override files as separate network resources.
 *
 * No third-party build dependency is used: this must run after `npm ci --omit=dev`.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(PUBLIC, 'dist');

const CSS_SOURCES = [
  'css/styles.css',
  'css/launch-ready.css',
  'css/app-theme.css',
  'css/profile-experience.css',
  'css/experience.css',
  'css/brand-consistency.css',
  'css/marketplace-upgrades.css',
  'css/homepage-v2.css',
  'css/homepage-v2-fixes.css',
  'css/brand-lockup-v2.css',
  'css/motion.css',
  'css/premium-finish.css',
];

const JS_SOURCES = [
  'js/api.js',
  'js/app.js',
  'js/location-hardening.js',
  'js/launch-ready.js',
  'js/payment-experience.js',
  'js/private-media.js',
  'js/legal-acceptance.js',
  'js/ui-shell.js',
  'js/profile-experience.js',
  'js/verification-experience.js',
  'js/brand-consistency.js',
  'js/marketplace-upgrades.js',
  'js/marketplace-pro.js',
  'js/motion.js',
  'js/aesthetic-polish.js',
  'js/homepage-v2.js',
  'js/homepage-v2-fixes.js',
  'js/plan-guard.js',
  'js/policy-v2.js',
  'js/brand-lockup-v2.js',
  'js/premium-finish.js',
];

function readSource(relativePath) {
  const absolute = path.join(PUBLIC, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`Missing bundle source: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8').replace(/^\uFEFF/, '');
}

function banner(kind, sources, hash) {
  return `/* GoRentHive ${kind} production bundle | ${hash} | generated from:\n${sources.map((s) => ` * ${s}`).join('\n')}\n */\n`;
}

function buildOne(kind, sources, outName) {
  const chunks = sources.map((source) => `\n/* ===== ${source} ===== */\n${readSource(source).trim()}\n`);
  const payload = chunks.join('\n');
  const hash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 12);
  const output = banner(kind, sources, hash) + payload;
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, outName), output, 'utf8');
  return { outName, bytes: Buffer.byteLength(output), hash };
}

function main() {
  const css = buildOne('CSS', CSS_SOURCES, 'app.css');
  const js = buildOne('JavaScript', JS_SOURCES, 'app.js');
  const manifest = {
    generated_at: new Date().toISOString(),
    css,
    js,
    css_sources: CSS_SOURCES,
    js_sources: JS_SOURCES,
  };
  fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Built dist/${css.outName} (${css.bytes} bytes) and dist/${js.outName} (${js.bytes} bytes).`);
}

if (require.main === module) main();
module.exports = { CSS_SOURCES, JS_SOURCES, main };
