'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const size = (p) => fs.statSync(path.join(root, p)).size;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const index = read('public/index.html');
const css = read('public/dist/app.css');
const js = read('public/dist/app.js');
const sw = read('public/service-worker.js');
const render = read('render.yaml');
const builder = read('server/build-assets.js');
const server = read('server/index.js');

// Production shell should be intentionally small and stable.
assert((index.match(/<link rel="stylesheet"/g) || []).length <= 2, 'Too many production stylesheets');
assert((index.match(/<script[^>]+src=/g) || []).length <= 3, 'Too many production scripts');
assert(index.includes('/dist/app.css') && index.includes('/dist/app.js'), 'Production bundles are not wired into index.html');
assert(sw.includes('/dist/app.css') && sw.includes('/dist/app.js'), 'Production bundles are not precached');
assert(render.includes('npm run build:assets'), 'Render must build production assets before start');

// Source and transfer budgets protect future regressions.
assert(size('public/dist/app.css') < 220 * 1024, 'CSS bundle exceeds 220 KB source budget');
assert(size('public/dist/app.js') < 450 * 1024, 'JS bundle exceeds 450 KB source budget');
assert(size('public/index.html') < 24 * 1024, 'HTML shell exceeds 24 KB source budget');
for (const file of ['public/dist/app.css.br','public/dist/app.css.gz','public/dist/app.js.br','public/dist/app.js.gz']) assert(fs.existsSync(path.join(root,file)),`Missing compressed bundle: ${file}`);
assert(size('public/dist/app.css.br') < size('public/dist/app.css') * .45, 'Brotli CSS transfer ratio regressed');
assert(size('public/dist/app.js.br') < size('public/dist/app.js') * .45, 'Brotli JS transfer ratio regressed');
assert(server.includes("res.setHeader('Content-Encoding', encoding)"), 'Server must negotiate precompressed assets');
assert(server.includes("res.setHeader('Vary', 'Accept-Encoding')"), 'Compressed response must vary by Accept-Encoding');

// Critical visual and accessibility contracts.
for (const needle of [
  ':focus-visible',
  'prefers-reduced-motion:reduce',
  'grh-product-stage',
  'grh-category-grid-v2',
  'grh-owner-story-v2',
  'grh-pricing-v2',
  'content-visibility:auto',
]) assert(css.includes(needle), `CSS bundle missing premium contract: ${needle}`);

for (const needle of [
  'ANNOUNCEMENT_KEY',
  'End date must be on or after the start date.',
  'ArrowLeft',
  'scrubSampleStage',
  'MutationObserver',
  'placeholder.svg',
]) assert(js.includes(needle), `JS bundle missing UX integrity contract: ${needle}`);

assert(index.includes('lang="en-PH"'), 'Document language missing');
assert(index.includes('aria-live="polite"'), 'Toast live region missing');
assert(index.includes('aria-label="Primary mobile navigation"'), 'Mobile nav label missing');
assert(index.includes('<main class="page" id="app" tabindex="-1">'), 'SPA main landmark/focus target missing');
assert(index.includes('FAQPage') && index.includes('WebSite'), 'Structured data missing');
assert(!/Lorem ipsum|★★★★★|testimonial-avatar/i.test(index + js), 'Fabricated/placeholder marketing content detected');

// Build inputs remain explicit and reviewable rather than globbing arbitrary files.
assert(builder.includes('const CSS_SOURCES = [') && builder.includes('const JS_SOURCES = ['), 'Bundle source ownership must be explicit');
assert(!builder.includes('readdirSync'), 'Builder must not silently bundle arbitrary directory contents');

console.log(`Production quality budgets passed: CSS ${size('public/dist/app.css.br')} B br / ${size('public/dist/app.css')} B source; JS ${size('public/dist/app.js.br')} B br / ${size('public/dist/app.js')} B source; HTML ${size('public/index.html')} B.`);
