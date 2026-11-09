import type { LookGuide } from '@appskord/motion/types';
import { getPackV3, packLook } from '../look/packs';
import { getLook } from '../look/store';
import type { RestyledClip } from '../restyle/restyle';

/** The clip's saved look guide, else its pack's look: what the v3 editor draws with. */
export async function clipLook(clip: RestyledClip): Promise<LookGuide> {
  const saved = await getLook(clip.v3.lookGuideId).catch(() => undefined);
  return saved?.guide ?? packLook(getPackV3(clip.v3.packId));
}
