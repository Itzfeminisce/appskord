import { validateClip, validateScene } from '@appskord/motion/recipe';
import type { SceneV3 } from '@appskord/motion/types';
import type { PromptEdit } from '../../lib/editor/applyPrompt';
import { setAspect } from '../../lib/editor/store';
import { restyle, type RestyledClip } from '../../lib/restyle/restyle';
import { linkScenes } from '../../lib/templates/v3/build';
import type { Aspect, PatchOp, Recipe } from '../../lib/types';
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
      if (old && same(old.layers.map((l) => l.id).sort(), s.layers.map((l) => l.id).sort())) {
        if (old.ms === s.durationMs) return old;
        const kept = { ...old, ms: s.durationMs };
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
export function applyPromptV3(st: V3State, out: PromptEdit): V3State {
  const ops = recipeOps(st.clip, out.recipe, out.edit.ops);
  if (!ops) return st;
  return applyOps(st, ops, { summary: out.edit.summary, by: out.by });
}

/** The size switch (9:16, 1:1, 16:9): the v2 boxes reflow for the new size, as in the v2 editor. */
export function setSizeV3(st: V3State, to: Aspect): V3State {
  const r = st.clip.recipe;
  const e = setAspect(r, to);
  if (!e) return st;
  return applyOps(st, underRecipe(e.ops), { summary: e.summary });
}
