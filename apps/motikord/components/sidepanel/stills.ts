// Key-frame stills and quality-check frames are drawn by the render worker, never in the side panel, so the panel
// imports no three.js. The worker's path registers itself here; until it does, a still falls back to the scene's
// words on the look's ground colour.
import type { ClipV3, SceneV3 } from '@appskord/motion/types';
import type { ClipFrames } from '../../lib/critic/v3';

/** A small picture URL of the scene at `atMs`, or undefined when it can't be drawn. */
export type StillRenderer = (scene: SceneV3, atMs: number, size: { width: number; height: number }) => Promise<string | undefined>;

let still: StillRenderer | undefined;
let clip: ClipFrames | undefined;

export function setRenderers(r: { still?: StillRenderer; clip?: ClipFrames }): void {
  still = r.still;
  clip = r.clip;
}
export const clipFrames = (): ClipFrames | undefined => clip;

export async function renderStill(scene: SceneV3, atMs: number, size: { width: number; height: number }): Promise<string | undefined> {
  if (!still) return undefined;
  try {
    return await still(scene, atMs, size);
  } catch (error) {
    console.error('Motikord: could not draw a key frame', error);
    return undefined;
  }
}

export type { ClipV3 };
