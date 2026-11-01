// Draws the Icon frame (frames/Icon.dc.html) into public/icon/{16,48,128}.png. No dependencies.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const TILE = [0x11, 0x11, 0x14];
const WHITE = [0xff, 0xff, 0xff];
// Each size as drawn in the frame: tile radius, glyph size, and the 24-unit glyph (lines, stroke, dot).
const SIZES = {
  128: { radius: 32, glyph: 88, stroke: 2.4, lines: [[3, 8.5, 8], [2, 12, 8], [3, 15.5, 8]], dot: [15.5, 12, 4.5], dotColour: [0xbe, 0x18, 0x5d] },
  48: { radius: 12, glyph: 34, stroke: 2.4, lines: [[3, 8.5, 8], [2, 12, 8], [3, 15.5, 8]], dot: [15.5, 12, 4.5], dotColour: [0xbe, 0x18, 0x5d] },
  16: { radius: 4, glyph: 13, stroke: 3, lines: [[3, 8.5, 8], [3, 15.5, 8]], dot: [15.5, 12, 5], dotColour: [0xec, 0x48, 0x99] },
};

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

const SS = 4; // 4x4 supersampling for smooth edges
const coverage = (x, y, inside) => {
  let hits = 0;
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hits++;
  return hits / (SS * SS);
};
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);

const png = (size) => {
  const spec = SIZES[size];
  const k = spec.glyph / 24;
  const off = (size - spec.glyph) / 2;
  const toGlyph = (p) => (p - off) / k;
  const r = spec.radius;
  const c = size / 2;
  const tile = (px, py) => {
    const dx = Math.max(Math.abs(px - c) - (c - r), 0);
    const dy = Math.max(Math.abs(py - c) - (c - r), 0);
    return dx * dx + dy * dy <= r * r;
  };
  // Horizontal strokes with round caps: distance to the segment at most half the stroke.
  const line = (px, py) => {
    const gx = toGlyph(px), gy = toGlyph(py);
    return spec.lines.some(([x0, y, x1]) => {
      const nx = Math.min(Math.max(gx, x0), x1);
      return (gx - nx) ** 2 + (gy - y) ** 2 <= (spec.stroke / 2) ** 2;
    });
  };
  const [dx, dy, dr] = spec.dot;
  const dot = (px, py) => (toGlyph(px) - dx) ** 2 + (toGlyph(py) - dy) ** 2 <= dr * dr;

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, tile);
      let rgb = mix(TILE, WHITE, coverage(x, y, line));
      rgb = mix(rgb, spec.dotColour, coverage(x, y, dot));
      const o = 1 + x * 4;
      for (let i = 0; i < 3; i++) row[o + i] = Math.round(rgb[i]);
      row[o + 3] = Math.round(a * 255);
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
for (const size of Object.keys(SIZES)) writeFileSync(`public/icon/${size}.png`, png(Number(size)));
