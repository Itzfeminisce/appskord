import type { Clip } from '../../lib/types';
import { getPackV3, isPackId } from '../../lib/look/packs';
import type { ClipV3 } from '@appskord/motion/types';

/** v2 clips carry no `v3`; a restyled one carries both; a clip made in v3 carries `v3` alone. */
export type ClipKind = 'v2' | 'v3' | 'restyled';
export function clipKind(clip: Clip): ClipKind {
  if ('v3' in clip) return 'v2Version' in clip ? 'restyled' : 'v3';
  return 'v2';
}

/** The look the clip shows: its v3 pack, else the v2 style it keeps. */
export function packNameOf(clip: Clip): string {
  const v3 = (clip as Clip & { v3?: ClipV3 }).v3;
  const id = v3?.packId ?? clip.recipe.style;
  return isPackId(id) ? getPackV3(id).name : id ? id[0]!.toUpperCase() + id.slice(1) : '';
}

/** "18 s", as the frames write a clip's length. */
export const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
