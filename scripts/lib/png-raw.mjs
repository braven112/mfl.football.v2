/**
 * Minimal dependency-free PNG decode/encode (8-bit, non-interlaced).
 *
 * Exists because the notification-icon generator has to run in CI and in a
 * bare `pnpm install --prod`-less checkout, and `sharp` is not a dependency
 * of this repo. Scope is deliberately tiny: read the RGB/RGBA/grey PNGs we
 * ship under public/assets, write RGBA ones back. Anything fancier (16-bit,
 * interlaced, palette) throws rather than guessing.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Decode a PNG file to `{ width, height, data }` with data as RGBA bytes. */
export function readPng(file) {
  const b = fs.readFileSync(file);
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    const chunk = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      if (chunk[12] !== 0) throw new Error(`${file}: interlaced PNGs unsupported`);
    } else if (type === 'IDAT') idat.push(chunk);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`${file}: bit depth ${bitDepth} unsupported`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`${file}: color type ${colorType} unsupported`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const flat = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = flat.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? flat.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const bU = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += bU;
      else if (filter === 3) v += (a + bU) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(bU - c), pb = Math.abs(a - c), pc = Math.abs(a + bU - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bU : c;
      }
      cur[x] = v & 255;
    }
  }

  // Normalize every color type to RGBA so callers only handle one shape.
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < flat.length; i += bpp, o += 4) {
    if (channels === 4) { data[o] = flat[i]; data[o + 1] = flat[i + 1]; data[o + 2] = flat[i + 2]; data[o + 3] = flat[i + 3]; }
    else if (channels === 3) { data[o] = flat[i]; data[o + 1] = flat[i + 1]; data[o + 2] = flat[i + 2]; data[o + 3] = 255; }
    else if (channels === 2) { data[o] = data[o + 1] = data[o + 2] = flat[i]; data[o + 3] = flat[i + 1]; }
    else { data[o] = data[o + 1] = data[o + 2] = flat[i]; data[o + 3] = 255; }
  }
  return { width, height, data };
}

/** Encode `{ width, height, data }` (RGBA bytes) to a PNG buffer. */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none — these are tiny icons
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    // Level 9 + a fixed strategy so a re-run of the generator is byte-identical.
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writePng(file, image) {
  fs.writeFileSync(file, encodePng(image));
}
