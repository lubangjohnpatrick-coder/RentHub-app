'use strict';

/**
 * GoRentHive production asset builder.
 *
 * Source stays modular and reviewable. Production ships one CSS bundle and
 * one application JS bundle (plus Supabase vendor/config), with Brotli/gzip
 * variants generated using Node core only.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

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

function writeCompressed(absolute, buffer) {
  const br = zlib.brotliCompressSync(buffer, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const gz = zlib.gzipSync(buffer, { level: 9 });
  fs.writeFileSync(absolute + '.br', br);
  fs.writeFileSync(absolute + '.gz', gz);
  return { br_bytes: br.length, gzip_bytes: gz.length };
}

function buildOne(kind, sources, outName) {
  const chunks = sources.map((source) => `\n/* ===== ${source} ===== */\n${readSource(source).trim()}\n`);
  const payload = chunks.join('\n');
  const hash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 12);
  const output = banner(kind, sources, hash) + payload;
  const buffer = Buffer.from(output, 'utf8');
  fs.mkdirSync(DIST, { recursive: true });
  const absolute = path.join(DIST, outName);
  fs.writeFileSync(absolute, buffer);
  const compressed = writeCompressed(absolute, buffer);
  return { outName, bytes: buffer.length, hash, ...compressed };
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
  console.log(`Built dist/${css.outName} ${css.bytes} B (${css.br_bytes} B br) and dist/${js.outName} ${js.bytes} B (${js.br_bytes} B br).`);
}

if (require.main === module) main();
module.exports = { CSS_SOURCES, JS_SOURCES, main };
