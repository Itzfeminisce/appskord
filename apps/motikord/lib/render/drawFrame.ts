import type { Aspect, Box, ChartLayer, Layer, MediaLayer, Recipe, Scene, ShapeLayer, TextLayer } from '../types';
import type { MediaCache } from './cache';
import { ease } from './easing';
import { layerPose, type Pose } from './presets';
import { boxFor } from './reflow';
import { fitText, type Fit, type Measure } from './textFit';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Type sizes in a recipe are px on a canvas whose short side is 1080. */
export const BASE_SHORT = 1080;

export const clipDuration = (recipe: Pick<Recipe, 'scenes'>) => recipe.scenes.reduce((sum, s) => sum + s.durationMs, 0);

export interface SceneAt { index: number; scene: Scene; startMs: number; localMs: number }

/** The scene playing at tMs; a scene owns [start, start + duration), and the clip end stays on the last scene. */
export function sceneAt(recipe: Pick<Recipe, 'scenes'>, tMs: number): SceneAt | undefined {
  let start = 0;
  const t = Math.max(0, tMs);
  for (let i = 0; i < recipe.scenes.length; i++) {
    const scene = recipe.scenes[i]!;
    if (t < start + scene.durationMs || i === recipe.scenes.length - 1) {
      return { index: i, scene, startMs: start, localMs: Math.min(t - start, scene.durationMs) };
    }
    start += scene.durationMs;
  }
  return undefined;
}

/** Layers on screen at a scene-local time, bottom first. */
export const activeLayers = (scene: Scene, localMs: number): Layer[] => scene.layers.filter((l) => localMs >= l.startMs && localMs < l.endMs);

export const fontFor = (l: Pick<TextLayer, 'font' | 'weight'>, px: number) => `${l.weight} ${px}px "${l.font.replace(/"/g, '')}", system-ui, sans-serif`;

export interface DrawOptions { seeThrough?: boolean }

/** Draws frame tMs of the recipe at `aspect` onto ctx, filling its whole canvas. Same inputs give the same pixels. */
export function drawFrame(ctx: Ctx, recipe: Recipe, aspect: Aspect, tMs: number, cache: MediaCache, opts: DrawOptions = {}): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.clearRect(0, 0, w, h);
  const at = sceneAt(recipe, tMs);
  if (!at) return;
  const { scene, localMs } = at;
  if (!opts.seeThrough && scene.background !== 'transparent') {
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, w, h);
  }
  const unit = Math.min(w, h) / BASE_SHORT;
  for (const layer of activeLayers(scene, localMs)) {
    const t = localMs - layer.startMs;
    const pose = layerPose(layer, t);
    const alpha = layer.opacity * pose.alpha;
    if (alpha <= 0.001 || pose.scale <= 0.001 || pose.reveal <= 0) continue;
    const b = boxFor(layer, aspect, recipe.aspect, scene.layout);
    drawLayer(ctx, layer, b, pose, alpha, t, { w, h, unit }, cache);
  }
}

interface Frame { w: number; h: number; unit: number }

function drawLayer(ctx: Ctx, layer: Layer, b: Box, pose: Pose, alpha: number, t: number, f: Frame, cache: MediaCache) {
  const bw = b.w * f.w;
  const bh = b.h * f.h;
  const short = Math.min(f.w, f.h);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(b.x * f.w + bw / 2 + pose.dx * short, b.y * f.h + bh / 2 + pose.dy * short);
  const turn = (b.rotation ?? 0) + pose.rotate;
  if (turn) ctx.rotate((turn * Math.PI) / 180);
  if (pose.scale !== 1) ctx.scale(pose.scale, pose.scale);
  if (pose.reveal < 1) {
    ctx.beginPath();
    ctx.rect(-bw / 2 - bw, -bh / 2 - bh, bw + bw * pose.reveal, bh * 3);
    ctx.clip();
  }
  const blur = pose.blur * f.unit;
  if (blur > 0.5) drawBlurred(ctx, (c) => drawContent(c, layer, bw, bh, pose, t, f.unit, cache), bw, bh, blur, cache);
  else drawContent(ctx, layer, bw, bh, pose, t, f.unit, cache);
  ctx.restore();
}

function drawContent(ctx: Ctx, layer: Layer, bw: number, bh: number, pose: Pose, t: number, unit: number, cache: MediaCache) {
  if (layer.type === 'text') drawText(ctx, layer, bw, bh, pose.typed, unit, cache);
  else if (layer.type === 'shape') drawShape(ctx, layer, bw, bh, unit);
  else if (layer.type === 'chart') drawChart(ctx, layer, bw, bh, t, unit, cache);
  else drawMedia(ctx, layer, bw, bh, t, cache);
}

// A full-canvas blur filter costs about 30 ms a frame in software, so blur a small copy and scale it up.
function drawBlurred(ctx: Ctx, draw: (c: Ctx) => void, bw: number, bh: number, blur: number, cache: MediaCache) {
  const s = Math.min(1, 3 / blur);
  const margin = blur * 2;
  const pw = Math.ceil((bw + margin * 2) * s);
  const ph = Math.ceil((bh + margin * 2) * s);
  const sc = cache.scratch(pw, ph);
  if (!sc) {
    ctx.filter = `blur(${blur.toFixed(1)}px)`;
    draw(ctx);
    return;
  }
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.globalAlpha = 1;
  sc.filter = 'none';
  sc.clearRect(0, 0, pw, ph);
  sc.filter = `blur(${(blur * s).toFixed(2)}px)`;
  sc.translate(pw / 2, ph / 2);
  sc.scale(s, s);
  draw(sc);
  ctx.drawImage(sc.canvas, 0, 0, pw, ph, -pw / s / 2, -ph / s / 2, pw / s, ph / s);
}

const measurer = (ctx: Ctx, l: Pick<TextLayer, 'font' | 'weight'>): Measure => (s, px) => {
  ctx.font = fontFor(l, px);
  return ctx.measureText(s).width;
};

function fitIn(ctx: Ctx, cache: MediaCache, l: Pick<TextLayer, 'font' | 'weight'>, text: string, width: number, height: number, maxSize: number, lineHeight: number): Fit {
  const key = `${l.font}|${l.weight}|${Math.round(maxSize)}|${Math.round(width)}|${Math.round(height)}|${lineHeight}|${text}`;
  return cache.fit(key, () => fitText({ text, width, height, maxSize, lineHeight, measure: measurer(ctx, l) }));
}

function drawText(ctx: Ctx, l: TextLayer, bw: number, bh: number, typed: number, unit: number, cache: MediaCache) {
  const pad = l.background ? 16 * unit : 0;
  if (l.background) {
    ctx.fillStyle = l.background;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 12 * unit);
    ctx.fill();
  }
  if (typed <= 0) return;
  // Text never spills out of its box on screen; the checker reports when it had to shrink.
  const fit = fitIn(ctx, cache, l, l.text, bw - pad * 2, bh - pad * 2, l.sizePx * unit, l.lineHeight);
  const step = fit.sizePx * l.lineHeight;
  ctx.font = fontFor(l, fit.sizePx);
  ctx.fillStyle = l.colour;
  ctx.textAlign = l.align;
  ctx.textBaseline = 'middle';
  const x = l.align === 'left' ? -bw / 2 + pad : l.align === 'right' ? bw / 2 - pad : 0;
  let left = typed >= 1 ? Infinity : Math.floor(typed * fit.lines.reduce((n, s) => n + s.length, 0));
  let y = -(fit.lines.length * step) / 2 + step / 2;
  for (const line of fit.lines) {
    if (left <= 0) break;
    ctx.fillText(left >= line.length ? line : line.slice(0, left), x, y);
    left -= line.length;
    y += step;
  }
}

function drawShape(ctx: Ctx, l: ShapeLayer, bw: number, bh: number, unit: number) {
  ctx.fillStyle = l.fill;
  ctx.beginPath();
  if (l.shape === 'circle') ctx.ellipse(0, 0, bw / 2, bh / 2, 0, 0, Math.PI * 2);
  else if (l.shape === 'line') { const t = Math.max(bh, 2 * unit); ctx.rect(-bw / 2, -t / 2, bw, t); }
  else if (l.radius) ctx.roundRect(-bw / 2, -bh / 2, bw, bh, Math.min(l.radius * unit, bw / 2, bh / 2));
  else ctx.rect(-bw / 2, -bh / 2, bw, bh);
  ctx.fill();
}

function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  const s = src as unknown as Record<string, number>;
  if (typeof s.displayWidth === 'number') return { w: s.displayWidth, h: s.displayHeight! };
  if (typeof s.videoWidth === 'number') return { w: s.videoWidth, h: s.videoHeight! };
  if (typeof s.naturalWidth === 'number') return { w: s.naturalWidth, h: s.naturalHeight! };
  return { w: Number(s.width) || 0, h: Number(s.height) || 0 };
}

function drawMedia(ctx: Ctx, l: MediaLayer, bw: number, bh: number, t: number, cache: MediaCache) {
  const src = l.type === 'image' ? cache.image(l.assetId) : cache.videoFrame(l.assetId, t);
  if (!src) return;
  const { w: sw, h: sh } = sourceSize(src);
  if (!sw || !sh) return;
  if (l.fit === 'cover') {
    const k = Math.max(bw / sw, bh / sh);
    const cw = bw / k;
    const ch = bh / k;
    ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, -bw / 2, -bh / 2, bw, bh);
  } else {
    const k = Math.min(bw / sw, bh / sh);
    ctx.drawImage(src, -(sw * k) / 2, -(sh * k) / 2, sw * k, sh * k);
  }
}

const formatNumber = (v: number, decimals: number) => {
  const [whole, frac] = Math.abs(v).toFixed(decimals).split('.');
  return (v < 0 ? '-' : '') + whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
};

function drawChart(ctx: Ctx, l: ChartLayer, bw: number, bh: number, t: number, unit: number, cache: MediaCache) {
  // Charts build up while the layer comes in, whichever preset it uses.
  const grow = l.in ? ease(l.in.feel, t / Math.max(1, l.in.durationMs)) : 1;
  const values = l.values;
  if (!values.length) return;
  const face = { font: 'Geist', weight: 600 };
  ctx.fillStyle = l.colour;
  ctx.strokeStyle = l.colour;
  if (l.chart === 'number') {
    const first = values[0]!;
    const decimals = Number.isInteger(first.value) ? 0 : 1;
    const text = formatNumber(first.value * Math.min(1, grow), decimals);
    const numberH = first.label ? bh * 0.72 : bh;
    // Fit the final value so the size does not jump while counting up.
    const fit = fitIn(ctx, cache, face, formatNumber(first.value, decimals), bw, numberH, numberH, 1);
    ctx.font = fontFor(face, fit.sizePx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, -bh / 2 + numberH / 2);
    if (first.label) {
      const lf = fitIn(ctx, cache, { font: 'Geist', weight: 500 }, first.label, bw, bh - numberH, 48 * unit, 1.2);
      ctx.font = fontFor({ font: 'Geist', weight: 500 }, lf.sizePx);
      ctx.fillText(lf.lines.join(' '), 0, bh / 2 - (bh - numberH) / 2);
    }
    return;
  }
  const labelH = Math.min(bh * 0.15, 40 * unit);
  const plotH = bh - labelH;
  const max = Math.max(...values.map((v) => v.value), 0) || 1;
  const slot = bw / values.length;
  const top = -bh / 2;
  if (l.chart === 'bar') {
    values.forEach((v, i) => {
      const barH = (Math.max(0, v.value) / max) * plotH * grow;
      ctx.fillRect(-bw / 2 + i * slot + slot * 0.15, top + plotH - barH, slot * 0.7, barH);
    });
  } else {
    ctx.lineWidth = 6 * unit;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    const shown = Math.max(1, Math.ceil(values.length * Math.min(1, grow)));
    values.slice(0, shown).forEach((v, i) => {
      const x = -bw / 2 + i * slot + slot / 2;
      const y = top + plotH - (Math.max(0, v.value) / max) * plotH;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  const size = Math.max(1, Math.floor(labelH * 0.7));
  ctx.font = fontFor(face, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  values.forEach((v, i) => ctx.fillText(v.label, -bw / 2 + i * slot + slot / 2, bh / 2 - labelH / 2, slot * 0.95));
}
