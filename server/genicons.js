'use strict';
// Generate simple branded PNG icons for the PWA using Node's built-in zlib.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Draw a smooth-rounded orange square with a white circle-and-arrow-ish icon.
// We render gradient-ish via simple math.
function makeIcon(size) {
  const sigBits = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    sigBits[y * (size * 4 + 1)] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      // background gradient orange
      const grad = 0.75 * 255;
      let r = Math.round(255), g = Math.round(90 + (x / size) * 40), b = Math.round(43 + (y / size) * 20);
      // relative coords
      const rx = x / size - 0.5, ry = y / size - 0.5;
      // rounded-rect mask
      const rad = 0.18;
      const cx = Math.max(Math.abs(rx) - (0.5 - rad), 0);
      const cy = Math.max(Math.abs(ry) - (0.5 - rad), 0);
      const dist = Math.sqrt(cx * cx + cy * cy);
      const inside = dist <= rad;
      // draw white circular arrow: outer ring
      const ringR = 0.18, ringW = 0.055;
      const dRing = Math.hypot(rx, ry);
      // arrow glyph: simpler - a white loop + notch. We'll approximate a circle with a gap & arrow head.
      let white = false;
      if (dRing > ringR - ringW && dRing < ringR + ringW) {
        const ang = Math.atan2(ry, rx);
        if (ang > -2.6 && ang < 2.6) white = true; // gap at top
      }
      // arrow head
      const head = 0.14;
      const hx = rx + head, hy = ry + 0.0;
      if (Math.hypot(hx, hy) < 0.05 && ry > -0.1 && ry < 0.12 && rx > -0.05) white = true;
      if (!inside) { r = 0; g = 0; b = 0; } // transparent outside
      else if (white) { r = 255; g = 255; b = 255; }
      sigBits[i] = r; sigBits[i + 1] = g; sigBits[i + 2] = b;
      sigBits[i + 3] = inside ? 255 : 0;
    }
  }
  const raw = zlib.deflateSync(sigBits);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', raw),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

fs.writeFileSync(path.join(OUT, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), makeIcon(512));
console.log('Icons generated: 192, 512');
