import type { Recipe, TransitionKind } from '../types';
import { clamp01, ease } from './easing';
import { MOTION_TOKENS } from './tokens';

/** How one scene sits on the canvas during a transition. dx/dy are fractions of the canvas; reveal is the shown width from the left. */
export interface Shot { alpha: number; dx: number; dy: number; scale: number; reveal: number }
export const STILL: Shot = { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1 };

/** Kinds that draw both scenes at once; cut and match cut show only the incoming scene. */
export const blends = (kind: TransitionKind) => kind !== 'cut' && kind !== 'match';

/** The outgoing and incoming shots at eased progress p (0 is all outgoing, 1 is all incoming). */
export function transitionShots(kind: TransitionKind, p: number): { out?: Shot; in: Shot } {
  const q = clamp01(p);
  switch (kind) {
    case 'crossfade': return { out: STILL, in: { ...STILL, alpha: q } };
    case 'slide': return { out: STILL, in: { ...STILL, dx: 1 - p } };
    case 'push': return { out: { ...STILL, dx: -p }, in: { ...STILL, dx: 1 - p } };
    case 'wipe': return { out: STILL, in: { ...STILL, reveal: q } };
    case 'zoom': return { out: { ...STILL, scale: 1 + 0.15 * q }, in: { ...STILL, alpha: q, scale: 0.9 + 0.1 * p } };
    default: return { in: STILL };
  }
}

/** Eased transition progress with the clip's pack curve (smooth when the clip has no style). */
export const transitionProgress = (recipe: Pick<Recipe, 'style'>, localMs: number, ms: number) =>
  ease(recipe.style ? MOTION_TOKENS[recipe.style].feel : 'smooth', localMs / Math.max(1, ms));
