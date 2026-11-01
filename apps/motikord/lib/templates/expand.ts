import type {
  Aspect, Background, BrandKit, ChartLayer, Layer, MediaLayer, Motion, Scene, SceneTemplate, ShapeLayer, SlotDef,
  SlotValue, StyleId, StylePack, TextLayer, TypeScale,
} from '../types';
import { getPreset } from '../render/presets';
import { getSceneTemplate, isBackgroundBox } from './scenes';

const ASPECTS: readonly Aspect[] = ['9:16', '1:1', '16:9'];
type Boxes = Record<Aspect, { x: number; y: number; w: number; h: number }>;

// Type scale in px at a 1080 short side (SceneTemplates, Clean at 9:16), and each pack's weight and tracking (em).
const SCALE_PX: Record<TypeScale, number> = { display: 140, headline: 88, body: 54, caption: 40, number: 380 };
const LINE_HEIGHT: Record<TypeScale, number> = { display: 1, headline: 1.08, body: 1.3, caption: 1.3, number: 0.9 };
type Face = Record<TypeScale, { weight: number; tracking: number }>;
const FACE: Record<StyleId, Face> = {
  clean: { display: { weight: 700, tracking: -0.035 }, headline: { weight: 700, tracking: -0.03 }, body: { weight: 400, tracking: 0 }, caption: { weight: 600, tracking: 0.02 }, number: { weight: 700, tracking: -0.05 } },
  bold: { display: { weight: 400, tracking: -0.01 }, headline: { weight: 400, tracking: -0.01 }, body: { weight: 400, tracking: 0 }, caption: { weight: 600, tracking: 0.02 }, number: { weight: 700, tracking: -0.04 } },
  playful: { display: { weight: 600, tracking: -0.01 }, headline: { weight: 600, tracking: -0.01 }, body: { weight: 400, tracking: 0 }, caption: { weight: 600, tracking: 0.02 }, number: { weight: 700, tracking: -0.04 } },
  corporate: { display: { weight: 600, tracking: -0.015 }, headline: { weight: 600, tracking: -0.015 }, body: { weight: 400, tracking: 0 }, caption: { weight: 500, tracking: 0.02 }, number: { weight: 700, tracking: -0.04 } },
};
const ROLE: Record<TypeScale, TextLayer['role']> = { display: 'title', headline: 'title', number: 'title', body: 'body', caption: 'label' };
const HEADING: readonly TypeScale[] = ['display', 'headline'];

/** Pixel width over height of each size, for keeping ticks round and marks square. */
const RATIO: Record<Aspect, number> = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9 };
const round = (v: number) => Math.round(v * 10000) / 10000;

/** Cuts text to `limit` words at a word boundary. */
export function cutWords(text: string, limit: number | undefined): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (limit === undefined || words.length <= limit) return text;
  return words.slice(0, limit).join(' ').replace(/[,;:–—-]+$/, '');
}

interface Look {
  pack: StylePack; face: Face; ink: string; muted: string; accent: string; bg: string;
  fonts: StylePack['fonts']; headingWeight?: number; background: Background;
}

/** The pack's look with the brand kit's colours and fonts laid over it (layout, motion and transitions stay the pack's). */
function lookFor(pack: StylePack, brand?: BrandKit): Look {
  const role = (r: BrandKit['colours'][number]['role']) => brand?.colours.find((c) => c.role === r)?.hex;
  const p = pack.palette;
  const bg = role('background') ?? p.bg;
  const ink = role('text') ?? p.ink;
  const accent = role('primary') ?? p.accent;
  const accent2 = role('accent') ?? p.accent2 ?? accent;
  const swap = new Map<string, string>([[p.bg.toUpperCase(), bg], [p.accent.toUpperCase(), accent]]);
  if (p.accent2) swap.set(p.accent2.toUpperCase(), accent2);
  if (role('background')) swap.set(p.bg2.toUpperCase(), bg);
  const colours = pack.background.colours.map((c) => swap.get(c.toUpperCase()) ?? c);
  return {
    pack, face: FACE[pack.id] ?? FACE.clean, ink, accent, bg,
    muted: role('text') || role('background') ? ink : p.muted,
    fonts: { display: brand?.headingFont ?? pack.fonts.display, text: brand?.bodyFont ?? pack.fonts.text, number: pack.fonts.number },
    headingWeight: brand?.headingFont ? 700 : undefined,
    background: { ...pack.background, colours },
  };
}

/** Shortens each slot value to its template's limits; `original` keeps the full value of every slot that was cut. */
function fitSlots(t: SceneTemplate, slots: Record<string, SlotValue>, before: Record<string, SlotValue> = {}) {
  const out: Record<string, SlotValue> = {};
  const original: Record<string, SlotValue> = {};
  for (const def of t.slots) {
    const v = slots[def.id];
    if (v === undefined) continue;
    const prior = before[def.id];
    const full = prior !== undefined && same(cut(def, prior), v) ? prior : v;
    const short = cut(def, full);
    out[def.id] = short;
    if (!same(short, full)) original[def.id] = full;
  }
  return { slots: out, original };
}
const same = (a: SlotValue, b: SlotValue) => JSON.stringify(a) === JSON.stringify(b);
function cut(def: SlotDef, v: SlotValue): SlotValue {
  if (typeof v === 'string') return cutWords(v, def.words);
  if (!Array.isArray(v)) return v;
  const max = def.items?.[1] ?? v.length;
  if (def.kind === 'chart') return (v as { label: string; value: number }[]).slice(0, max).map((b) => ({ ...b, label: cutWords(String(b.label), def.words) }));
  return (v as unknown[]).slice(0, max).map((s) => cutWords(String(s), def.words));
}

const motionOf = (id: string | undefined, look: Look, ms?: number): Motion | undefined =>
  id ? { preset: id, feel: look.pack.feel, durationMs: ms ?? getPreset(id)?.defaultMs ?? look.pack.motionMs } : undefined;

interface Ctx { scene: Scene; look: Look; t: SceneTemplate; overMedia: boolean; durationMs: number; step: number; itemStep: number }

function base(c: Ctx, def: SlotDef, order: number, item: number, suffix = '') {
  const startMs = Math.min(order * c.step + item * c.itemStep, Math.floor(c.durationMs / 2));
  const during = motionOf(def.motion.during, c.look);
  return {
    id: `${c.scene.id}:slot:${def.id}${suffix}`, name: def.name, slot: def.id, startMs, endMs: c.durationMs, opacity: 1,
    in: motionOf(def.motion.in, c.look, c.look.pack.motionMs), ...(during ? { during } : {}),
  };
}
const withBoxes = (boxes: Boxes) => ({ box: { ...boxes['9:16'] }, boxes: structuredClone(boxes) });
const mapBoxes = (boxes: Boxes, f: (b: Boxes[Aspect], a: Aspect) => Boxes[Aspect]): Boxes =>
  Object.fromEntries(ASPECTS.map((a) => [a, roundBox(f(boxes[a], a))])) as Boxes;
// Rounds the edges, not the size, so a box that ends on the safe line still ends there.
const roundBox = (b: Boxes[Aspect]) => ({ x: round(b.x), y: round(b.y), w: round(round(b.x + b.w) - round(b.x)), h: round(round(b.y + b.h) - round(b.y)) });

function text(c: Ctx, def: SlotDef, value: string, order: number, boxes: Boxes, opts: { item?: number; suffix?: string; scale?: TypeScale; sizePx?: number; colour?: string; stagger?: boolean } = {}): TextLayer {
  const scale = opts.scale ?? def.scale ?? 'body';
  const face = c.look.face[scale];
  const font = scale === 'number' ? c.look.fonts.number : HEADING.includes(scale) ? c.look.fonts.display : c.look.fonts.text;
  const colour = opts.colour ?? (c.overMedia ? '#FFFFFF' : def.kind === 'text' && scale === 'caption' ? (def.id === 'kicker' ? c.look.accent : c.look.muted) : c.look.ink);
  return {
    ...base(c, def, order, opts.item ?? 0, opts.suffix), ...withBoxes(boxes), type: 'text', role: ROLE[scale], text: value,
    font, sizePx: opts.sizePx ?? SCALE_PX[scale], weight: HEADING.includes(scale) ? c.look.headingWeight ?? face.weight : face.weight,
    colour, align: def.align ?? 'left', lineHeight: LINE_HEIGHT[scale], letterSpacing: face.tracking,
    ...(opts.stagger !== false && def.motion.stagger ? { stagger: def.motion.stagger } : {}),
    ...(c.overMedia ? { shadow: true } : {}),
  };
}

/** Rows (or, in a wide box, columns) for `n` items. */
function split(boxes: Boxes, n: number): Boxes[] {
  return Array.from({ length: n }, (_, i) => mapBoxes(boxes, (b, a) => {
    if (b.w * RATIO[a] > 2.5 * b.h) {
      const cw = b.w / n;
      return { x: b.x + i * cw, y: b.y, w: cw * 0.9, h: b.h };
    }
    const rh = b.h / n;
    return { x: b.x, y: b.y + i * rh, w: b.w, h: rh * 0.85 };
  }));
}
const wide = (b: Boxes[Aspect], a: Aspect) => b.w * RATIO[a] > 2.5 * b.h;

function items(c: Ctx, def: SlotDef, values: string[], order: number): Layer[] {
  const layers: Layer[] = [];
  const steps = c.t.id === 'steps';
  split(def.boxes, values.length).forEach((row, i) => {
    // A marker beside each item: a tick (List) or the step number (Steps), square on every size.
    const mark = mapBoxes(row, (b, a) => {
      const d = wide(def.boxes[a], a) ? Math.min(b.h * 0.4, (b.w * RATIO[a]) * 0.5) : b.h * (steps ? 0.9 : 0.4);
      return wide(def.boxes[a], a) ? { x: b.x, y: b.y, w: d / RATIO[a], h: d } : { x: b.x, y: b.y + (b.h - d) / 2, w: d / RATIO[a], h: d };
    });
    const body = mapBoxes(row, (b, a) => {
      const m = mark[a];
      if (wide(def.boxes[a], a)) return { x: b.x, y: m.y + m.h + b.h * 0.05, w: b.w, h: b.h - m.h - b.h * 0.05 };
      const gap = m.w * 0.5;
      return { x: m.x + m.w + gap, y: b.y, w: b.w - m.w - gap, h: b.h };
    });
    if (steps) {
      layers.push(text(c, def, String(i + 1), order, mark, { item: i, suffix: `:${i}:number`, scale: 'number', sizePx: SCALE_PX.headline, colour: c.look.accent, stagger: false }));
    } else {
      const tick: ShapeLayer = { ...base(c, def, order, i, `:${i}:tick`), ...withBoxes(mark), type: 'shape', shape: 'circle', fill: c.look.accent };
      layers.push(tick);
    }
    layers.push(text(c, def, values[i]!, order, body, { item: i, suffix: `:${i}` }));
  });
  return layers;
}

function quoteMark(c: Ctx, def: SlotDef, order: number): TextLayer {
  const s = 0.16;
  const boxes = mapBoxes(def.boxes, (b, a) => {
    const w = a === '9:16' ? s : a === '16:9' ? s / RATIO[a] : s;
    const h = a === '9:16' ? s * RATIO[a] : s;
    return a === '16:9' ? { x: b.x - w - 0.02, y: b.y, w, h } : { x: b.x, y: b.y - h - 0.01, w, h };
  });
  const layer = text(c, { ...def, name: 'Quote mark' }, '“', order, boxes, { suffix: ':mark', scale: 'display', sizePx: 220, colour: c.look.accent, stagger: false });
  return { ...layer, in: motionOf('pop-in', c.look, c.look.pack.motionMs) };
}

function media(c: Ctx, def: SlotDef, assetId: string, order: number): MediaLayer {
  const prior = c.scene.layers.find((l) => l.slot === def.id && (l.type === 'image' || l.type === 'video')) as MediaLayer | undefined;
  const type = prior && prior.assetId === assetId ? prior.type : 'image';
  return {
    ...base(c, def, order, 0), ...withBoxes(def.boxes), type, assetId, fit: def.kind === 'logo' ? 'contain' : 'cover',
    ...(type === 'video' ? { muted: true } : {}),
    ...(def.kind === 'media' && !isBackgroundBox(def.boxes['9:16']) ? { mask: 'rounded' as const } : {}),
    ...(def.motion.during === 'slow-zoom' ? { kenBurns: true } : {}),
  };
}

/**
 * Turns a template scene's slots into layers in the pack's look (CONTRACT.md "Rules the code keeps"). Pure.
 * Text over a slot's word limit is cut at a word boundary and kept whole in `original`. Every layer gets boxes for all
 * three sizes and is named for its slot; the scene's layers are replaced, so hand edits last until the next expand.
 * The brand kit, when given, replaces the pack's colours, fonts and logo. A scene without a known template is returned as it is.
 */
export function expandScene(scene: Scene, pack: StylePack, brand?: BrandKit): Scene {
  const t = scene.template ? getSceneTemplate(scene.template) : undefined;
  if (!t) return scene;
  const look = lookFor(pack, brand);
  const { slots, original } = fitSlots(t, scene.slots ?? {}, scene.original);
  const filledMedia = t.slots.some((d) => d.kind === 'media' && isBackgroundBox(d.boxes['9:16']) && isAsset(slots[d.id]));
  const c: Ctx = {
    scene, look, t, overMedia: filledMedia, durationMs: scene.durationMs,
    step: Math.round(pack.motionMs * 0.5), itemStep: Math.round(pack.motionMs * 0.3),
  };
  const layers: Layer[] = [];
  t.slots.forEach((def, order) => {
    const v = slots[def.id];
    if (def.kind === 'logo') {
      const id = brand?.logoAssetId ?? (isAsset(v) ? v.assetId : undefined);
      if (id) layers.push(media(c, def, id, order));
      return;
    }
    if (def.kind === 'media') { if (isAsset(v)) layers.push(media(c, def, v.assetId, order)); return; }
    if (def.kind === 'chart') {
      if (!Array.isArray(v) || !v.length || typeof v[0] !== 'object') return;
      const values = (v as { label: string; value: number }[]).map((b) => ({ label: b.label, value: Number(b.value) || 0 }));
      const chart: ChartLayer = { ...base(c, def, order, 0), ...withBoxes(def.boxes), type: 'chart', chart: 'bar', values, colour: look.accent };
      layers.push(chart);
      return;
    }
    if (def.kind === 'items') {
      const list = Array.isArray(v) ? (v as unknown[]).map(String).filter((s) => s.trim()) : [];
      if (list.length) layers.push(...items(c, def, list, order));
      return;
    }
    // A text slot that only marks a word in another slot ("Highlight") draws nothing itself.
    if (def.id === 'highlight' && t.slots.some((d) => d.highlight)) return;
    if (typeof v !== 'string' || !v.trim()) return;
    if (t.id === 'quote' && def.id === 'quote') layers.push(quoteMark(c, def, order));
    const layer = text(c, def, v, order, def.boxes);
    if (def.highlight) {
      const word = highlightIndex(v, slots.highlight);
      if (word >= 0) layer.highlight = { word, colour: look.accent };
    }
    layers.push(layer);
  });
  const next: Scene = { ...scene, slots, layers, background: look.bg, bg: look.background };
  if (Object.keys(original).length) next.original = original;
  else delete next.original;
  return next;
}

const isAsset = (v: SlotValue | undefined): v is { assetId: string } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { assetId?: unknown }).assetId === 'string';

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function highlightIndex(text: string, word: SlotValue | undefined): number {
  if (typeof word !== 'string' || !norm(word)) return -1;
  return text.trim().split(/\s+/).findIndex((w) => norm(w) === norm(word));
}
