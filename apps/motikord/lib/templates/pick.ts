import type { Pace, StylePack, Transition } from '../types';

export interface PaceMs { sceneMs: number; transitionMs: number }

// CONTRACT.md: Calm 4.5 s, 600 ms; Normal 3 s, 400 ms; Fast 1.75 s, 250 ms.
const PACE: Record<Pace, PaceMs> = {
  calm: { sceneMs: 4500, transitionMs: 600 },
  normal: { sceneMs: 3000, transitionMs: 400 },
  fast: { sceneMs: 1750, transitionMs: 250 },
};

/** Scene length and transition length for a pace. */
export const paceMs = (pace: Pace): PaceMs => PACE[pace] ?? PACE.normal;

/** The transition into scene `i`, cycling through the pack's set; a cut or match cut takes 0 ms. */
export function transitionFor(pack: StylePack, i: number, pace: Pace = 'normal'): Transition {
  const set = pack.transitions.length ? pack.transitions : (['cut'] as const);
  const kind = set[((i % set.length) + set.length) % set.length]!;
  return { kind, ms: kind === 'cut' || kind === 'match' ? 0 : paceMs(pace).transitionMs };
}
