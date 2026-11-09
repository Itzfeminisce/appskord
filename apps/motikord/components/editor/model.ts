// The v3 editor's state: the clip, what is selected, and every edit written through validateScene into Changes.
import { getSceneTemplate } from '@appskord/scenes/templates/scenes';
import { validateClip, validateScene } from '@appskord/motion/recipe';
import type { EffectUse } from '@appskord/motion/effects';
import type { ClipV3, LayerV3, SceneV3 } from '@appskord/motion/types';
import { record, redo, undo, type History } from '../../lib/editor/history';
import { stepsBack } from '../../lib/editor/changes';
import { applyPatch } from '../../lib/patch';
import type { RestyledClip } from '../../lib/restyle/restyle';
import { getTemplateV3 } from '../../lib/templates/v3/templates';
import type { Author, Change, Layer, PatchOp } from '../../lib/types';

export type Tab = 'scene' | 'layer' | 'motion' | 'changes';
export const TABS: readonly [Tab, string][] = [
  ['scene', 'Scene'],
  ['layer', 'Layer'],
  ['motion', 'Motion'],
  ['changes', 'Changes'],
];

export interface V3State {
  clip: RestyledClip;
  future: Change[];
  mergeKey?: string;
  mergeStart?: number;
  scene: number;
  layerId?: string;
  tab: Tab;
  /** The recipe check's errors from the last edit that did not apply. */
  errors?: string[];
}

export interface EditMeta {
  summary: string;
  by?: Author;
  /** Slider drags on the same control merge into one change. */
  mergeKey?: string;
  at?: number;
  id?: string;
}

export function initV3(clip: RestyledClip, scene = 0): V3State {
  const s = clip.v3.scenes[scene];
  return { clip, future: [], scene, layerId: s?.layers[0]?.id, tab: 'motion' };
}

const history = (st: V3State): History => ({
  past: st.clip.history,
  future: st.future,
  mergeKey: st.mergeKey,
  mergeStart: st.mergeStart,
});
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

/** Applies ops to the clip and records one Change (merged with the last one when its mergeKey matches). */
export function applyOps(st: V3State, ops: PatchOp[], meta: EditMeta): V3State {
  const at = meta.at ?? Date.now();
  const out = record(st.clip, history(st), ops, {
    by: meta.by ?? 'hand',
    summary: meta.summary,
    at,
    id: meta.id ?? newId(),
    mergeKey: meta.mergeKey,
  });
  return {
    ...st,
    clip: { ...out.doc, history: out.history.past, updatedAt: at },
    future: out.history.future,
    mergeKey: out.history.mergeKey,
    mergeStart: out.history.mergeStart,
    errors: undefined,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Edits one scene. The result must pass validateScene, or nothing changes and `errors` says why. */
export function editScene(st: V3State, i: number, fn: (s: SceneV3) => SceneV3 | void, meta: EditMeta): V3State {
  const before = st.clip.v3.scenes[i];
  if (!before) return st;
  const draft = structuredClone(before);
  const next = fn(draft) ?? draft;
  if (same(before, next)) return st;
  const checked = validateScene(next);
  if (!checked.ok) return { ...st, errors: checked.errors };
  return applyOps(st, [{ op: 'replace', path: `/v3/scenes/${i}`, value: next }], meta);
}

/** Edits a layer of the selected scene. */
export function editLayer(st: V3State, layerId: string, fn: (l: LayerV3, s: SceneV3) => LayerV3 | void, meta: EditMeta): V3State {
  return editScene(
    st,
    st.scene,
    (s) => {
      const i = s.layers.findIndex((l) => l.id === layerId);
      if (i < 0) return s;
      const next = fn(s.layers[i]!, s);
      if (next) s.layers[i] = next;
      return s;
    },
    meta,
  );
}

/** Edits several scenes at once (a carry spans two); each passes validateScene and the clip passes validateClip. */
export function editScenes(st: V3State, fn: (scenes: SceneV3[]) => SceneV3[] | void, meta: EditMeta): V3State {
  const draft = structuredClone(st.clip.v3.scenes);
  const next = fn(draft) ?? draft;
  const ops: PatchOp[] = [];
  for (let i = 0; i < next.length; i++) {
    if (same(st.clip.v3.scenes[i], next[i])) continue;
    const checked = validateScene(next[i]);
    if (!checked.ok) return { ...st, errors: checked.errors };
    ops.push({ op: 'replace', path: `/v3/scenes/${i}`, value: next[i] });
  }
  if (!ops.length) return st;
  const clip: ClipV3 = { ...st.clip.v3, scenes: next };
  const checked = validateClip(clip);
  if (!checked.ok) return { ...st, errors: checked.errors };
  return applyOps(st, ops, meta);
}

/** Sets the clip-wide effect uses ("Whole clip"). */
export function editClipEffects(st: V3State, effects: EffectUse[], meta: EditMeta): V3State {
  const next: ClipV3 = { ...st.clip.v3, effects };
  const checked = validateClip(next);
  if (!checked.ok) return { ...st, errors: checked.errors };
  return applyOps(st, [{ op: st.clip.v3.effects ? 'replace' : 'add', path: '/v3/effects', value: effects }], meta);
}

const keepSelection = (st: V3State, clip: RestyledClip): Pick<V3State, 'scene' | 'layerId'> => {
  const scene = Math.min(st.scene, clip.v3.scenes.length - 1);
  const layers = clip.v3.scenes[scene]?.layers ?? [];
  return { scene, layerId: layers.some((l) => l.id === st.layerId) ? st.layerId : layers[0]?.id };
};

export function undoV3(st: V3State): V3State {
  const out = undo(st.clip, history(st));
  if (!out.change) return st;
  const clip = { ...out.doc, history: out.history.past };
  return { ...st, clip, future: out.history.future, mergeKey: undefined, mergeStart: undefined, errors: undefined, ...keepSelection(st, clip) };
}

export function redoV3(st: V3State): V3State {
  const out = redo(st.clip, history(st));
  if (!out.change) return st;
  const clip = { ...out.doc, history: out.history.past };
  return { ...st, clip, future: out.history.future, mergeKey: undefined, mergeStart: undefined, errors: undefined, ...keepSelection(st, clip) };
}

/** "Go back here": undoes every change after this one; they stay in the list to come forward again. */
export function goBackTo(st: V3State, changeId: string): V3State {
  const n = stepsBack(st.clip.history, changeId) ?? 0;
  let out = st;
  for (let k = 0; k < n; k++) out = undoV3(out);
  return out;
}

/** The clip as it was before every change, for the "Clip made" row; undefined when a change cannot be taken back. */
export function clipBefore(clip: RestyledClip): RestyledClip | undefined {
  try {
    let doc = clip;
    for (const c of [...clip.history].reverse()) doc = applyPatch(doc, c.inverse).doc;
    return doc;
  } catch {
    return undefined;
  }
}

// Names, as the frames show them.

export const v2Layer = (clip: RestyledClip, i: number, id: string): Layer | undefined =>
  clip.recipe.scenes[i]?.layers.find((l) => l.id === id);

const KIND_NAME: Record<LayerV3['kind'], string> = {
  text: 'Text',
  shape: 'Shape',
  path: 'Line',
  media: 'Media',
  lottie: 'Animation',
  icon: 'Icon',
  particles: 'Particles',
  chart: 'Chart',
  model: '3D',
};

/** "Headline": the v2 layer's name, the template slot's name, else the kind. */
export function layerName(clip: RestyledClip, i: number, layer: LayerV3): string {
  const v2 = v2Layer(clip, i, layer.id);
  if (v2) return v2.name;
  const template = clip.recipe.scenes[i]?.template ?? clip.v3.scenes[i]?.templateId;
  const slot = layer.slotId && template ? getSceneTemplate(template)?.slots.find((s) => s.id === layer.slotId) : undefined;
  if (slot) return slot.name;
  if (layer.particles) return KIND_NAME.particles;
  return KIND_NAME[layer.kind];
}

/** The words a text layer shows: its v2 text, or its slot's words. */
export function layerText(clip: RestyledClip, i: number, layer: LayerV3): string | undefined {
  const v2 = v2Layer(clip, i, layer.id);
  if (v2?.type === 'text') return v2.text;
  const value = layer.slotId ? clip.recipe.scenes[i]?.slots?.[layer.slotId] : undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((x) => (typeof x === 'string' ? x : x.label)).join('\n');
  return undefined;
}

/** "Notes that find you": the scene's first words. */
export function sceneTitle(clip: RestyledClip, i: number): string {
  const s = clip.v3.scenes[i];
  for (const l of s?.layers ?? []) {
    const text = l.kind === 'text' ? layerText(clip, i, l) : undefined;
    if (text?.trim()) return text.replace(/\s+/g, ' ').trim();
  }
  return '';
}

export const templateName = (s: SceneV3): string => getTemplateV3(s.templateId)?.name ?? '';

/** ms each scene starts on the clip's timeline. */
export function sceneStarts(v3: ClipV3): number[] {
  let at = 0;
  return v3.scenes.map((s) => {
    const start = at;
    at += s.ms;
    return start;
  });
}
export const clipMs = (v3: ClipV3) => v3.scenes.reduce((n, s) => n + s.ms, 0);

/** "0:03", "0:09.5". */
export function clock(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = Math.abs(rest - Math.round(rest)) < 0.05;
  return `${m}:${(whole ? String(Math.round(rest)) : rest.toFixed(1)).padStart(whole ? 2 : 4, '0')}`;
}
/** "0:00.9" for the transport. */
export const clockTenths = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
