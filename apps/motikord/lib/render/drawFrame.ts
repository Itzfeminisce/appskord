import type { Aspect, Box, ChartLayer, Layer, MediaLayer, Recipe, Scene, ShapeLayer, TextLayer } from '../types';
import type { MediaCache } from './cache';
import { drawBackground } from './background';
import { clamp01, ease } from './easing';
import { inLength, inPose, layerPose, REST, type Pose, type PoseSkip } from './presets';
import { HIGHLIGHT_WIPE_MS, KEN_BURNS_SCALE, LINE_STAGGER_MS, WORD_STAGGER_MS } from './tokens';
import { blends, transitionProgress, transitionShots, type Shot } from './transitions';
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
  // At or past the end, show the last instant inside the last scene instead of a blank frame.
  const end = clipDuration(recipe);
  const at = sceneAt(recipe, end > 0 && tMs >= end ? end - 1 : tMs);
  if (!at) return;
  const { scene, localMs } = at;
  const tr = scene.transition;
  const prev = at.index > 0 ? recipe.scenes[at.index - 1] : undefined;
  // A transition plays over the start of the incoming scene, so scene timing is the same with or without it.
  if (tr && prev && blends(tr.kind) && localMs < tr.ms) {
    const shots = transitionShots(tr.kind, transitionProgress(recipe, localMs, tr.ms));
    if (shots.out) drawShot(ctx, recipe, aspect, prev, Math.max(0, prev.durationMs - 1), shots.out, cache, opts);
    drawShot(ctx, recipe, aspect, scene, localMs, shots.in, cache, opts);
    return;
  }
  drawScene(ctx, recipe, aspect, scene, localMs, 1, cache, opts);
}

function drawShot(ctx: Ctx, recipe: Recipe, aspect: Aspect, scene: Scene, localMs: number, shot: Shot, cache: MediaCache, opts: DrawOptions) {
  if (shot.alpha <= 0.001 || shot.reveal <= 0) return;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.save();
  if (shot.reveal < 1) {
    ctx.beginPath();
    ctx.rect(0, 0, w * shot.reveal, h);
    ctx.clip();
  }
  const s = shot.scale;
  if (s !== 1 || shot.dx || shot.dy) ctx.setTransform(s, 0, 0, s, (w / 2) * (1 - s) + shot.dx * w, (h / 2) * (1 - s) + shot.dy * h);
  drawScene(ctx, recipe, aspect, scene, localMs, shot.alpha, cache, opts);
  ctx.restore();
}

const NO_SKIP: PoseSkip = {};
const SKIP_IN: PoseSkip = { in: true };
const SKIP_DURING: PoseSkip = { during: true };

function drawScene(ctx: Ctx, recipe: Recipe, aspect: Aspect, scene: Scene, localMs: number, alpha: number, cache: MediaCache, opts: DrawOptions) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (!opts.seeThrough) {
    if (scene.bg) drawBackground(ctx, scene.bg, w, h, localMs, cache, alpha);
    else if (scene.background !== 'transparent') {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = scene.background;
      ctx.fillRect(0, 0, w, h);
    }
  }
  const f: Frame = { w, h, unit: Math.min(w, h) / BASE_SHORT, sceneMs: scene.durationMs, counts: scene.template === 'stat-reveal' };
  for (const layer of activeLayers(scene, localMs)) {
    const t = localMs - layer.startMs;
    // A staggered layer plays its in phase per word or line; Ken Burns replaces the whole-layer slow zoom.
    const skip = layer.type === 'text' && layer.stagger && layer.in ? SKIP_IN
      : (layer.type === 'image' || layer.type === 'video') && layer.kenBurns && layer.during?.preset === 'slow-zoom' ? SKIP_DURING : NO_SKIP;
    const pose = layerPose(layer, t, scene.durationMs, skip);
    const a = layer.opacity * pose.alpha * alpha;
    if (a <= 0.001 || pose.scale <= 0.001 || pose.reveal <= 0) continue;
    const b = boxFor(layer, aspect, recipe.aspect, scene.layout);
    drawLayer(ctx, layer, b, pose, a, t, f, cache);
  }
}

interface Frame { w: number; h: number; unit: number; sceneMs: number; counts: boolean }

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
  if (pose.glow > 0.01) {
    ctx.shadowColor = glowColour(layer);
    ctx.shadowBlur = pose.glow * 28 * f.unit;
  }
  const blur = pose.blur * f.unit;
  if (blur > 0.5) drawBlurred(ctx, (c) => drawContent(c, layer, bw, bh, pose, alpha, t, f, cache), bw, bh, blur, cache);
  else drawContent(ctx, layer, bw, bh, pose, alpha, t, f, cache);
  ctx.restore();
}

const glowColour = (l: Layer) => (l.type === 'text' || l.type === 'chart' ? l.colour : l.type === 'shape' ? l.fill : '#ffffff');

function drawContent(ctx: Ctx, layer: Layer, bw: number, bh: number, pose: Pose, alpha: number, t: number, f: Frame, cache: MediaCache) {
  if (layer.type === 'text') drawText(ctx, layer, bw, bh, pose, alpha, t, f, cache);
  else if (layer.type === 'shape') drawShape(ctx, layer, bw, bh, f.unit);
  else if (layer.type === 'chart') drawChart(ctx, layer, bw, bh, t, f.unit, cache);
  else drawMedia(ctx, layer, bw, bh, t, f, cache);
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

type Face = Pick<TextLayer, 'font' | 'weight'> & { letterSpacing?: number };

const measurer = (ctx: Ctx, l: Face): Measure => (s, px) => {
  ctx.font = fontFor(l, px);
  if (l.letterSpacing) ctx.letterSpacing = spacing(l.letterSpacing, px);
  return ctx.measureText(s).width;
};

const spacing = (em: number, px: number) => `${(em * px).toFixed(2)}px`;

function fitIn(ctx: Ctx, cache: MediaCache, l: Face, text: string, width: number, height: number, maxSize: number, lineHeight: number): Fit {
  const w = Math.round(width);
  const h = Math.round(height);
  const key = `${l.font}|${cache.fontReady(l.font) ? 1 : 0}|${l.weight}|${l.letterSpacing ?? 0}|${Math.round(maxSize)}|${w}|${h}|${lineHeight}|${text}`;
  return cache.fit(key, () => fitText({ text, width: w, height: h, maxSize, lineHeight, measure: measurer(ctx, l) }));
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/;

/** The text with its first number counted up to fraction p of its value, keeping its decimals and thousands commas. */
export function countUp(text: string, p: number): string {
  const m = NUMBER.exec(text);
  if (!m || p >= 1) return text;
  const raw = m[0];
  const value = Number(raw.replace(/,/g, ''));
  const decimals = raw.includes('.') ? raw.length - raw.indexOf('.') - 1 : 0;
  let digits = (value * Math.max(0, p)).toFixed(decimals);
  if (raw.includes(',')) digits = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return text.slice(0, m.index) + digits + text.slice(m.index + raw.length);
}

/** Ink that reads on a highlight block: near-black on light accents, white on dark ones. */
export function inkOn(colour: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1]!, 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.6 ? '#0A0A0A' : '#FFFFFF';
}

function drawText(ctx: Ctx, l: TextLayer, bw: number, bh: number, pose: Pose, alpha: number, t: number, f: Frame, cache: MediaCache) {
  const unit = f.unit;
  const typed = pose.typed;
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
  if (l.letterSpacing) ctx.letterSpacing = spacing(l.letterSpacing, fit.sizePx);
  ctx.fillStyle = l.colour;
  ctx.textAlign = l.align;
  ctx.textBaseline = 'middle';
  if (l.shadow && pose.glow <= 0.01) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 24 * unit;
    ctx.shadowOffsetY = 6 * unit;
  }
  const x = l.align === 'left' ? -bw / 2 + pad : l.align === 'right' ? bw / 2 - pad : 0;
  if (typed >= 1 && (l.highlight || (l.stagger && l.in))) {
    drawWords(ctx, l, fit, x, step, alpha, t, f, cache);
    return;
  }
  // Stat reveal: the number counts up from 0 over the layer's in motion.
  const count = f.counts && l.slot === 'number' && l.in ? Math.min(1, ease(l.in.feel, t / Math.max(1, inLength(l, f.sceneMs)))) : 1;
  let left = typed >= 1 ? Infinity : Math.floor(typed * fit.lines.reduce((n, s) => n + s.length, 0));
  let y = -(fit.lines.length * step) / 2 + step / 2;
  for (const line of fit.lines) {
    if (left <= 0) break;
    const shown = left >= line.length ? line : line.slice(0, left);
    ctx.fillText(count < 1 ? countUp(shown, count) : shown, x, y);
    left -= line.length;
    y += step;
  }
}

interface Word { text: string; x: number; y: number; w: number; index: number; line: number }

// Word positions only change with the fit, so they are measured once and reused every frame.
function layoutWords(ctx: Ctx, cache: MediaCache, l: TextLayer, fit: Fit, x: number, step: number): Word[] {
  const key = `words|${l.font}|${l.weight}|${l.letterSpacing ?? 0}|${l.align}|${fit.sizePx}|${x.toFixed(1)}|${step.toFixed(1)}|${fit.lines.join('\n')}`;
  return cache.paint(key, () => {
    const words: Word[] = [];
    let index = 0;
    let y = -(fit.lines.length * step) / 2 + step / 2;
    fit.lines.forEach((line, li) => {
      const lineW = ctx.measureText(line).width;
      const x0 = l.align === 'left' ? x : l.align === 'right' ? x - lineW : -lineW / 2;
      const re = /\S+/g;
      for (let m = re.exec(line); m; m = re.exec(line)) {
        words.push({ text: m[0], x: x0 + ctx.measureText(line.slice(0, m.index)).width, y, w: ctx.measureText(m[0]).width, index: index++, line: li });
      }
      y += step;
    });
    return words;
  });
}

function drawWords(ctx: Ctx, l: TextLayer, fit: Fit, x: number, step: number, alpha: number, t: number, f: Frame, cache: MediaCache) {
  const words = layoutWords(ctx, cache, l, fit, x, step);
  const short = Math.min(f.w, f.h);
  const size = fit.sizePx;
  const gap = l.stagger === 'word' ? WORD_STAGGER_MS : LINE_STAGGER_MS;
  const inMs = l.in ? inLength(l, f.sceneMs) : 0;
  ctx.textAlign = 'left';
  for (const wd of words) {
    const unitIndex = !l.stagger || !l.in ? 0 : l.stagger === 'word' ? wd.index : wd.line;
    const wt = t - unitIndex * (l.stagger && l.in ? gap : 0);
    const moving = !!(l.stagger && l.in) && wt < inMs;
    const p = moving ? inPose(l, wt, f.sceneMs) : REST;
    if (p.alpha <= 0.001 || p.scale <= 0.001 || p.reveal <= 0) continue;
    if (moving) {
      const cx = wd.x + wd.w / 2;
      ctx.save();
      ctx.globalAlpha = alpha * p.alpha;
      ctx.translate(cx + p.dx * short, wd.y + p.dy * short);
      if (p.scale !== 1) ctx.scale(p.scale, p.scale);
      ctx.translate(-cx, -wd.y);
      if (p.reveal < 1) {
        ctx.beginPath();
        ctx.rect(wd.x - size, wd.y - size, size + wd.w * p.reveal, size * 2);
        ctx.clip();
      }
    }
    let ink = l.colour;
    if (l.highlight && l.highlight.word === wd.index) {
      // The accent block wipes in behind the word once the word has landed.
      const hp = ease('smooth', (wt - inMs) / HIGHLIGHT_WIPE_MS);
      if (hp > 0) {
        ctx.fillStyle = l.highlight.colour;
        ctx.beginPath();
        ctx.roundRect(wd.x - 0.12 * size, wd.y - 0.6 * size, (wd.w + 0.24 * size) * hp, 1.2 * size, 0.14 * size);
        ctx.fill();
        if (hp > 0.5) ink = inkOn(l.highlight.colour);
      }
    }
    ctx.fillStyle = ink;
    ctx.fillText(wd.text, wd.x, wd.y);
    if (moving) ctx.restore();
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

/** Ken Burns zoom for a media layer `t` ms in, from 1 at its start to 1.14 at its end. */
export const kenBurnsScale = (t: number, length: number) => 1 + (KEN_BURNS_SCALE - 1) * clamp01(t / Math.max(1, length));

// An eight-lobe soft blob, as radius factors around the box; fixed so every frame agrees.
const BLOB = [1, 0.9, 0.98, 0.86, 0.97, 0.9, 1, 0.88];

function maskPath(ctx: Ctx, l: MediaLayer, bw: number, bh: number, unit: number) {
  ctx.beginPath();
  if (l.mask === 'circle') {
    const r = Math.min(bw, bh) / 2;
    ctx.ellipse(0, 0, r, r, 0, 0, Math.PI * 2);
  } else if (l.mask === 'blob') {
    const pt = (i: number) => {
      const a = (i / BLOB.length) * Math.PI * 2 - Math.PI / 2;
      const k = BLOB[i % BLOB.length]!;
      return [Math.cos(a) * (bw / 2) * k, Math.sin(a) * (bh / 2) * k] as const;
    };
    // Curves through the midpoints between lobes keep the outline smooth all the way round.
    const mid = (i: number) => { const a = pt(i); const b = pt(i + 1); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const; };
    const start = mid(BLOB.length - 1);
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < BLOB.length; i++) { const c = pt(i); const m = mid(i); ctx.quadraticCurveTo(c[0], c[1], m[0], m[1]); }
    ctx.closePath();
  } else if (l.mask === 'rounded' || l.radius) {
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, Math.min((l.radius ?? 28) * unit, bw / 2, bh / 2));
  } else ctx.rect(-bw / 2, -bh / 2, bw, bh);
}

function drawMedia(ctx: Ctx, l: MediaLayer, bw: number, bh: number, t: number, f: Frame, cache: MediaCache) {
  const src = l.type === 'image' ? cache.image(l.assetId) : cache.videoFrame(l.assetId, t);
  if (!src) return;
  const { w: sw, h: sh } = sourceSize(src);
  if (!sw || !sh) return;
  const shaped = !!(l.mask || l.radius);
  const zoom = l.kenBurns ? kenBurnsScale(t, Math.min(l.endMs, f.sceneMs) - l.startMs) : 1;
  if (shaped || zoom !== 1) {
    ctx.save();
    if (shaped) { maskPath(ctx, l, bw, bh, f.unit); ctx.clip(); }
    else { ctx.beginPath(); ctx.rect(-bw / 2, -bh / 2, bw, bh); ctx.clip(); }
    if (zoom !== 1) ctx.scale(zoom, zoom);
  }
  if (l.fit === 'cover') {
    const k = Math.max(bw / sw, bh / sh);
    const cw = bw / k;
    const ch = bh / k;
    ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, -bw / 2, -bh / 2, bw, bh);
  } else {
    const k = Math.min(bw / sw, bh / sh);
    ctx.drawImage(src, -(sw * k) / 2, -(sh * k) / 2, sw * k, sh * k);
  }
  if (shaped || zoom !== 1) ctx.restore();
  if (l.border) {
    maskPath(ctx, l, bw, bh, f.unit);
    ctx.strokeStyle = l.border;
    ctx.lineWidth = 6 * f.unit;
    ctx.stroke();
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
      const step = lf.sizePx * 1.2;
      let y = bh / 2 - (bh - numberH) / 2 - ((lf.lines.length - 1) * step) / 2;
      for (const line of lf.lines) { ctx.fillText(line, 0, y); y += step; }
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
