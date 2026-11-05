// Writes public/icon/{16,32,48,128}.png from the Icon frame: a dark tile with four cards laid out like a board. No dependencies.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const TILE = [0x11, 0x11, 0x14];
const WHITE = [0xff, 0xff, 0xff];
const TEAL = [0x14, 0xb8, 0xa6];
const TEAL_SMALL = [0x2d, 0xd4, 0xbf];
// Cards in the frame's 24-unit viewBox: [x, y, w, h, colour]. At 16 px the frame draws two columns instead.
const BOARD = [[4, 4, 7, 9, WHITE], [13, 4, 7, 5, WHITE], [13, 11, 7, 9, TEAL], [4, 15, 7, 5, WHITE]];
const COLUMNS = [[3, 3, 8, 18, WHITE], [13, 3, 8, 18, TEAL_SMALL]];
// Glyph size per icon size, from the frame (92 of 128, 35 of 48, 13 of 16).
const GLYPH = { 16: 13, 32: 23, 48: 35, 128: 92 };

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** Coverage 0..1 of a pixel by a shape, using 4x4 supersampling for smooth edges. */
const coverage = (x, y, inside) => {
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits++;
  return hits / 16;
};

const roundRect = (x0, y0, w, h, r) => (px, py) => {
  const dx = Math.max(Math.abs(px - (x0 + w / 2)) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(py - (y0 + h / 2)) - (h / 2 - r), 0);
  return dx * dx + dy * dy <= r * r;
};

const png = (size) => {
  const tile = roundRect(0, 0, size, size, size / 4);
  const scale = GLYPH[size] / 24;
  const offset = (size - GLYPH[size]) / 2;
  const cards = (size === 16 ? COLUMNS : BOARD).map(([x, y, w, h, colour]) => ({
    inside: roundRect(offset + x * scale, offset + y * scale, w * scale, h * scale, 2 * scale),
    colour,
  }));
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let rgb = TILE;
      for (const card of cards) {
        const c = coverage(x, y, card.inside);
        if (c > 0) rgb = rgb.map((v, i) => v * (1 - c) + card.colour[i] * c);
      }
      const o = 1 + x * 4;
      for (let i = 0; i < 3; i++) row[o + i] = Math.round(rgb[i]);
      row[o + 3] = Math.round(coverage(x, y, tile) * 255);
    }
    rows.push(row);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`public/icon/${size}.png`, png(size));
