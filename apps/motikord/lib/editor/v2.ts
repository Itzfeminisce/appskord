import { restyle } from '../ai/writeRecipe';
import { cutWords, expandScene } from '../templates/expand';
import { paceMs } from '../templates/pick';
import { autoStyle, getPack, getSceneTemplate, SCENE_TEMPLATES, STYLE_PACKS } from '../templates/scenes';
import type {
  BrandKit, Layer, Pace, PatchOp, Recipe, Scene, SceneTemplate, SlotDef, SlotValue, StyleId, StylePack, TemplateId, TextLayer,
  Transition, TransitionKind,
} from '../types';
import type { Edit } from './store';

// v2 scene edits (EditorScene, SlotEditing, SwapTemplate, SceneRemaking, NewLook, TransitionPicker). Each is one Edit.

const put = (path: string, has: boolean, value: unknown): PatchOp => (has ? { op: 'replace', path, value } : { op: 'add', path, value });

/** The clip's pack: its style, else the one Auto picks for its type. */
export function packOf(r: Recipe): StylePack {
  return getPack(r.style ?? autoStyle(r.type)) ?? STYLE_PACKS[0]!;
}
export const templateOf = (scene: Scene | undefined): SceneTemplate | undefined => (scene?.template ? getSceneTemplate(scene.template) : undefined);
/** A v1 clip: any scene drawn with free layers ("Made before styles"). */
export const isV1Clip = (r: Recipe) => r.version === 1 || r.scenes.some((s) => !s.template);

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
/** "2 of 6 words" for a text slot; items count their longest item. */
export function slotCount(def: SlotDef, v: SlotValue | undefined): { n: number; limit?: number; over: boolean } {
  const n = typeof v === 'string' ? countWords(v) : Array.isArray(v) ? Math.max(0, ...(v as unknown[]).map((x) => countWords(typeof x === 'string' ? x : String((x as { label?: string }).label ?? '')))) : 0;
  return { n, limit: def.words, over: def.words !== undefined && n > def.words };
}
/** Where the words past the limit start in the text, for underlining them while typing; undefined within it. */
export function overflowAt(text: string, limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  const re = /\S+/g;
  for (let i = 0, m = re.exec(text); m; i++, m = re.exec(text)) if (i === limit) return m.index;
  return undefined;
}
export const countLabel = (n: number, limit: number) => `${n} of ${limit} words`;

const sceneNo = (si: number) => `Scene ${si + 1}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const withoutKey = <T extends object>(o: T | undefined, key: string): T | undefined => {
  if (!o || !(key in o)) return o;
  const { [key]: _gone, ...rest } = o as Record<string, unknown>;
  return (Object.keys(rest).length ? rest : undefined) as T | undefined;
};

export interface SlotEdit { edit: Edit; shortened: boolean }

/**
 * Sets one slot and re-expands the scene. Text over the slot's limit is shortened (the full words kept in `original`),
 * so callers only commit over-limit text on blur or "Shorten now"; typing within the limit merges into one Change.
 */
export function setSlot(r: Recipe, si: number, slotId: string, value: SlotValue, brand?: BrandKit): SlotEdit | undefined {
  const scene = r.scenes[si];
  const t = templateOf(scene);
  const def = t?.slots.find((d) => d.id === slotId);
  if (!scene || !t || !def) return undefined;
  const next = expandScene({ ...scene, slots: { ...scene.slots, [slotId]: value }, original: withoutKey(scene.original, slotId) }, packOf(r), brand);
  if (JSON.stringify(next) === JSON.stringify(scene)) return undefined;
  const shortened = next.original?.[slotId] !== undefined;
  const summary = shortened ? `${sceneNo(si)} ${lower(def.name)} shortened to fit` : `${sceneNo(si)} ${lower(def.name)}`;
  return { edit: { ops: [{ op: 'replace', path: `/scenes/${si}`, value: next }], summary, mergeKey: shortened ? undefined : `${scene.id}/slot/${slotId}` }, shortened };
}

/** The words a slot had before it was shortened ("Show original"). */
export function originalOf(scene: Scene | undefined, slotId: string): SlotValue | undefined {
  return scene?.original?.[slotId];
}
export const slotText = (v: SlotValue | undefined): string =>
  typeof v === 'string' ? v : Array.isArray(v) ? (v as unknown[]).map((x) => (typeof x === 'string' ? x : String((x as { label?: string }).label ?? ''))).join('\n') : '';

// ---- Swap template ----

const isAsset = (v: SlotValue | undefined): v is { assetId: string } => !!v && typeof v === 'object' && !Array.isArray(v) && 'assetId' in v;

interface Words { texts: string[]; lists: string[][]; pics: { assetId: string }[]; chart?: SlotValue }
function wordsOf(scene: Scene, src: SceneTemplate): Words {
  const w: Words = { texts: [], lists: [], pics: [] };
  for (const d of src.slots) {
    const v = scene.original?.[d.id] ?? scene.slots?.[d.id];
    if (v === undefined || d.id === 'highlight') continue;
    if (typeof v === 'string') { if (v.trim()) w.texts.push(v.trim()); }
    else if (isAsset(v)) w.pics.push(v);
    else if (Array.isArray(v) && d.kind === 'chart') w.chart = v;
    else if (Array.isArray(v)) w.lists.push((v as unknown[]).map(String));
  }
  return w;
}

/**
 * The scene's words poured into another template's slots. Leftover text joins the last text slot. `strict` returns
 * undefined unless every word fits whole; otherwise lists are trimmed and long text is left for expandScene to shorten.
 */
export function pourSlots(scene: Scene, to: TemplateId, strict: boolean): Record<string, SlotValue> | undefined {
  // A free-layer scene is read as its nearest template first, so its words still move.
  const near = scene.template ? undefined : nearestTemplate(scene);
  const from = near ? { ...scene, ...near } : scene;
  const src = templateOf(from);
  const dst = getSceneTemplate(to);
  if (!src || !dst) return undefined;
  const { texts, lists, pics } = wordsOf(from, src);
  let { chart } = wordsOf(from, src);
  const textDefs = dst.slots.filter((d) => d.kind === 'text' && d.id !== 'highlight');
  // One text may split at its first break to fill a second slot.
  if (texts.length < textDefs.filter((d) => !d.optional).length && texts.length) {
    const m = /^(.+?[.!?:;,–—])\s+(\S.*)$/.exec(texts[0]!);
    if (m) texts.splice(0, 1, m[1]!.replace(/[.,;:–—]+$/, ''), m[2]!);
  }
  if (!strict && !dst.slots.some((d) => d.kind === 'items')) for (const l of lists.splice(0)) texts.push(l.join(', '));
  if (!strict && !dst.slots.some((d) => d.kind === 'chart') && chart) { texts.push((chart as { label: string }[]).map((b) => b.label).join(', ')); chart = undefined; }
  const out: Record<string, SlotValue> = {};
  for (const d of dst.slots) {
    if (d.id === 'highlight') continue;
    if (d.kind === 'text') {
      const t = texts.shift();
      if (t === undefined) { if (d.optional || !strict) continue; return undefined; }
      out[d.id] = t;
    } else if (d.kind === 'items') {
      let l = lists.shift();
      if (!l && !strict && texts.length) l = texts.splice(0);
      if (!l) { if (strict) return undefined; continue; }
      if (d.items && (l.length < d.items[0] || l.length > d.items[1])) { if (strict) return undefined; l = l.slice(0, d.items[1]); }
      out[d.id] = l;
    } else if (d.kind === 'chart') {
      const n = Array.isArray(chart) ? (chart as unknown[]).length : 0;
      if (!chart || (d.items && (n < d.items[0] || n > d.items[1]))) { if (strict) return undefined; continue; }
      out[d.id] = chart; chart = undefined;
    } else {
      const p = pics.shift();
      if (!p) { if (d.optional || !strict) continue; return undefined; }
      out[d.id] = p;
    }
  }
  if (strict && (lists.length || pics.length || chart)) return undefined;
  // Leftover text joins the last filled text slot; strict still fits when the joined text is within its limit.
  if (texts.length) {
    const last = [...textDefs].reverse().find((d) => typeof out[d.id] === 'string');
    if (!last) return strict ? undefined : out;
    out[last.id] = [out[last.id] as string, ...texts].reduce((a, b) => (/[.!?:;,–—]$/.test(a) || /^\p{Ll}/u.test(b) ? `${a} ${b}` : `${a}. ${b}`));
  }
  if (strict) for (const d of textDefs) if (slotCount(d, out[d.id]).over) return undefined;
  return out;
}

/** SwapTemplate's groups: "Fits these words" (current first) and "Other templates". */
export function swapGroups(scene: Scene): { fits: TemplateId[]; others: TemplateId[] } {
  const cur = scene.template;
  const fits: TemplateId[] = cur ? [cur] : [];
  const others: TemplateId[] = [];
  for (const t of SCENE_TEMPLATES) {
    if (t.id === cur) continue;
    (pourSlots(scene, t.id, true) ? fits : others).push(t.id);
  }
  return { fits, others };
}
/** swap-no-fit: no template other than the current one takes these words whole. */
export const noOtherFit = (scene: Scene) => swapGroups(scene).fits.length <= 1;

/** The scene in another template with the same words; text that does not fit is shortened. */
export function swappedScene(r: Recipe, si: number, to: TemplateId, brand?: BrandKit): { scene: Scene; shortened: boolean } | undefined {
  const scene = r.scenes[si];
  if (!scene || scene.template === to) return undefined;
  const slots = pourSlots(scene, to, true) ?? pourSlots(scene, to, false);
  if (!slots) return undefined;
  const next = expandScene({ ...scene, template: to, slots, original: undefined, layers: [] }, packOf(r), brand);
  return { scene: next, shortened: !!next.original };
}

export function swapTemplate(r: Recipe, si: number, to: TemplateId, brand?: BrandKit): SlotEdit | undefined {
  const out = swappedScene(r, si, to, brand);
  if (!out) return undefined;
  const from = templateOf(r.scenes[si])?.name ?? 'Free layers';
  const summary = `${sceneNo(si)} template: ${from} → ${getSceneTemplate(to)?.name ?? to}`;
  return { edit: { ops: [{ op: 'replace', path: `/scenes/${si}`, value: out.scene }], summary }, shortened: out.shortened };
}

/** A copy of the clip with one scene replaced, for the stage preview ("not applied yet"). */
export function withScene(r: Recipe, si: number, scene: Scene): Recipe {
  const scenes = r.scenes.slice();
  scenes[si] = scene;
  return { ...r, scenes };
}

// ---- Remake ----

/** "Scene 3 remade": the remade scene from `after` (regenerateScene's recipe) put into the clip as it is now. */
export function remakeEdit(now: Recipe, sceneId: string, after: Recipe): Edit | undefined {
  const si = now.scenes.findIndex((s) => s.id === sceneId);
  const next = after.scenes.find((s) => s.id === sceneId);
  if (si < 0 || !next) return undefined;
  return { ops: [{ op: 'replace', path: `/scenes/${si}`, value: next }], summary: `${sceneNo(si)} remade` };
}

// ---- New look ----

/** Recipe-level fields restyle writes, plus every scene, as one Change. */
function lookOps(r: Recipe, next: Recipe): PatchOp[] {
  const ops: PatchOp[] = [{ op: 'replace', path: '/scenes', value: next.scenes }];
  ops.push(put('/style', r.style !== undefined, next.style));
  ops.push(put('/pace', r.pace !== undefined, next.pace));
  if (r.version !== next.version) ops.push({ op: 'replace', path: '/version', value: next.version });
  return ops;
}

/** The clip in another look, for previews and newLook. */
export const looked = (r: Recipe, style: StyleId, pace: Pace, brand?: BrandKit): Recipe => restyle(toTemplates(r), style, pace, brand);

/** "New look: Playful": same words in another pack and pace. A v1 clip's free-layer scenes become templates first. */
export function newLook(r: Recipe, style: StyleId, pace: Pace, brand?: BrandKit): Edit {
  const next = looked(r, style, pace, brand);
  return { ops: lookOps(r, next), summary: `New look: ${getPack(style)?.name ?? style}` };
}

/** NewLook's "Stays: 7 scenes, your words, photos, music, 21 s" for this clip. */
export function staysLine(r: Recipe, totalMs: number): string {
  const parts = [`${r.scenes.length} ${r.scenes.length === 1 ? 'scene' : 'scenes'}`, 'your words'];
  if (r.scenes.some((s) => s.layers.some(isMedia))) parts.push('photos');
  if (r.music) parts.push('music');
  return `Stays: ${[...parts, `${Math.round(totalMs / 1000)} s`].join(', ')}`;
}
export const CHANGES_LINE = 'Changes: colours, fonts, backgrounds, motion, transitions';
/** A pack card's line: "Smooth · cross-fade, slide". */
export const packLine = (p: StylePack) => `${p.feel.charAt(0).toUpperCase()}${p.feel.slice(1)} · ${p.transitions.map((k) => TRANSITION_NAMES[k].toLowerCase()).join(', ')}`;

const texts = (scene: Scene) => scene.layers.filter((l): l is TextLayer => l.type === 'text' && !!l.text.trim())
  .sort((a, b) => (a.role === 'title' ? -1 : 0) - (b.role === 'title' ? -1 : 0) || b.sizePx - a.sizePx || a.box.y - b.box.y);
const isMedia = (l: Layer) => l.type === 'image' || l.type === 'video';
const isNumber = (s: string) => /^[\s$€£+-]*[\d.,]+\s*[%kKmM+x×]?\s*$/.test(s);
const isQuote = (s: string) => /^[“"‘']/.test(s.trim());

/** The nearest template for a v1 free-layer scene, read from its text, chart and media layers. */
export function nearestTemplate(scene: Scene): { template: TemplateId; slots: Record<string, SlotValue> } | undefined {
  const ts = texts(scene).map((l) => l.text.replace(/\s*\n\s*/g, ' ').trim());
  const pics = scene.layers.filter(isMedia) as unknown as { assetId: string }[];
  const media = pics[0];
  const chart = scene.layers.find((l) => l.type === 'chart');
  // Shapes alone have nothing a template could hold, so the scene stays as free layers.
  if (!ts.length && !media && !chart) return undefined;
  const [first = '', second, ...rest] = ts;
  if (chart && chart.type === 'chart' && chart.chart !== 'number') {
    return { template: 'chart', slots: { title: first, bars: chart.values.slice(0, 6), ...(second ? { note: second } : {}) } };
  }
  if (isNumber(first) && second) return { template: 'stat-reveal', slots: { number: first.trim(), label: second, ...(rest[0] ? { source: rest[0] } : {}) } };
  if (isQuote(first)) return { template: 'quote', slots: { quote: first.replace(/^[“"‘']|[”"’']$/g, ''), name: second ?? '' } };
  if (pics.length >= 2 && second) return { template: 'before-after', slots: { beforeMedia: { assetId: pics[0]!.assetId }, afterMedia: { assetId: pics[1]!.assetId }, before: first, after: [second, ...rest].join(' ') } };
  if (media) return { template: 'hero', slots: { media: { assetId: media.assetId }, headline: first, ...(second ? { line: [second, ...rest].join(' ') } : {}) } };
  if (rest.length >= 2) return { template: 'list', slots: { title: first, items: [second!, ...rest].slice(0, 5) } };
  if (second) return { template: 'title-hook', slots: { headline: first, kicker: cutWords(second, 4) } };
  return { template: 'big-statement', slots: { statement: first } };
}

/** "Give it a new look": every free-layer scene mapped to its nearest template (words kept; restyle expands them). */
export function toTemplates(r: Recipe): Recipe {
  if (!r.scenes.some((s) => !s.template)) return r;
  return { ...r, scenes: r.scenes.map((s) => (s.template ? s : { ...s, ...(nearestTemplate(s) ?? {}) })) };
}

// ---- Transitions ----

export const TRANSITION_NAMES: Record<TransitionKind, string> = {
  cut: 'Cut', crossfade: 'Cross-fade', slide: 'Slide', push: 'Push', wipe: 'Wipe', zoom: 'Zoom', match: 'Match cut',
};
export const ALL_TRANSITIONS: readonly TransitionKind[] = ['push', 'wipe', 'zoom', 'crossfade', 'slide', 'match', 'cut'];
/** The pack's set first ("Made for this look"), then the rest ("Work with any look"). */
export function transitionGroups(pack: StylePack): { pack: TransitionKind[]; other: TransitionKind[] } {
  return { pack: [...pack.transitions], other: ALL_TRANSITIONS.filter((k) => !pack.transitions.includes(k)) };
}
export const transitionOf = (r: Recipe, si: number): Transition =>
  r.scenes[si]?.transition ?? { kind: 'cut', ms: 0 };
/** "Push · 0.3 s". */
export const transitionLabel = (t: Transition) => `${TRANSITION_NAMES[t.kind]} · ${(t.ms / 1000).toFixed(1)} s`;
export const TRANSITION_MIN_MS = 200;
export const TRANSITION_MAX_MS = 1000;
const clampMs = (kind: TransitionKind, ms: number) => (kind === 'cut' ? 0 : Math.max(TRANSITION_MIN_MS, Math.min(TRANSITION_MAX_MS, Math.round(ms / 50) * 50)));
/** A new kind starts at the pace's length unless one was already set. */
export const defaultMs = (r: Recipe, si: number) => r.scenes[si]?.transition?.ms || paceMs(r.pace ?? 'normal').transitionMs;

/** Sets the transition into scene `si`, or into every scene after the first ("Use for every cut in this clip"). */
export function setTransition(r: Recipe, si: number, t: Transition, everyCut = false): Edit | undefined {
  const value: Transition = { kind: t.kind, ms: clampMs(t.kind, t.ms) };
  const targets = everyCut ? r.scenes.map((_, i) => i).filter((i) => i > 0) : [si];
  const ops = targets.filter((i) => r.scenes[i] && JSON.stringify(r.scenes[i]!.transition) !== JSON.stringify(value))
    .map((i) => put(`/scenes/${i}/transition`, r.scenes[i]!.transition !== undefined, value));
  if (!ops.length || si < 1) return undefined;
  const summary = everyCut ? `Every cut: ${transitionLabel(value)}` : `Transition into scene ${si + 1}: ${transitionLabel(value)}`;
  return { ops, summary, mergeKey: everyCut ? 'transition/all' : `${r.scenes[si]!.id}/transition` };
}

// ---- Slot editing on the stage ----

export interface LayerSlot { def: SlotDef; item?: number }
/** The text slot (and item) a stage layer draws; a quote mark, step number or tick is not one. */
export function slotOfLayer(scene: Scene | undefined, layerId: string): LayerSlot | undefined {
  const t = templateOf(scene);
  if (!scene || !t) return undefined;
  const m = new RegExp(`^${scene.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:slot:([^:]+)(?::(\\d+))?$`).exec(layerId);
  const def = m && t.slots.find((d) => d.id === m[1]);
  if (!def || (def.kind !== 'text' && def.kind !== 'items')) return undefined;
  return def.kind === 'items' ? (m![2] === undefined ? undefined : { def, item: Number(m![2]) }) : { def };
}
/** The text the layer's slot holds in full (its original when it was shortened). */
export function layerSlotText(scene: Scene, ls: LayerSlot): string {
  const v = scene.original?.[ls.def.id] ?? scene.slots?.[ls.def.id];
  if (ls.item === undefined) return typeof v === 'string' ? v : '';
  return Array.isArray(v) ? String((v as unknown[])[ls.item] ?? '') : '';
}
/** The slot value with this layer's text put in. */
export function slotWith(scene: Scene, ls: LayerSlot, text: string): SlotValue {
  if (ls.item === undefined) return text;
  const v = scene.slots?.[ls.def.id];
  const list = Array.isArray(v) ? (v as unknown[]).map(String) : [];
  list[ls.item] = text;
  return list;
}
