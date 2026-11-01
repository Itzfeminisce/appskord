import type { Background } from '../types';
import type { MediaCache } from './cache';
import type { Ctx } from './drawFrame';
import { DRIFT_AMOUNT, DRIFT_MS, GRAIN_SEED, GRAIN_TILE } from './tokens';

/** Hex colour with an alpha, for gradient stops that fade a colour out without darkening it. */
export function withAlpha(colour: string, a: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return a <= 0 ? 'rgba(0,0,0,0)' : colour;
  const hex = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Slow loop offset in px for a scene-local time; zero when drift is off. */
export function driftAt(bg: Background, localMs: number, short: number, phase = 0): { x: number; y: number } {
  if (!bg.drift) return { x: 0, y: 0 };
  const a = (Math.PI * 2 * localMs) / DRIFT_MS + phase;
  return { x: Math.sin(a) * DRIFT_AMOUNT * short, y: Math.sin(a * 0.8 + 1.3) * DRIFT_AMOUNT * short };
}

// Blob centres and radii as fractions of the canvas; fixed so every frame and machine agree.
const BLOBS = [
  { x: 0.18, y: 0.2, r: 0.55 }, { x: 0.86, y: 0.42, r: 0.5 }, { x: 0.32, y: 0.88, r: 0.6 }, { x: 0.9, y: 0.95, r: 0.45 },
];

/** Fills the whole canvas with a v2 scene background. `alpha` is the scene's opacity during a transition. */
export function drawBackground(ctx: Ctx, bg: Background, w: number, h: number, localMs: number, cache: MediaCache, alpha = 1): void {
  const colours = bg.colours.length ? bg.colours : ['#000000'];
  const short = Math.min(w, h);
  const d = driftAt(bg, localMs, short);
  // Drawn past every edge by the drift amount, so a drifting background never shows the canvas.
  const m = bg.drift ? Math.ceil(DRIFT_AMOUNT * short) + 2 : 0;
  ctx.globalAlpha = alpha;
  if (bg.kind === 'gradient' || (bg.kind === 'grain' && colours.length > 1)) {
    ctx.fillStyle = (colours.length > 1 && linear(ctx, cache, colours, bg.angle ?? 180, w, h)) || colours[0]!;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.fillRect(-d.x - m, -d.y - m, w + m * 2, h + m * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = colours[0]!;
    ctx.fillRect(0, 0, w, h);
  }
  if (bg.kind === 'blobs') {
    // Soft blobs have no detail, so they are painted once at quarter size and drawn scaled; drift moves the whole layer.
    const layer = blobLayer(cache, colours, w, h, m);
    if (layer) ctx.drawImage(layer, -m + d.x, -m + d.y, w + m * 2, h + m * 2);
    else paintBlobs(ctx, cache, colours, w, h, 0, 0, d);
  } else if (bg.kind === 'blocks') {
    // Full-bleed slabs: the first spans the lower third on a slant, the next caps the top corner.
    for (let i = 1; i < colours.length; i++) {
      ctx.fillStyle = colours[i]!;
      ctx.beginPath();
      if (i % 2 === 1) {
        ctx.moveTo(-m, h * 0.7 + d.y);
        ctx.lineTo(w + m, h * 0.6 + d.y);
        ctx.lineTo(w + m, h + m);
        ctx.lineTo(-m, h + m);
      } else {
        ctx.moveTo(w * 0.62 + d.x, -m);
        ctx.lineTo(w + m, -m);
        ctx.lineTo(w + m, h * 0.18 + d.y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  if ((bg.grain ?? 0) > 0) drawGrain(ctx, cache, bg.grain!, w, h, localMs, alpha);
}

const BLOB_SCALE = 0.25;

function blobLayer(cache: MediaCache, colours: string[], w: number, h: number, m: number): OffscreenCanvas | undefined {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  return cache.paint(`blobs|${colours.join(',')}|${w}x${h}|${m}`, () => {
    const c = new OffscreenCanvas(Math.ceil((w + m * 2) * BLOB_SCALE), Math.ceil((h + m * 2) * BLOB_SCALE));
    const g = c.getContext('2d');
    if (!g) return undefined;
    g.scale(BLOB_SCALE, BLOB_SCALE);
    g.translate(m, m);
    paintBlobs(g, cache, colours, w, h, m, BLOB_SCALE, { x: 0, y: 0 });
    return c;
  });
}

// `key` keeps gradients made on the quarter-size layer apart from ones made on the frame itself.
function paintBlobs(ctx: Ctx, cache: MediaCache, colours: string[], w: number, h: number, m: number, key: number, d: { x: number; y: number }) {
  const long = Math.max(w, h);
  ctx.fillStyle = colours[0]!;
  ctx.fillRect(-m, -m, w + m * 2, h + m * 2);
  for (let i = 1; i < colours.length; i++) {
    const spot = BLOBS[(i - 1) % BLOBS.length]!;
    const r = Math.round(spot.r * long);
    const colour = colours[i]!;
    const g = cache.paint(`blob|${colour}|${r}|${key}`, () => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      // Stand-in contexts (tests, a headless measure pass) may return no gradient; the blob is skipped there.
      g?.addColorStop(0, withAlpha(colour, 0.85));
      g?.addColorStop(1, withAlpha(colour, 0));
      return g;
    });
    if (!g) continue;
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(spot.x * w + d.x, spot.y * h + d.y);
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
}

function linear(ctx: Ctx, cache: MediaCache, colours: string[], angle: number, w: number, h: number): CanvasGradient | undefined {
  return cache.paint(`linear|${colours.join(',')}|${angle}|${w}x${h}`, () => {
    // CSS angles: 0 points up, 90 points right; the line spans the box corner to corner along that direction.
    const a = (angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    const g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
    if (!g) return undefined;
    colours.forEach((c, i) => g.addColorStop(i / (colours.length - 1), c));
    return g;
  });
}

function drawGrain(ctx: Ctx, cache: MediaCache, amount: number, w: number, h: number, localMs: number, alpha: number) {
  const tile = cache.grainTile(GRAIN_SEED, GRAIN_TILE);
  if (!tile) return;
  const pattern = cache.paint('grain|pattern', () => ctx.createPattern(tile, 'repeat'));
  if (!pattern) return;
  // The tile jumps to a new offset 12 times a second, so grain shimmers like film instead of sitting on the glass.
  const step = Math.floor(localMs / 83);
  const ox = (step * 37) % GRAIN_TILE;
  const oy = (step * 71) % GRAIN_TILE;
  ctx.save();
  ctx.globalAlpha = alpha * Math.min(1, amount * 2.5);
  ctx.fillStyle = pattern;
  ctx.translate(-ox, -oy);
  ctx.fillRect(ox, oy, w, h);
  ctx.restore();
}
