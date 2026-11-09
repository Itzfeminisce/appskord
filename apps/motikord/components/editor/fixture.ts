// Test fixture: the v2 sample clip restyled with v3 motion.
import { devSampleV2 } from '../../lib/editor/v2';
import { restyle, type RestyledClip } from '../../lib/restyle/restyle';
import type { PackId } from '../../lib/look/packs';

export function sampleClip(packId?: PackId): RestyledClip {
  const recipe = devSampleV2('clip-1');
  return restyle({ id: 'clip-1', recipe, history: [], createdAt: 1, updatedAt: 1 }, { now: 1000, changeId: 'restyle-1', packId });
}
