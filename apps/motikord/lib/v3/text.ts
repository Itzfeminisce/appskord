import type { LayerV3 } from '@appskord/motion/types';
import type { Scene } from '../types';

/** The words a v3 text layer shows: its v2 layer's text, or its slot's words in the v2 scene. */
export function sceneLayerText(scene: Scene | undefined, layer: LayerV3): string | undefined {
  const v2 = scene?.layers.find((l) => l.id === layer.id);
  if (v2?.type === 'text') return v2.text;
  const value = layer.slotId ? scene?.slots?.[layer.slotId] : undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((x) => (typeof x === 'string' ? x : x.label)).join('\n');
  return undefined;
}
