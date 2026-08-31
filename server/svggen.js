'use strict';

// Generate simple branded SVG placeholder images for listings.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'images', 'svg');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const EMOJI_BY_TOKEN = [
  ['camera', '📷'], ['dslr', '📷'], ['lens', '🔭'], ['laptop', '💻'], ['projector', '🎬'],
  ['tent', '⛺'], ['chair', '🪑'], ['camping', '⛺'],
  ['speaker', '🔊'], ['party', '🎉'], ['mic', '🎤'], ['microphone', '🎤'],
  ['gown', '👗'], ['wedding', '💍'], ['dress', '👗'],
  ['car', '🚗'], ['toyota', '🚗'], ['vehicle', '🚙'],
  ['generator', '⚡'], ['power', '🔋'],
  ['pickleball', '🏓'], ['racket', '🏸'], ['tennis', '🎾'], ['bike', '🚲'], ['bicycle', '🚴'],
  ['playstation', '🎮'], ['game', '🎮'], ['console', '🕹️'],
  ['drill', '🛠️'], ['tool', '🛠️'],
  ['package', '📦'], ['bundle', '📦'], ['pack', '📦'],
];

function emojiFor(title) {
  const t = title.toLowerCase();
  for (const [token, e] of EMOJI_BY_TOKEN) {
    if (t.includes(token)) return e;
  }
  return '📦';
}

function hexFor(seed) {
  const colors = ['#6C5CE7', '#27AE60', '#E84393', '#F39C12', '#3498DB', '#E74C3C', '#8E44AD', '#F1C40F', '#1ABC9C', '#2C3E50'];
  return colors[seed % colors.length];
}

function generate(id, title) {
  const emoji = emojiFor(title);
  const color = hexFor(id);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${color}"/>
      <stop offset="100%" stop-color="${shade(color)}"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#g)"/>
  <rect width="640" height="480" fill="url(#g)" opacity="0.0"/>
  <circle cx="500" cy="80" r="160" fill="#ffffff" opacity="0.08"/>
  <circle cx="120" cy="420" r="140" fill="#ffffff" opacity="0.08"/>
  <text x="320" y="215" font-size="120" text-anchor="middle">${emoji}</text>
  <rect x="40" y="370" width="560" rx="16" fill="#000000" opacity="0.35"/>
  <text x="320" y="405" font-size="26" fill="#ffffff" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif">${escapeXml(title)}</text>
  <text x="320" y="445" font-size="18" fill="#ffffff" opacity="0.85" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif">GoRentHive</text>
</svg>`;
  fs.writeFileSync(path.join(OUT, id + '.svg'), svg);
  return '/images/svg/' + id + '.svg';
}

function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, r - 60); g = Math.max(0, g - 60); b = Math.max(0, b - 60);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { generate, emojiFor };
