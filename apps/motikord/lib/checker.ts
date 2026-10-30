import type { Aspect, Box, Issue, Layer, LicenceId, PatchOp, Recipe, Scene, TextLayer } from './types';
import { ASPECTS } from './recipe/validate';
import { getPreset } from './render/presets';
import { boxFor, canvasSize, clampToSafe, insideSafe, isFullBleed } from './render/reflow';
import { fitText, type Measure } from './render/textFit';

const ATTRIBUTION: readonly LicenceId[] = ['cc-by', 'cc-by-sa', 'cc-by-nc'];
const MIN_MOTION_MS = 200;
const LIGHT = '#FFFFFF';
const DARK = '#111114';

/** A rough average glyph width, for when no canvas is at hand (AI gating in the background). */
export const estimateMeasure: Measure = (text, sizePx) => text.length * sizePx * 0.56;

export interface CheckOptions { measure?: Measure }

const id = (kind: Issue['kind'], sceneId: string, layerId: string, aspect: Aspect) => `${kind}/${sceneId}/${layerId}/${aspect}`;
const layerPath = (si: number, li: number) => `/scenes/${si}/layers/${li}`;

/** Every problem in the recipe on every size, each with a patch that fixes it. Pure. */
export function check(recipe: Recipe, opts: CheckOptions = {}): Issue[] {
  const measure = opts.measure ?? estimateMeasure;
  const issues: Issue[] = [];
  recipe.scenes.forEach((scene, si) => {
    scene.layers.forEach((layer, li) => {
      const at = { recipe, scene, layer, si, li };
      if (layer.type === 'text') overflow(at, measure, issues);
      for (const aspect of ASPECTS) safeArea(at, aspect, issues);
      if (layer.type === 'text') contrast(at, issues);
      tooFast(at, issues);
      credit(at, issues);
    });
  });
  const music = recipe.music && recipe.assets[recipe.music.assetId];
  if (music?.credit && ATTRIBUTION.includes(music.credit.licence) && !recipe.creditsEndCard) {
    issues.push({ id: id('credit-missing', '', 'music', recipe.aspect), sceneId: '', layerId: 'music', aspect: recipe.aspect, kind: 'credit-missing', fix: [creditsOn()] });
  }
  return issues;
}

interface At { recipe: Recipe; scene: Scene; layer: Layer; si: number; li: number }

function overflow({ recipe, scene, layer, si, li }: At, measure: Measure, out: Issue[]) {
  const l = layer as TextLayer;
  const pad = l.background ? 32 : 0;
  const fits = ASPECTS.map((aspect) => {
    const b = boxFor(l, aspect, recipe.aspect, scene.layout);
    const { w, h } = canvasSize(aspect, 1080);
    return { aspect, fit: fitText({ text: l.text, width: b.w * w - pad, height: b.h * h - pad, maxSize: l.sizePx, lineHeight: l.lineHeight, measure }) };
  });
  const bad = fits.filter(({ fit }) => !fit.fits || fit.sizePx < Math.floor(l.sizePx));
  if (!bad.length) return;
  // One size for every aspect: the smallest fit, so no fix undoes another.
  const sizePx = Math.min(...fits.map(({ fit }) => fit.sizePx));
  for (const { aspect } of bad) {
    out.push({
      id: id('overflow', scene.id, l.id, aspect), sceneId: scene.id, layerId: l.id, aspect, kind: 'overflow',
      fix: [{ op: 'replace', path: `${layerPath(si, li)}/sizePx`, value: sizePx }],
    });
  }
}

// Text and charts must stay readable; a logo must never sit under a player's buttons.
function needsSafe(recipe: Recipe, layer: Layer): boolean {
  if (layer.type === 'text' || layer.type === 'chart') return true;
  return layer.type === 'image' && recipe.assets[layer.assetId]?.kind === 'logo';
}

function safeArea({ recipe, scene, layer, si, li }: At, aspect: Aspect, out: Issue[]) {
  if (!needsSafe(recipe, layer)) return;
  const b = boxFor(layer, aspect, recipe.aspect, scene.layout);
  if (isFullBleed(b) || insideSafe(b, aspect)) return;
  out.push({ id: id('safe-area', scene.id, layer.id, aspect), sceneId: scene.id, layerId: layer.id, aspect, kind: 'safe-area', fix: [boxFix(recipe, layer, si, li, aspect, clampToSafe(b, aspect))] });
}

function boxFix(recipe: Recipe, layer: Layer, si: number, li: number, aspect: Aspect, box: Box): PatchOp {
  const base = layerPath(si, li);
  if (layer.boxes?.[aspect]) return { op: 'replace', path: `${base}/boxes/${aspect}`, value: box };
  if (aspect === recipe.aspect) return { op: 'replace', path: `${base}/box`, value: box };
  if (layer.boxes) return { op: 'add', path: `${base}/boxes/${aspect}`, value: box };
  return { op: 'add', path: `${base}/boxes`, value: { [aspect]: box } };
}

type Rgba = [number, number, number, number];

function parseRgba(hex: string): Rgba | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex);
  if (!m) return undefined;
  let s = m[1]!;
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  const n = [0, 2, 4, 6].map((i) => (s.length > i ? parseInt(s.slice(i, i + 2), 16) : 255));
  return [n[0]!, n[1]!, n[2]!, n[3]! / 255];
}

export function parseHex(hex: string): [number, number, number] | undefined {
  const c = parseRgba(hex);
  return c && [c[0], c[1], c[2]];
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const ratioOf = (x: [number, number, number], y: [number, number, number]) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** WCAG contrast ratio of two hex colours, or undefined when either is not a solid colour. */
export function contrastRatio(a: string, b: string): number | undefined {
  const x = parseHex(a);
  const y = parseHex(b);
  return x && y ? ratioOf(x, y) : undefined;
}

type Rgb = [number, number, number];
const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** `fill` at `alpha` over `base`; undefined when it is see-through and nothing solid is below. */
function over(fill: string, alpha: number, base: Rgb | undefined): Rgb | undefined {
  const c = parseRgba(fill);
  if (!c) return undefined;
  const a = c[3] * alpha;
  if (a >= 1) return [c[0], c[1], c[2]];
  if (!base) return undefined;
  return [0, 1, 2].map((i) => c[i]! * a + base[i]! * (1 - a)) as Rgb;
}

const contains = (o: Box, i: Box) => o.x <= i.x && o.y <= i.y && o.x + o.w >= i.x + i.w && o.y + o.h >= i.y + i.h;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The solid colour behind layer li (below its own fill), or undefined when a picture or nothing solid is behind it. */
function under(recipe: Recipe, scene: Scene, li: number): Rgb | undefined {
  const l = scene.layers[li]!;
  const box = boxFor(l, recipe.aspect, recipe.aspect, scene.layout);
  for (let k = li - 1; k >= 0; k--) {
    const below = scene.layers[k]!;
    const bb = boxFor(below, recipe.aspect, recipe.aspect, scene.layout);
    if (below.startMs >= l.endMs || below.endMs <= l.startMs || !overlaps(bb, box)) continue;
    if (below.type === 'shape' && below.shape === 'rect' && contains(bb, box)) return over(below.fill, below.opacity, under(recipe, scene, k));
    // A picture, chart or partly covering shape: the checker cannot tell the colour behind.
    return undefined;
  }
  return scene.background === 'transparent' ? undefined : over(scene.background, 1, undefined);
}

function contrast({ recipe, scene, layer, si, li }: At, out: Issue[]) {
  const l = layer as TextLayer;
  const base = under(recipe, scene, li);
  const bgRgb = l.background ? over(l.background, 1, base) : base;
  if (!bgRgb) return;
  const bg = toHex(bgRgb);
  const ink = over(l.colour, l.opacity, bgRgb);
  if (!ink) return;
  const ratio = ratioOf(ink, bgRgb);
  const large = l.role === 'title' || l.sizePx >= 48;
  if (ratio >= (large ? 3 : 4.5)) return;
  const colour = (contrastRatio(LIGHT, bg) ?? 0) >= (contrastRatio(DARK, bg) ?? 0) ? LIGHT : DARK;
  out.push({
    id: id('contrast', scene.id, l.id, recipe.aspect), sceneId: scene.id, layerId: l.id, aspect: recipe.aspect, kind: 'contrast',
    fix: [{ op: 'replace', path: `${layerPath(si, li)}/colour`, value: colour }],
  });
}

/** Time to read text once: a short base plus a quarter second a word. */
export const readMs = (text: string) => Math.max(1000, 400 + text.split(/\s+/).filter(Boolean).length * 250);

/** The scene length that holds every too-short text layer, never less than it has, so no fix cuts a layer. */
function sceneNeed(scene: Scene): number {
  let need = scene.durationMs;
  for (const l of scene.layers) if (l.type === 'text') need = Math.max(need, l.endMs - l.startMs < readMs(l.text) ? l.startMs + readMs(l.text) : 0);
  return need;
}

function tooFast({ recipe, scene, layer, si, li }: At, out: Issue[]) {
  const base = layerPath(si, li);
  const fix: PatchOp[] = [];
  for (const slot of ['in', 'during', 'out'] as const) {
    const m = layer[slot];
    if (m && m.durationMs < MIN_MOTION_MS) fix.push({ op: 'replace', path: `${base}/${slot}/durationMs`, value: Math.max(MIN_MOTION_MS, getPreset(m.preset)?.defaultMs ?? MIN_MOTION_MS) });
  }
  if (layer.type === 'text') {
    const read = readMs(layer.text);
    if (layer.endMs - layer.startMs < read) {
      const end = layer.startMs + read;
      const need = sceneNeed(scene);
      if (need > scene.durationMs) fix.push({ op: 'replace', path: `/scenes/${si}/durationMs`, value: need });
      fix.push({ op: 'replace', path: `${base}/endMs`, value: end });
    }
  }
  if (fix.length) out.push({ id: id('too-fast', scene.id, layer.id, recipe.aspect), sceneId: scene.id, layerId: layer.id, aspect: recipe.aspect, kind: 'too-fast', fix });
}

const creditsOn = (): PatchOp => ({ op: 'add', path: '/creditsEndCard', value: true });

function credit({ recipe, scene, layer }: At, out: Issue[]) {
  if ((layer.type !== 'image' && layer.type !== 'video') || recipe.creditsEndCard) return;
  const c = recipe.assets[layer.assetId]?.credit;
  if (!c || !ATTRIBUTION.includes(c.licence)) return;
  out.push({ id: id('credit-missing', scene.id, layer.id, recipe.aspect), sceneId: scene.id, layerId: layer.id, aspect: recipe.aspect, kind: 'credit-missing', fix: [creditsOn()] });
}
