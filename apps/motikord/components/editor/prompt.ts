import { validateClip, validateScene } from '@appskord/motion/recipe';
import type { Feel, SceneV3 } from '@appskord/motion/types';
import type { PromptEdit } from '../../lib/editor/applyPrompt';
import { toSizeOnly } from '../../lib/editor/sizeOnly';
import { setAspect } from '../../lib/editor/store';
import { restyle, type RestyledClip } from '../../lib/restyle/restyle';
import { linkScenes } from '../../lib/templates/v3/build';
import type { Aspect, PatchOp, Recipe } from '../../lib/types';
import { feelNear } from './curves';
import { readMotion, type MotionSpec } from './edits';
import { applyOps, type V3State } from './model';

// Recipe edits in the v3 editor ("Tell Motikord what to change", the size switch): the v2 recipe ops land under
// /recipe, and the v3 scenes follow when scenes or layers were added, removed, moved or retimed.

/** Ops on the v2 recipe, as ops on the clip. */
export const underRecipe = (ops: readonly PatchOp[]): PatchOp[] =>
  ops.map((o) => (o.op === 'move' ? { ...o, from: `/recipe${o.from}`, path: `/recipe${o.path}` } : { ...o, path: `/recipe${o.path}` }));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The v3 scenes for a changed v2 recipe: a scene with the same layers keeps its motion; others are built fresh. */
export function syncScenes(clip: RestyledClip, next: Recipe): SceneV3[] | undefined {
  let fresh: SceneV3[] | undefined;
  const built = () => (fresh ??= restyle({ ...clip, recipe: next }, { packId: clip.v3.packId as never, now: 0, changeId: 'sync' }).v3.scenes);
  try {
    const scenes = next.scenes.map((s, i) => {
      const old = clip.v3.scenes.find((o) => o.id === s.id);
      const ids = s.layers.map((l) => l.id);
      if (old && same(old.layers.map((l) => l.id).sort(), [...ids].sort())) {
        const layers = ids.map((id) => old.layers.find((l) => l.id === id)!);
        const kept = { ...old, layers, ms: s.durationMs };
        if (same(layers, old.layers) && old.ms === s.durationMs) return old;
        if (validateScene(kept).ok) return kept;
      }
      return built()[i]!;
    });
    const linked = linkScenes(scenes);
    return validateClip({ ...clip.v3, scenes: linked }).ok ? linked : undefined;
  } catch {
    return undefined;
  }
}

/** Every op a v2 recipe change makes to the restyled clip, or undefined when the v3 scenes cannot follow it. */
export function recipeOps(clip: RestyledClip, next: Recipe, ops: readonly PatchOp[]): PatchOp[] | undefined {
  const scenes = syncScenes(clip, next);
  if (!scenes) return undefined;
  const out = underRecipe(ops);
  return same(scenes, clip.v3.scenes) ? out : [...out, { op: 'replace', path: '/v3/scenes', value: scenes }];
}

/** Applies a checked prompt answer; the state is unchanged when the v3 scenes cannot follow it. */
export function applyPromptV3(st: V3State, out: PromptEdit, sizeOnly = false): V3State {
  const edit = sizeOnly ? toSizeOnly(st.clip.recipe, out.edit) : out.edit;
  const ops = recipeOps(st.clip, out.recipe, edit.ops);
  if (!ops) return st;
  return applyOps(st, ops, { summary: edit.summary, by: out.by });
}

/** What a prompt edit changed (EditPromptV3): the clip it made, the first changed scene and layer, and the panel sections. */
export interface PromptChanged {
  clip: RestyledClip;
  summary: string;
  scene: number;
  layerId?: string;
  sections: string[];
  /** The changed layer's feel before the edit, when its curve was one of the feels. */
  hadFeel?: Feel;
}

// Panel sections, by their titles in the Motion and Scene tabs.
const MOTION_SECTIONS: readonly [string, readonly (keyof MotionSpec)[]][] = [
  ['Comes in', ['comesIn']],
  ['Feel', ['curve']],
  ['Timing', ['ms']],
  ['Type moves', ['weight', 'width']],
  ['While on screen', ['hold']],
  ['Goes out', ['out']],
];

/** Compares the clip before and after a prompt edit; undefined when nothing changed. */
export function promptChanged(before: RestyledClip, after: RestyledClip, summary: string): PromptChanged | undefined {
  const scenes = after.v3.scenes;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]!;
    const oldS = before.v3.scenes.find((o) => o.id === s.id);
    const v2 = after.recipe.scenes[i];
    const oldV2 = before.recipe.scenes.find((o) => o.id === v2?.id);
    if (oldS && same(oldS, s) && same(oldV2, v2)) continue;
    const layer = s.layers.find((l) => {
      const old = oldS?.layers.find((o) => o.id === l.id);
      return !old || !same(old, l) || !same(oldV2?.layers.find((o) => o.id === l.id), v2?.layers.find((o) => o.id === l.id));
    });
    const sections: string[] = [];
    let hadFeel: Feel | undefined;
    const old = layer && oldS?.layers.find((o) => o.id === layer.id);
    if (layer && oldS && old) {
      const [a, b] = [readMotion(oldS, old), readMotion(s, layer)];
      hadFeel = feelNear(a.curve);
      for (const [title, keys] of MOTION_SECTIONS) if (keys.some((k) => !same(a[k], b[k]))) sections.push(title);
      if ((layer.start ?? 0) !== (old.start ?? 0) && !sections.includes('Timing')) sections.push('Timing');
    }
    if (oldS && !same(oldS.camera, s.camera)) sections.push('Camera and depth');
    return { clip: after, summary, scene: i, layerId: layer?.id ?? s.layers[0]?.id, sections, hadFeel };
  }
  return undefined;
}

/** A prompt edit and the jump to what it changed: the first changed scene, its first changed layer selected. */
export function promptStep(st: V3State, out: PromptEdit, sizeOnly = false): { state: V3State; changed?: PromptChanged } {
  const next = applyPromptV3(st, out, sizeOnly);
  if (next === st) return { state: st };
  const summary = out.detail || out.edit.summary;
  // A change outside the scenes (the clip's name, say) still gets its toast, with nothing on the stage to tag.
  const changed = promptChanged(st.clip, next.clip, summary);
  if (!changed) return { state: next, changed: { clip: next.clip, summary, scene: next.scene, sections: [] } };
  return { state: { ...next, scene: changed.scene, layerId: changed.layerId }, changed };
}

/** "Done. The headline now comes in letter by letter." */
export const doneLine = (summary: string) => `Done. ${summary.trim().replace(/[.!]+$/, '')}.`;

/** The size switch (9:16, 1:1, 16:9): the v2 boxes reflow for the new size, as in the v2 editor. */
export function setSizeV3(st: V3State, to: Aspect): V3State {
  const r = st.clip.recipe;
  const e = setAspect(r, to);
  if (!e) return st;
  return applyOps(st, underRecipe(e.ops), { summary: e.summary });
}
