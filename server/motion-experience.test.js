'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const css = read('public/css/motion.css');
const js = read('public/js/motion.js');
const index = read('public/index.html');
const sw = read('public/service-worker.js');

assert(index.includes('/css/motion.css'), 'Production shell must load motion.css');
assert(index.includes('/js/motion.js'), 'Production shell must load motion.js');
assert(sw.includes('/css/motion.css') && sw.includes('/js/motion.js'), 'PWA shell must cache motion assets');
assert(css.includes('prefers-reduced-motion:reduce'), 'Motion system must respect reduced-motion accessibility');
assert(css.includes('@keyframes grhHeroRise'), 'Hero entrance animation must exist');
assert(css.includes('@keyframes grhMapReveal'), 'Map transition must exist');
assert(css.includes('@keyframes grhHeartPop'), 'Favorite microinteraction must exist');
assert(css.includes('@keyframes grhQrScan'), 'QR handover motion must exist');
assert(js.includes('IntersectionObserver'), 'Scroll reveal must use IntersectionObserver instead of scroll-loop layout work');
assert(js.includes('(hover:hover) and (pointer:fine)'), 'Pointer parallax/tilt must be desktop-pointer gated');
assert(js.includes('prefers-reduced-motion: reduce'), 'JS motion controller must honor reduced motion');
assert(js.includes('MutationObserver'), 'SPA route content must be decorated after navigation');
assert(!/gsap|anime\.js|framer-motion/i.test(js + css + index), 'Motion layer should remain dependency-free for launch performance');

console.log('motion experience regression tests passed');
