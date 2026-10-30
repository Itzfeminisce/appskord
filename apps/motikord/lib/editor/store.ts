import { contrastRatio } from '../checker';
import { PatchError } from '../patch';
import { MAX_CLIP_MS } from '../recipe/validate';
import { clipDuration, sceneAt } from '../render/drawFrame';
import { boxFor } from '../render/reflow';
import type { Aspect, Author, BrandKit, Box, Change, Clip, Layer, PatchOp, Recipe, Scene, ShapeLayer, TextLayer } from '../types';
import { record, redo, undo, type History } from './history';

// The editor's state and every edit it makes, as pure functions. Edits are PatchOp[] so the AI (T8) and the hand share one history.

export interface EditorState {
  clip: Clip;
  future: Change[];
  mergeKey?: string;
  sceneId: string;
  layerId?: string;
  timeMs: number;
  playing: boolean;
  /** The change the newest action made or took back, for undo-toast. */
  lastChange?: Change;
}

export interface Edit { ops: PatchOp[]; summary: string; mergeKey?: string }

export type Action =
  | { type: 'load'; clip: Clip }
  | { type: 'select'; sceneId: string; layerId?: string; timeMs?: number }
  | { type: 'time'; ms: number }
  | { type: 'play'; playing: boolean }
  | { type: 'edit'; edit: Edit; by?: Author; at: number; id: string; select?: { sceneId: string; layerId?: string } }
  | { type: 'undo'; at: number }
  | { type: 'redo'; at: number };

export function initState(clip: Clip): EditorState {
  const scene = clip.recipe.scenes[0];
  const title = scene?.layers.find((l) => l.type === 'text' && l.role === 'title') ?? scene?.layers[scene.layers.length - 1];
  return { clip, future: [], sceneId: scene?.id ?? '', layerId: title?.id, timeMs: restTime(clip.recipe, 0), playing: false };
}

export function reducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case 'load': return initState(a.clip);
    case 'select': return { ...s, sceneId: a.sceneId, layerId: a.layerId, timeMs: a.timeMs ?? s.timeMs };
    case 'time': {
      // The scene under the playhead becomes the selected one; a layer from another scene is let go.
      const timeMs = Math.max(0, Math.min(a.ms, clipDuration(s.clip.recipe)));
      const at = sceneAt(s.clip.recipe, timeMs);
      if (!at || at.scene.id === s.sceneId) return { ...s, timeMs };
      return { ...s, timeMs, sceneId: at.scene.id, layerId: undefined };
    }
    case 'play': return { ...s, playing: a.playing };
    case 'edit': {
      try {
        const out = record(s.clip.recipe, history(s), a.edit.ops, { by: a.by ?? 'hand', summary: a.edit.summary, at: a.at, id: a.id, mergeKey: a.edit.mergeKey });
        const next = withHistory(s, out.doc, out.history, a.at, out.change);
        return a.select ? keepSelection({ ...next, sceneId: a.select.sceneId, layerId: a.select.layerId }) : next;
      } catch (error) {
        if (!(error instanceof PatchError)) throw error;
        console.error('Motikord: could not apply an edit', error);
        return s;
      }
    }
    case 'undo': case 'redo': {
      const out = (a.type === 'undo' ? undo : redo)(s.clip.recipe, history(s));
      if (!out.change) return s;
      return withHistory(s, out.doc, out.history, a.at, out.change);
    }
  }
}

const history = (s: EditorState): History => ({ past: s.clip.history, future: s.future, mergeKey: s.mergeKey });

function withHistory(s: EditorState, recipe: Recipe, h: History, at: number, change: Change): EditorState {
  const clip: Clip = { ...s.clip, recipe, history: h.past, updatedAt: at };
  const next = { ...s, clip, future: h.future, mergeKey: h.mergeKey, lastChange: change };
  return keepSelection({ ...next, timeMs: Math.min(s.timeMs, clipDuration(recipe)) });
}

/** After an undo removed the selected scene or layer, select what is still there. */
function keepSelection(s: EditorState): EditorState {
  const scenes = s.clip.recipe.scenes;
  const scene = scenes.find((x) => x.id === s.sceneId) ?? scenes[0];
  if (!scene) return { ...s, sceneId: '', layerId: undefined };
  const layerId = scene.layers.some((l) => l.id === s.layerId) ? s.layerId : undefined;
  return { ...s, sceneId: scene.id, layerId };
}

// ---- Lookups ----

export function sceneIndex(r: Recipe, sceneId: string): number {
  return r.scenes.findIndex((s) => s.id === sceneId);
}
export function sceneStart(r: Recipe, index: number): number {
  let t = 0;
  for (let i = 0; i < index; i++) t += r.scenes[i]!.durationMs;
  return t;
}
/** A time inside the scene where layers have finished coming in, so editing shows them at rest. */
export function restTime(r: Recipe, index: number): number {
  const scene = r.scenes[index];
  return scene ? sceneStart(r, index) + Math.min(1800, Math.floor(scene.durationMs / 2)) : 0;
}

export interface Found { si: number; li: number; scene: Scene; layer: Layer; path: string }
export function findLayer(r: Recipe, sceneId: string, layerId: string | undefined): Found | undefined {
  const si = sceneIndex(r, sceneId);
  const scene = r.scenes[si];
  const li = scene ? scene.layers.findIndex((l) => l.id === layerId) : -1;
  if (!scene || li < 0) return undefined;
  return { si, li, scene, layer: scene.layers[li]!, path: `/scenes/${si}/layers/${li}` };
}

/** The scene's name for lists: its title text, else its first text, else nothing. */
export function sceneTitle(scene: Scene): string {
  const texts = scene.layers.filter((l): l is TextLayer => l.type === 'text');
  const t = texts.find((l) => l.role === 'title') ?? texts[0];
  return t ? t.text.split('\n')[0]!.trim() : '';
}

// ---- Times as the frames show them ("0:01.8", "0:05") ----

export function clock(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}
export function clockShort(ms: number): string {
  const secs = Math.round(Math.max(0, ms) / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}
/** Reads "0:04.8", "4.8" or "1:02" back into ms; undefined when it is not a time. */
export function parseClock(text: string): number | undefined {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return undefined;
  return Math.round(((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])) * 1000);
}

// ---- Edits ----

const put = (path: string, has: boolean, value: unknown): PatchOp => (has ? { op: 'replace', path, value } : { op: 'add', path, value });

/** Moves, resizes or rotates a layer on the size being edited; a "This size only" box is edited in place. */
export function setBox(r: Recipe, f: Found, box: Box, how: 'moved' | 'resized' | 'rotated'): Edit {
  const own = f.layer.boxes?.[r.aspect];
  const path = own ? `${f.path}/boxes/${r.aspect}` : `${f.path}/box`;
  return { ops: [{ op: 'replace', path, value: box }], summary: `${f.layer.name} ${how}` };
}

/** Sets one field of a layer; repeated sets of the same field merge into one change. */
export function setField(f: Found, field: string, value: unknown, summary: string): Edit {
  const has = Object.hasOwn(f.layer, field);
  return { ops: [put(`${f.path}/${field}`, has, value)], summary, mergeKey: `${f.layer.id}/${field}` };
}

export function setTiming(f: Found, startMs: number, endMs: number, summary: string): Edit | undefined {
  const start = Math.max(0, Math.min(Math.round(startMs), f.scene.durationMs - 100));
  const end = Math.max(start + 100, Math.min(Math.round(endMs), f.scene.durationMs));
  if (start === f.layer.startMs && end === f.layer.endMs) return undefined;
  return {
    ops: [{ op: 'replace', path: `${f.path}/startMs`, value: start }, { op: 'replace', path: `${f.path}/endMs`, value: end }],
    summary,
  };
}

export function rename(r: Recipe, name: string): Edit {
  return { ops: [{ op: 'replace', path: '/name', value: name }], summary: name, mergeKey: 'name' };
}

/** Switches the size being edited: every main box is reflowed onto the new size, so nothing jumps. */
export function setAspect(r: Recipe, to: Aspect): Edit | undefined {
  if (r.aspect === to) return undefined;
  const ops: PatchOp[] = [];
  r.scenes.forEach((scene, si) => scene.layers.forEach((layer, li) => {
    ops.push({ op: 'replace', path: `/scenes/${si}/layers/${li}/box`, value: boxFor({ ...layer, boxes: undefined }, to, r.aspect, scene.layout) });
  }));
  ops.push({ op: 'replace', path: '/aspect', value: to });
  return { ops, summary: to };
}

export const NEW_SCENE_MS = 5000;

/** Room left for one more scene under the 60 s limit, or 0 when a scene of at least 1 s does not fit. */
export function roomForScene(r: Recipe): number {
  const room = Math.min(NEW_SCENE_MS, MAX_CLIP_MS - clipDuration(r));
  return room >= 1000 ? room : 0;
}

export function addScene(r: Recipe, afterId: string, id: string): Edit | undefined {
  const room = roomForScene(r);
  if (!room) return undefined;
  const i = sceneIndex(r, afterId);
  const like = r.scenes[i] ?? r.scenes[r.scenes.length - 1];
  const scene: Scene = { id, durationMs: room, background: like?.background ?? '#FFFFFF', layout: like?.layout ?? 'center', layers: [] };
  return { ops: [{ op: 'add', path: `/scenes/${i < 0 ? r.scenes.length : i + 1}`, value: scene }], summary: `Scene ${(i < 0 ? r.scenes.length : i + 1) + 1}` };
}

const darkOn = (bg: string) => (contrastRatio(bg, '#111114') ?? 21) >= 4.5;
const brandColour = (kit: BrandKit | undefined, role: BrandKit['colours'][number]['role']) => kit?.colours.find((c) => c.role === role)?.hex;

export function newText(scene: Scene, id: string, kit?: BrandKit): TextLayer {
  return {
    id, name: 'Text', type: 'text', role: 'body', text: 'Text', font: kit?.bodyFont ?? 'Geist', sizePx: 72, weight: 600,
    colour: brandColour(kit, 'text') ?? (darkOn(scene.background) ? '#111114' : '#FFFFFF'), align: 'center', lineHeight: 1.2,
    startMs: 0, endMs: scene.durationMs, opacity: 1, box: { x: 0.15, y: 0.42, w: 0.7, h: 0.14 },
  };
}
export function newShape(scene: Scene, id: string, kit?: BrandKit): ShapeLayer {
  return {
    id, name: 'Shape', type: 'shape', shape: 'rect', fill: brandColour(kit, 'primary') ?? brandColour(kit, 'accent') ?? '#BE185D', radius: 24,
    startMs: 0, endMs: scene.durationMs, opacity: 1, box: { x: 0.3, y: 0.38, w: 0.4, h: 0.22 },
  };
}

export function addLayer(r: Recipe, sceneId: string, layer: Layer): Edit | undefined {
  const si = sceneIndex(r, sceneId);
  if (si < 0) return undefined;
  return { ops: [{ op: 'add', path: `/scenes/${si}/layers/-`, value: layer }], summary: layer.name };
}

export function removeLayer(f: Found): Edit {
  return { ops: [{ op: 'remove', path: f.path }], summary: f.layer.name };
}

/** Every colour the clip already uses, in first-seen order. */
export function clipColours(r: Recipe): string[] {
  const seen = new Set<string>();
  for (const s of r.scenes) {
    if (s.background !== 'transparent') seen.add(s.background.toUpperCase());
    for (const l of s.layers) {
      const c = l.type === 'text' ? l.colour : l.type === 'shape' ? l.fill : l.type === 'chart' ? l.colour : undefined;
      if (c && c !== 'transparent') seen.add(c.toUpperCase());
    }
  }
  return [...seen];
}

/** Asset ids the clip's layers draw (fonts and music are not boxes on the canvas). */
export function usedMedia(r: Recipe): { assetId: string; sceneIndex: number }[] {
  const out: { assetId: string; sceneIndex: number }[] = [];
  r.scenes.forEach((s, i) => s.layers.forEach((l) => {
    if ((l.type === 'image' || l.type === 'video') && !out.some((o) => o.assetId === l.assetId)) out.push({ assetId: l.assetId, sceneIndex: i });
  }));
  return out;
}

// ---- Dev only: a small clip to open the editor on when nothing else exists ----

const t = (id: string, name: string, role: TextLayer['role'], text: string, sizePx: number, colour: string, box: Box, extra: Partial<TextLayer> = {}): TextLayer => ({
  id, name, type: 'text', role, text, font: 'Geist', sizePx, weight: role === 'title' ? 700 : 500, colour, align: 'left', lineHeight: 1.1,
  startMs: 400, endMs: 4800, opacity: 1, box, in: { preset: 'rise-in', feel: 'smooth', durationMs: 600 }, out: { preset: 'fade-out', feel: 'smooth', durationMs: 400 }, ...extra,
});
const sh = (id: string, name: string, fill: string, box: Box, extra: Partial<ShapeLayer> = {}): ShapeLayer => ({
  id, name, type: 'shape', shape: 'rect', fill, radius: 24, startMs: 0, endMs: 5000, opacity: 1, box, in: { preset: 'grow-in', feel: 'smooth', durationMs: 600 }, ...extra,
});

export function devSampleRecipe(id: string): Recipe {
  return {
    version: 1, id, name: 'Sample clip', type: 'promo', aspect: '9:16', assets: {},
    scenes: [
      { id: 's1', durationMs: 5000, background: '#FCE7F3', layout: 'center', layers: [
        sh('s1-card', 'Card', '#FDE68A', { x: 0.07, y: 0.12, w: 0.86, h: 0.36 }),
        sh('s1-rule', 'Rule', '#BE185D', { x: 0.07, y: 0.53, w: 0.18, h: 0.012 }, { radius: 3, in: { preset: 'wipe-in', feel: 'smooth', durationMs: 600 } }),
        t('s1-title', 'Title', 'title', 'Fresh sourdough', 96, '#431407', { x: 0.07, y: 0.56, w: 0.86, h: 0.18 }),
        t('s1-sub', 'Subtitle', 'body', 'Slow-fermented for 36 hours', 40, '#7C2D12', { x: 0.07, y: 0.74, w: 0.86, h: 0.06 }),
      ] },
      { id: 's2', durationMs: 5000, background: '#FEF3C7', layout: 'center', layers: [
        sh('s2-dot', 'Dot', '#D97706', { x: 0.3, y: 0.18, w: 0.4, h: 0.22 }, { shape: 'circle', during: { preset: 'bounce', feel: 'smooth', durationMs: 900 } }),
        t('s2-title', 'Title', 'title', 'Baked every morning', 88, '#431407', { x: 0.07, y: 0.5, w: 0.86, h: 0.2 }),
        t('s2-sub', 'Subtitle', 'body', 'Out of the oven by 7', 40, '#7C2D12', { x: 0.07, y: 0.7, w: 0.86, h: 0.06 }),
      ] },
      { id: 's3', durationMs: 5000, background: '#B45309', layout: 'center', layers: [
        sh('s3-card', 'Card', '#FFFBF5', { x: 0.07, y: 0.3, w: 0.86, h: 0.34 }),
        t('s3-title', 'Title', 'title', 'Order today', 96, '#431407', { x: 0.12, y: 0.34, w: 0.76, h: 0.14 }),
        t('s3-sub', 'Subtitle', 'caption', 'sourdough.example', 40, '#FFFFFF', { x: 0.12, y: 0.5, w: 0.76, h: 0.08 }, { background: '#BE185D', align: 'center', in: { preset: 'type-on', feel: 'steady', durationMs: 1200 } }),
      ] },
    ],
  };
}
