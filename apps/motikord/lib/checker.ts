import type { Aspect, Background, Box, BrandKit, Issue, Layer, LicenceId, PatchOp, Recipe, Scene, SlotDef, SlotValue, TemplateId, TextLayer } from './types';
import { applyPatch } from './patch';
import { cutWords, expandScene } from './templates/expand';
import { getPack, getSceneTemplate, insideSafeArea, isBackgroundBox, SAFE_AREA, STYLE_PACKS } from './templates/scenes';
import { ASPECTS } from './recipe/validate';
import { getPreset } from './render/presets';
import { boxFor, canvasSize, clampToSafe, insideSafe, isFullBleed, safeBox } from './render/reflow';
import { fitText, type Measure } from './render/textFit';
import { polyHitsBox, type Poly } from './templates/blocks';

const ATTRIBUTION: readonly LicenceId[] = ['cc-by', 'cc-by-sa', 'cc-by-nc'];
const MIN_MOTION_MS = 200;
/** The smallest text size that reads on a phone, at 1080 px wide. */
export const MIN_TEXT_PX = 28;
const LIGHT = '#FFFFFF';
const DARK = '#111114';

/** A rough average glyph width, for when no canvas is at hand (AI gating in the background). */
export const estimateMeasure: Measure = (text, sizePx) => text.length * sizePx * 0.56;

export interface CheckOptions { measure?: Measure; brand?: BrandKit }

const id = (kind: Issue['kind'], sceneId: string, layerId: string, aspect: Aspect) => `${kind}/${sceneId}/${layerId}/${aspect}`;
const layerPath = (si: number, li: number) => `/scenes/${si}/layers/${li}`;

/** Every problem in the recipe on every size, each with a patch that fixes it. Pure. */
export function check(recipe: Recipe, opts: CheckOptions = {}): Issue[] {
  const measure = opts.measure ?? estimateMeasure;
  const issues: Issue[] = [];
  recipe.scenes.forEach((scene, si) => {
    scene.layers.forEach((layer, li) => {
      const at = { recipe, scene, layer, si, li };
      if (layer.type === 'text') { overflow(at, measure, issues); tooSmall(at, measure, issues); }
      for (const aspect of ASPECTS) safeArea(at, aspect, issues);
      if (layer.type === 'text') contrast(at, opts, issues);
      tooFast(at, issues);
      credit(at, issues);
    });
  });
  // v1 clips keep v1's checks; the layout checks judge v2 clips, whose boxes come from templates.
  recipe.scenes.forEach((scene, si) => { if (recipe.version === 2 || scene.template) layout(recipe, scene, si, opts, issues); });
  repeats(recipe, opts, issues);
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

/** Text drawn under MIN_TEXT_PX on 9:16 is raised to it, but only when it then still fits every size's box. */
function tooSmall({ recipe, scene, layer, si, li }: At, measure: Measure, out: Issue[]) {
  const l = layer as TextLayer;
  const fitAt = (aspect: Aspect, maxSize: number) => {
    const b = boxFor(l, aspect, recipe.aspect, scene.layout);
    const { w, h } = canvasSize(aspect, 1080);
    const pad = l.background ? 32 : 0;
    return fitText({ text: l.text, width: b.w * w - pad, height: b.h * h - pad, maxSize, lineHeight: l.lineHeight, measure });
  };
  if (l.sizePx >= MIN_TEXT_PX && fitAt('9:16', l.sizePx).sizePx >= MIN_TEXT_PX) return;
  if (!ASPECTS.every((aspect) => fitAt(aspect, MIN_TEXT_PX).sizePx >= MIN_TEXT_PX)) return;
  out.push({
    id: id('too-small', scene.id, l.id, '9:16'), sceneId: scene.id, layerId: l.id, aspect: '9:16', kind: 'too-small',
    fix: [{ op: 'replace', path: `${layerPath(si, li)}/sizePx`, value: MIN_TEXT_PX }],
  });
}

// Text and charts must stay readable; a logo must never sit under a player's buttons.
function needsSafe(recipe: Recipe, layer: Layer): boolean {
  if (layer.type === 'text' || layer.type === 'chart') return true;
  return layer.type === 'image' && recipe.assets[layer.assetId]?.kind === 'logo';
}

function safeArea({ recipe, scene, layer, si, li }: At, aspect: Aspect, out: Issue[]) {
  if (!needsSafe(recipe, layer)) return;
  const b = boxFor(layer, aspect, recipe.aspect, scene.layout);
  // A templated scene keeps to the template safe area; a full-frame background may run under it.
  const t = !!scene.template;
  if (isFullBleed(b) || (t && isBackgroundBox(b)) || (t ? insideSafeArea(b, aspect) : insideSafe(b, aspect))) return;
  out.push({ id: id('safe-area', scene.id, layer.id, aspect), sceneId: scene.id, layerId: layer.id, aspect, kind: 'safe-area', fix: [boxFix(recipe, layer, si, li, aspect, t ? clampInto(b, SAFE_AREA[aspect]) : clampToSafe(b, aspect))] });
}

/** Shrinks (keeping shape) and then shifts a box until it sits inside `s`. */
function clampInto(b: Box, s: Box): Box {
  const k = Math.min(1, s.w / Math.max(b.w, 1e-3), s.h / Math.max(b.h, 1e-3));
  const w = b.w * k;
  const h = b.h * k;
  const x = Math.min(Math.max(b.x + b.w / 2 - w / 2, s.x), s.x + s.w - w);
  const y = Math.min(Math.max(b.y + b.h / 2 - h / 2, s.y), s.y + s.h - h);
  return { ...b, x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
}
const round4 = (v: number) => Math.round(v * 10000) / 10000;

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

/** What is behind a layer on one size: the solid colours it may sit on, or a picture; undefined when the checker cannot tell. */
interface Behind { colours: Rgb[]; picture: boolean }

/** What is behind layer li (below its own fill) on `aspect`: layers first, then the scene background where the box sits. */
function behind(recipe: Recipe, scene: Scene, li: number, aspect: Aspect): Behind | undefined {
  const l = scene.layers[li]!;
  const box = boxFor(l, aspect, recipe.aspect, scene.layout);
  for (let k = li - 1; k >= 0; k--) {
    const below = scene.layers[k]!;
    const bb = boxFor(below, aspect, recipe.aspect, scene.layout);
    if (below.startMs >= l.endMs || below.endMs <= l.startMs || !overlaps(bb, box)) continue;
    if (below.type === 'image' || below.type === 'video') return { colours: [], picture: true };
    if (below.type === 'shape' && below.shape === 'rect' && contains(bb, box)) {
      const base = behind(recipe, scene, k, aspect);
      if (base?.picture) return below.opacity >= 1 && (parseRgba(below.fill)?.[3] ?? 0) >= 1 ? { colours: [over(below.fill, 1, undefined)!], picture: false } : base;
      const cs = (base?.colours.length ? base.colours : [undefined]).map((c) => over(below.fill, below.opacity, c)).filter((c): c is Rgb => !!c);
      return cs.length ? { colours: cs, picture: false } : undefined;
    }
    // A chart or a partly covering shape: the checker cannot tell the colour behind.
    return undefined;
  }
  const colours = scene.bg ? backgroundUnder(scene.bg, box, aspect) : scene.background === 'transparent' ? [] : [over(scene.background, 1, undefined)];
  const solid = colours.filter((c): c is Rgb => !!c);
  return solid.length ? { colours: solid, picture: false } : undefined;
}

// Blob spots and the slabs of a blocks background drawn before shapes were planned (lib/render/background).
const BLOB_SPOTS = [{ x: 0.18, y: 0.2, r: 0.55 }, { x: 0.86, y: 0.42, r: 0.5 }, { x: 0.32, y: 0.88, r: 0.6 }, { x: 0.9, y: 0.95, r: 0.45 }];
const OLD_BLOCKS: Poly[] = [[[0, 0.7], [1, 0.6], [1, 1], [0, 1]], [[0.62, 0], [1, 0], [1, 0.18]]];

/** Every colour of a scene background that shows inside `box` on `aspect`. */
function backgroundUnder(bg: Background, box: Box, aspect: Aspect): (Rgb | undefined)[] {
  const cs = bg.colours.length ? bg.colours : ['#000000'];
  const first = over(cs[0]!, 1, undefined);
  if (bg.kind === 'gradient' || bg.kind === 'grain') return cs.map((c) => over(c, 1, undefined));
  if (bg.kind === 'blobs') {
    const { w, h } = canvasSize(aspect, 1080);
    const long = Math.max(w, h);
    const near = cs.slice(1).filter((_, i) => {
      const s = BLOB_SPOTS[i % BLOB_SPOTS.length]!;
      const cx = Math.max(box.x, Math.min(s.x, box.x + box.w)) * w - s.x * w;
      const cy = Math.max(box.y, Math.min(s.y, box.y + box.h)) * h - s.y * h;
      return Math.hypot(cx, cy) < s.r * long * 0.6;   // past 60% of the radius a blob has faded out
    });
    return [first, ...near.map((c) => over(c, 0.85, first))];
  }
  if (bg.kind === 'blocks') {
    const shapes: Poly[] = bg.shapes ? [bg.shapes[aspect] ?? []] : OLD_BLOCKS;
    const hit = shapes.map((p, i) => (cs[i + 1] && polyHitsBox(p, box) ? over(cs[i + 1]!, 1, undefined) : undefined)).filter(Boolean);
    return [first, ...hit];
  }
  return [first];
}

const worst = (ink: Rgb, colours: Rgb[]) => Math.min(...colours.map((c) => ratioOf(ink, c)));

function contrast({ recipe, scene, layer, si, li }: At, opts: CheckOptions, out: Issue[]) {
  const l = layer as TextLayer;
  const path = layerPath(si, li);
  // The clip's own size first, so one issue names the size the user is looking at.
  for (const aspect of [recipe.aspect, ...ASPECTS.filter((a) => a !== recipe.aspect)]) {
    const under = behind(recipe, scene, li, aspect);
    if (!under) continue;
    const push = (fix: PatchOp[], note: string) => out.push({ id: id('contrast', scene.id, l.id, aspect), sceneId: scene.id, layerId: l.id, aspect, kind: 'contrast', fix, note });
    const n = si + 1;
    const name = (l.name || 'Text').toLowerCase();
    if (under.picture && !l.background) {
      if (l.shadow) continue;   // white text with a shadow on a photo is the template's treatment; the visual critic judges the photo
      push([{ op: 'add', path: `${path}/shadow`, value: true }], `Scene ${n} ${name} sits on a picture with nothing behind it`);
      return;
    }
    const colours = l.background ? [over(l.background, 1, under.colours[0])!].filter(Boolean) : under.colours;
    if (!colours.length) continue;
    const ink = over(l.colour, l.opacity, colours[0]);
    if (!ink) continue;
    const large = l.role === 'title' || l.sizePx >= 48;
    const need = large ? 3 : 4.5;
    if (worst(ink, colours) >= need) continue;
    // Split across two backgrounds that no one colour reads on: lay the template out again, else give it a plate.
    const pick = [LIGHT, DARK].map((c) => ({ c, r: worst(parseHex(c)!, colours) })).sort((a, b) => b.r - a.r)[0]!;
    if (colours.length > 1 && pick.r < need) {
      // One relayout fixes every layer of the scene, so the scene gets one issue for it.
      if (out.some((i) => i.kind === 'contrast' && i.sceneId === scene.id && i.fix[0]?.path === `/scenes/${si}/bg`)) return;
      const again = scene.template ? reexpand(recipe, scene, opts) : undefined;
      const relaid = again?.bg && JSON.stringify(again.bg) !== JSON.stringify(scene.bg);
      push(relaid ? [{ op: 'replace', path: `/scenes/${si}/bg`, value: again!.bg }, ...ASPECTS.flatMap((a) => templateBoxes(recipe, scene, si, a, opts))] : [{ op: 'add', path: `${path}/background`, value: toHex(colours[0]!) }],
        `Scene ${n} ${name} runs onto a block it can't be read on`);
    } else {
      push([{ op: 'replace', path: `${path}/colour`, value: pick.c }], `Scene ${n} ${name} is hard to read on its background`);
    }
    return;
  }
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

// ---- v2 layout checks: overlap, crowding, empty, align, words, template-repeat ----

const OVERLAP = 0.04;
const CROWD_BLOCKS = 3;
const CROWD_AREA = 0.45;
const BIG_PX = 300;
const EMPTY_AREA = 0.12;
const EMPTY_MS = 1000;
const ALIGN_NEAR = 0.02;
const ALIGN_SAME = 0.0005;
const REPEAT_RUN = 3;
const AUTO_KINDS: readonly Issue['kind'][] = ['words', 'align', 'empty', 'template-repeat'];

interface Vis { layer: Layer; li: number; box: Box; logo: boolean }
const area = (b: Box) => b.w * b.h;
const together = (a: Layer, b: Layer) => a.startMs < b.endMs && b.startMs < a.endMs;
const safeOf = (scene: Scene, aspect: Aspect) => (scene.template ? SAFE_AREA[aspect] : safeBox(aspect));
const sceneNo = (recipe: Recipe, sceneId: string) => recipe.scenes.findIndex((s) => s.id === sceneId) + 1;

/** Visible text, logo and picture layers with their box on `aspect`; a full-frame background is left out unless asked for. */
function visibles(recipe: Recipe, scene: Scene, aspect: Aspect, withBackground = false): Vis[] {
  const out: Vis[] = [];
  scene.layers.forEach((layer, li) => {
    if (layer.opacity <= 0) return;
    const isText = layer.type === 'text' && layer.text.trim() !== '';
    const isPic = layer.type === 'image' || layer.type === 'video';
    if (!isText && !isPic) return;
    const box = boxFor(layer, aspect, recipe.aspect, scene.layout);
    if (!withBackground && (isFullBleed(box) || isBackgroundBox(box))) return;
    out.push({ layer, li, box, logo: layer.type === 'image' && recipe.assets[layer.assetId]?.kind === 'logo' });
  });
  return out;
}

const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const alignOf = (v: Vis) => (v.layer.type === 'text' ? v.layer.align : 'left');
const label = (v: Vis) => (v.logo ? 'Logo' : v.layer.name);

function packOf(recipe: Recipe, opts: CheckOptions) {
  return getPack(recipe.style ?? 'clean') ?? STYLE_PACKS[0];
}

/** The scene's layers drawn again from its template; undefined for a scene without one. */
function reexpand(recipe: Recipe, scene: Scene, opts: CheckOptions): Scene | undefined {
  const pack = packOf(recipe, opts);
  return scene.template && pack ? expandScene(scene, pack, opts.brand) : undefined;
}

/** Puts each layer's box on `aspect` back to the template's, for layers that still carry a template id. */
function templateBoxes(recipe: Recipe, scene: Scene, si: number, aspect: Aspect, opts: CheckOptions): PatchOp[] {
  const fresh = reexpand(recipe, scene, opts);
  if (!fresh) return [];
  const ops: PatchOp[] = [];
  scene.layers.forEach((layer, li) => {
    const want = fresh.layers.find((l) => l.id === layer.id)?.boxes?.[aspect];
    const have = boxFor(layer, aspect, recipe.aspect, scene.layout);
    if (want && JSON.stringify(want) !== JSON.stringify(have)) ops.push(boxFix(recipe, layer, si, li, aspect, want));
  });
  return ops;
}

/** A corner of the safe area where the logo meets nothing else, or undefined. */
function logoCorner(recipe: Recipe, scene: Scene, si: number, logo: Vis, others: Vis[], aspect: Aspect): PatchOp | undefined {
  const s = safeOf(scene, aspect);
  const { w, h } = logo.box;
  const spots = [[s.x + s.w - w, s.y], [s.x, s.y], [s.x + s.w - w, s.y + s.h - h], [s.x, s.y + s.h - h]];
  for (const [x, y] of spots) {
    const b = { ...logo.box, x: round4(x!), y: round4(y!) };
    if (others.every((o) => overlapArea(b, o.box) <= OVERLAP * Math.min(area(b), area(o.box)))) return boxFix(recipe, logo.layer, si, logo.li, aspect, b);
  }
  return undefined;
}

function layout(recipe: Recipe, scene: Scene, si: number, opts: CheckOptions, out: Issue[]) {
  const measure = opts.measure ?? estimateMeasure;
  const n = si + 1;
  for (const aspect of ASPECTS) {
    const vis = visibles(recipe, scene, aspect);
    // overlap
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i]!;
      const b = vis[j]!;
      if (!together(a.layer, b.layer)) continue;
      if (overlapArea(a.box, b.box) <= OVERLAP * Math.min(area(a.box), area(b.box))) continue;
      const logo = a.logo ? a : b.logo ? b : undefined;
      const other = logo === a ? b : a;
      const corner = logo && logoCorner(recipe, scene, si, logo, vis.filter((v) => v !== logo), aspect);
      const fix = corner ? [corner] : templateBoxes(recipe, scene, si, aspect, opts);
      const lead = logo ?? b;
      out.push({
        id: id('overlap', scene.id, `${a.layer.id}+${b.layer.id}`, aspect), sceneId: scene.id, layerId: lead.layer.id, aspect, kind: 'overlap', fix,
        note: corner ? `Scene ${n} logo moved off the ${label(other).toLowerCase()}` : logo ? `Logo overlaps ${label(other).toLowerCase()} in scene ${n}` : `${label(a)} overlaps ${label(b).toLowerCase()} in scene ${n}`,
      });
    }
    // align: left edges or centres within 2% of each other, but not equal
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i]!;
      const b = vis[j]!;
      if (!together(a.layer, b.layer)) continue;
      // Left edges matter for left-set layers, centres for centred ones; boxes of other kinds are not compared.
      const mode = alignOf(a);
      if (mode !== alignOf(b) || mode === 'right') continue;
      const left = b.box.x - a.box.x;
      const mid = b.box.x + b.box.w / 2 - (a.box.x + a.box.w / 2);
      const useLeft = mode === 'left' && Math.abs(left) > ALIGN_SAME && Math.abs(left) <= ALIGN_NEAR;
      const useMid = mode === 'center' && Math.abs(mid) > ALIGN_SAME && Math.abs(mid) <= ALIGN_NEAR;
      if (!useLeft && !useMid) continue;
      const x = round4(useLeft ? a.box.x : a.box.x + a.box.w / 2 - b.box.w / 2);
      const to = { ...b.box, x };
      const ok = x >= 0 && x + b.box.w <= 1;
      out.push({
        id: id('align', scene.id, `${a.layer.id}+${b.layer.id}`, aspect), sceneId: scene.id, layerId: b.layer.id, aspect, kind: 'align',
        fix: ok ? [boxFix(recipe, b.layer, si, b.li, aspect, to)] : [],
        note: `Scene ${n} ${label(b).toLowerCase()} lined up with the ${label(a).toLowerCase()}`,
      });
    }
    // empty: visible content under 12% of the frame for over a second
    const all = visibles(recipe, scene, aspect, true);
    const content = [...all.map((v) => v), ...scene.layers.flatMap((l, li) => (l.type === 'chart' && l.opacity > 0 ? [{ layer: l, li, box: boxFor(l, aspect, recipe.aspect, scene.layout), logo: false }] : []))];
    if (emptyMs(content, scene.durationMs) > EMPTY_MS) {
      out.push({
        id: id('empty', scene.id, '', aspect), sceneId: scene.id, layerId: '', aspect, kind: 'empty',
        fix: templateBoxes(recipe, scene, si, aspect, opts), note: `Scene ${n} now uses the ${aspect} layout`,
      });
    }
    // crowding: more than 3 text blocks at once, or text over 45% of the safe area
    const text = vis.filter((v) => v.layer.type === 'text');
    const blocks = peakBlocks(text);
    // A big numeral (stat reveal) is one mark, so its box is not counted as text.
    const textArea = Math.max(0, ...text.filter((v) => (v.layer as TextLayer).sizePx < BIG_PX).map((v) => text.filter((o) => (o.layer as TextLayer).sizePx < BIG_PX && together(o.layer, v.layer)).reduce((sum, o) => sum + inkArea(o, aspect, measure), 0)));
    const countHit = blocks > CROWD_BLOCKS && aspect === recipe.aspect;
    // A template's word limits already cap its text, so only free layers get the area rule (and a lone statement may fill the frame).
    if (countHit || (!scene.template && blocks > 1 && textArea > CROWD_AREA * area(safeOf(scene, aspect)))) {
      const last = text[text.length - 1]!;
      out.push({
        id: id('crowding', scene.id, '', aspect), sceneId: scene.id, layerId: last.layer.id, aspect, kind: 'crowding',
        fix: [{ op: 'remove', path: layerPath(si, last.li) }], note: `Scene ${n} is crowded`,
      });
    }
  }
  words(recipe, scene, si, opts, out);
}

/** The share of the frame the words cover once fitted to their box: the lines drawn at the size that fits. */
function inkArea(v: Vis, aspect: Aspect, measure: Measure): number {
  const l = v.layer as TextLayer;
  const { w, h } = canvasSize(aspect, 1080);
  const pad = l.background ? 32 : 0;
  const fit = fitText({ text: l.text, width: v.box.w * w - pad, height: v.box.h * h - pad, maxSize: l.sizePx, lineHeight: l.lineHeight, measure });
  const widest = Math.max(0, ...fit.lines.map((line) => measure(line, fit.sizePx)));
  return Math.min(area(v.box), (widest * fit.lines.length * fit.sizePx * l.lineHeight) / (w * h));
}

/** Most text blocks on screen at once; layers of one slot (list items) count as one block. */
function peakBlocks(text: Vis[]): number {
  let peak = 0;
  for (const v of text) {
    const keys = new Set(text.filter((o) => together(o.layer, v.layer)).map((o) => o.layer.id.replace(/^(.*:slot:[^:]+).*$/, '$1')));
    peak = Math.max(peak, keys.size);
  }
  return peak;
}

/** Milliseconds in the scene where the visible boxes cover under 12% of the frame. */
function emptyMs(content: Vis[], durationMs: number): number {
  const marks = [0, durationMs, ...content.flatMap((v) => [v.layer.startMs, v.layer.endMs])]
    .map((t) => Math.min(Math.max(t, 0), durationMs)).sort((p, q) => p - q);
  let ms = 0;
  for (let k = 0; k + 1 < marks.length; k++) {
    const [from, to] = [marks[k]!, marks[k + 1]!];
    if (to <= from) continue;
    const covered = content.filter((v) => v.layer.startMs <= from && v.layer.endMs >= to).reduce((sum, v) => sum + area(v.box), 0);
    if (covered < EMPTY_AREA) ms += to - from;
  }
  return ms;
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const overLimit = (def: SlotDef, v: SlotValue | undefined): boolean => {
  if (def.words === undefined) return false;
  if (typeof v === 'string') return wordCount(v) > def.words;
  if (!Array.isArray(v)) return false;
  return (v as unknown[]).some((x) => wordCount(typeof x === 'string' ? x : String((x as { label?: string }).label ?? '')) > def.words!);
};

function words(recipe: Recipe, scene: Scene, si: number, opts: CheckOptions, out: Issue[]) {
  const t = scene.template ? getSceneTemplate(scene.template) : undefined;
  const bad = t?.slots.filter((d) => d.kind !== 'media' && d.kind !== 'logo' && overLimit(d, scene.slots?.[d.id]));
  if (!t || !bad?.length) return;
  const fresh = reexpand(recipe, scene, opts);
  out.push({
    id: id('words', scene.id, bad[0]!.id, recipe.aspect), sceneId: scene.id, layerId: bad[0]!.id, aspect: recipe.aspect, kind: 'words',
    fix: fresh ? [{ op: 'replace', path: `/scenes/${si}`, value: fresh }] : [],
    note: `Scene ${si + 1} ${bad[0]!.name.toLowerCase()} cut to ${bad[0]!.words} words`,
  });
}

// "Nearest" templates for a repeated one, best first.
const NEAR: Record<TemplateId, TemplateId[]> = {
  'title-hook': ['big-statement', 'hero', 'end-card'],
  'big-statement': ['title-hook', 'quote', 'hero', 'end-card'],
  'stat-reveal': ['big-statement', 'chart', 'title-hook'],
  chart: ['stat-reveal', 'list', 'steps'],
  quote: ['big-statement', 'split', 'title-hook'],
  list: ['steps', 'split', 'chart', 'big-statement'],
  hero: ['split', 'title-hook', 'before-after'],
  split: ['hero', 'list', 'quote'],
  'before-after': ['split', 'hero'],
  steps: ['list', 'split'],
  'logo-sting': ['end-card', 'hero'],
  'end-card': ['logo-sting', 'title-hook', 'big-statement'],
};
const isAssetValue = (v: SlotValue | undefined): v is { assetId: string } => !!v && typeof v === 'object' && !Array.isArray(v) && 'assetId' in v;

/** The scene's words, pictures and items poured into another template's slots, or undefined when they do not fit whole. */
function pour(scene: Scene, from: TemplateId, to: TemplateId): Record<string, SlotValue> | undefined {
  const src = getSceneTemplate(from);
  const dst = getSceneTemplate(to);
  if (!src || !dst) return undefined;
  const texts: string[] = [];
  const lists: string[][] = [];
  const pics: { assetId: string }[] = [];
  let chart: SlotValue | undefined;
  for (const d of src.slots) {
    const v = scene.slots?.[d.id];
    if (v === undefined || d.id === 'highlight') continue;
    if (typeof v === 'string') { if (v.trim()) texts.push(v.trim()); }
    else if (isAssetValue(v)) pics.push(v);
    else if (Array.isArray(v) && d.kind === 'chart') chart = v;
    else if (Array.isArray(v)) lists.push((v as string[]).map(String));
  }
  const need = dst.slots.filter((d) => d.kind === 'text' && !d.optional && d.id !== 'highlight').length;
  // One short text may split at its first break to fill a second slot.
  if (texts.length < need && texts.length) {
    const m = /^(.+?[.!?:;,–—])\s+(\S.*)$/.exec(texts[0]!);
    if (m) texts.splice(0, 1, m[1]!.replace(/[.,;:–—]+$/, ''), m[2]!);
  }
  const out: Record<string, SlotValue> = {};
  for (const d of dst.slots) {
    if (d.id === 'highlight') continue;
    if (d.kind === 'text') {
      const t = texts.shift();
      if (t === undefined) { if (d.optional) continue; return undefined; }
      out[d.id] = t;
    } else if (d.kind === 'items') {
      const l = lists.shift();
      if (!l || !d.items || l.length < d.items[0] || l.length > d.items[1]) return undefined;
      out[d.id] = l;
    } else if (d.kind === 'chart') {
      if (!chart || !Array.isArray(chart) || (d.items && ((chart as unknown[]).length < d.items[0] || (chart as unknown[]).length > d.items[1]))) return undefined;
      out[d.id] = chart; chart = undefined;
    } else {
      const p = pics.shift();
      if (!p) { if (d.optional) continue; return undefined; }
      out[d.id] = p;
    }
  }
  if (texts.length || lists.length || pics.length || chart) return undefined;
  for (const d of dst.slots) if (d.kind === 'text' && overLimit(d, out[d.id])) return undefined;
  return out;
}

const REASON: Partial<Record<`${TemplateId}>${TemplateId}`, string>> = {
  'list>steps': 'Its items read as steps.',
  'steps>list': 'Its steps read as a list.',
};

function repeats(recipe: Recipe, opts: CheckOptions, out: Issue[]) {
  const pack = packOf(recipe, opts);
  for (let i = REPEAT_RUN - 1; i < recipe.scenes.length; i++) {
    const run = recipe.scenes.slice(i - REPEAT_RUN + 1, i + 1);
    const tpl = run[0]!.template;
    if (!tpl || run.some((s) => s.template !== tpl)) continue;
    // Only the scene that makes the run reach 3 is reported, not every scene after it.
    if (i > REPEAT_RUN - 1 && recipe.scenes[i - REPEAT_RUN]!.template === tpl) continue;
    const scene = recipe.scenes[i]!;
    const names = getSceneTemplate(tpl)?.name ?? tpl;
    let fix: PatchOp[] = [];
    let note = `Scene ${i + 1} uses ${names} again`;
    for (const cand of NEAR[tpl] ?? []) {
      const next = recipe.scenes.slice(i + 1, i + 3);
      if (next.length === 2 && next.every((s) => s.template === cand)) continue;
      const slots = pour(scene, tpl, cand);
      if (!slots || !pack) continue;
      const swapped = expandScene({ ...scene, template: cand, slots, original: undefined, layers: [] }, pack, opts.brand);
      fix = [{ op: 'replace', path: `/scenes/${i}`, value: swapped }];
      note = `Scene ${i + 1} swapped from ${names} to ${getSceneTemplate(cand)?.name ?? cand}\n${REASON[`${tpl}>${cand}`] ?? `Same template ${REPEAT_RUN} times in a row.`}`;
      break;
    }
    out.push({ id: id('template-repeat', scene.id, '', recipe.aspect), sceneId: scene.id, layerId: '', aspect: recipe.aspect, kind: 'template-repeat', fix, note });
  }
}

/**
 * Applies the safe fixes (words, align, empty, template-repeat) one at a time and returns the new recipe with each fix
 * as an issue marked `auto`, its `note` the "Fixed for you" line. A fix that does not clear its issue is undone.
 */
export function autoFix(recipe: Recipe, opts: CheckOptions = {}): { recipe: Recipe; fixed: Issue[] } {
  let cur = recipe;
  const fixed: Issue[] = [];
  const tried = new Set<string>();
  for (let n = 0; n < 50; n++) {
    const next = check(cur, opts).find((i) => AUTO_KINDS.includes(i.kind) && i.fix.length > 0 && !tried.has(i.id));
    if (!next) break;
    tried.add(next.id);
    const after = applyPatch(cur, next.fix).doc;
    if (check(after, opts).some((i) => i.id === next.id)) continue;
    cur = after;
    fixed.push({ ...next, auto: true });
  }
  return { recipe: cur, fixed };
}
