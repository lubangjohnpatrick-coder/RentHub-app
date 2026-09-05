'use strict';

const { _test } = require('./upload');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function jpegSegment(marker, payload) {
  const p = Buffer.from(payload);
  const out = Buffer.alloc(4 + p.length);
  out[0] = 0xFF; out[1] = marker;
  out.writeUInt16BE(p.length + 2, 2);
  p.copy(out, 4);
  return out;
}

const jpeg = Buffer.concat([
  Buffer.from([0xFF, 0xD8]),
  jpegSegment(0xE0, Buffer.from('JFIF\0')),
  jpegSegment(0xE1, Buffer.from('Exif\0\0GPS SECRET')),
  jpegSegment(0xFE, Buffer.from('COMMENT SECRET')),
  Buffer.from([0xFF, 0xDA, 0x00, 0x02, 0x01, 0x02, 0x03, 0xFF, 0xD9]),
]);
const cleanJpeg = _test.stripJpegMetadata(jpeg);
assert(!cleanJpeg.includes(Buffer.from('GPS SECRET')), 'JPEG EXIF metadata was not removed');
assert(!cleanJpeg.includes(Buffer.from('COMMENT SECRET')), 'JPEG comment metadata was not removed');
assert(cleanJpeg.includes(Buffer.from('JFIF')), 'JPEG structural APP0 data should remain');

function pngChunk(type, payload) {
  const p = Buffer.from(payload);
  const out = Buffer.alloc(12 + p.length);
  out.writeUInt32BE(p.length, 0);
  out.write(type, 4, 4, 'ascii');
  p.copy(out, 8);
  // CRC is deliberately synthetic; sanitizer does not alter retained chunks.
  out.writeUInt32BE(0, 8 + p.length);
  return out;
}
const png = Buffer.concat([
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
  pngChunk('IHDR', Buffer.alloc(13)),
  pngChunk('eXIf', Buffer.from('GPS SECRET')),
  pngChunk('iTXt', Buffer.from('COMMENT SECRET')),
  pngChunk('IDAT', Buffer.from([1,2,3])),
  pngChunk('IEND', Buffer.alloc(0)),
]);
const cleanPng = _test.stripPngMetadata(png);
assert(!cleanPng.includes(Buffer.from('GPS SECRET')), 'PNG EXIF metadata was not removed');
assert(!cleanPng.includes(Buffer.from('COMMENT SECRET')), 'PNG text metadata was not removed');
assert(cleanPng.includes(Buffer.from('IDAT')), 'PNG image data should remain');

function webpChunk(type, payload) {
  const p = Buffer.from(payload);
  const pad = p.length % 2;
  const out = Buffer.alloc(8 + p.length + pad);
  out.write(type, 0, 4, 'ascii');
  out.writeUInt32LE(p.length, 4);
  p.copy(out, 8);
  return out;
}
const vp8x = Buffer.alloc(10); vp8x[0] = 0x0C;
const webpBody = Buffer.concat([
  Buffer.from('WEBP'),
  webpChunk('VP8X', vp8x),
  webpChunk('EXIF', Buffer.from('GPS SECRET')),
  webpChunk('XMP ', Buffer.from('COMMENT SECRET')),
  webpChunk('VP8 ', Buffer.from([1,2,3,4])),
]);
const webpHeader = Buffer.alloc(8); webpHeader.write('RIFF', 0, 4, 'ascii'); webpHeader.writeUInt32LE(webpBody.length, 4);
const webp = Buffer.concat([webpHeader, webpBody]);
const cleanWebp = _test.stripWebpMetadata(webp);
assert(!cleanWebp.includes(Buffer.from('GPS SECRET')), 'WebP EXIF metadata was not removed');
assert(!cleanWebp.includes(Buffer.from('COMMENT SECRET')), 'WebP XMP metadata was not removed');
assert(cleanWebp.includes(Buffer.from('VP8 ')), 'WebP image data should remain');

console.log('Upload metadata sanitization tests passed.');
