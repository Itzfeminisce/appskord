import { applyPatch, PatchError } from '../patch';
import type { Change, Clip } from '../types';

// Another surface (Library rename, Brand apply, Making finishing) saved the clip the editor has open.
// Its version becomes the base; the editor's own changes since `base` are replayed on top, so none are lost.

/** A merged change keeps its id but gets a new `at`, so both together say "this exact version". */
const key = (c: Change) => `${c.id}@${c.at}`;

/** True when `stored` is still the version the editor last wrote or read. */
export function sameVersion(base: Clip, stored: Clip): boolean {
  return stored.updatedAt === base.updatedAt && stored.recipe.name === base.recipe.name
    && stored.history.length === base.history.length && stored.history.every((c, i) => key(c) === key(base.history[i]!));
}

export interface Merged { clip: Clip; /** The editor has changes the store does not have yet. */ dirty: boolean }

/**
 * `local` is the editor's clip, `base` the stored version it started from, `stored` what is stored now.
 * Changes the editor undid since `base` are taken back from `stored`; changes it made are replayed onto it.
 * A change that no longer applies (its layer is gone) is dropped.
 */
export function mergeClip(local: Clip, base: Clip, stored: Clip, now = Date.now()): Merged {
  if (sameVersion(base, stored)) return { clip: local, dirty: local !== base };
  const baseKeys = new Set(base.history.map(key));
  const localKeys = new Set(local.history.map(key));
  const storedKeys = new Set(stored.history.map(key));
  const undone = base.history.filter((c) => !localKeys.has(key(c)) && storedKeys.has(key(c)));
  const made = local.history.filter((c) => !baseKeys.has(key(c)) && !storedKeys.has(key(c)));

  let recipe = stored.recipe;
  const dropped = new Set<string>();
  for (const c of [...undone].reverse()) {
    try { recipe = applyPatch(recipe, c.inverse).doc; } catch (error) {
      if (!(error instanceof PatchError)) throw error;
    }
    dropped.add(key(c));
  }
  const replayed: Change[] = [];
  for (const c of made) {
    try {
      const out = applyPatch(recipe, c.patch);
      recipe = out.doc;
      replayed.push({ ...c, inverse: out.inverse });
    } catch (error) {
      if (!(error instanceof PatchError)) throw error;
    }
  }
  const dirty = dropped.size > 0 || replayed.length > 0;
  return {
    clip: {
      ...stored,
      recipe,
      history: [...stored.history.filter((c) => !dropped.has(key(c))), ...replayed],
      updatedAt: dirty ? Math.max(now, stored.updatedAt + 1) : stored.updatedAt,
    },
    dirty,
  };
}
