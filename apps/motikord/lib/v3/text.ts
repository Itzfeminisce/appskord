import type { LayerContent } from '@appskord/motion/draw';
import type { LayerV3 } from '@appskord/motion/types';
import { boxFor } from '@appskord/scenes/render/reflow';
import { sizeOn } from '@appskord/scenes/render/textFit';
import { aspectOf } from '@appskord/scenes/templates/blocks';
import type { Aspect, Scene } from '../types';

/** The words a v3 text layer shows: its v2 layer's text, or its slot's words in the v2 scene. */
export function sceneLayerText(scene: Scene | undefined, layer: LayerV3): string | undefined {
  const v2 = scene?.layers.find((l) => l.id === layer.id);
  if (v2?.type === 'text') return v2.text;
  const value = layer.slotId ? scene?.slots?.[layer.slotId] : undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((x) => (typeof x === 'string' ? x : x.label)).join('\n');
  return undefined;
}

/** What each layer of scene `i` draws beyond its tracks, in a frame of `aspect`. */
export type LayerContents = (i: number, layer: LayerV3, aspect: Aspect) => LayerContent | undefined;

/** The aspect of a drawn frame. */
export const aspectOfSize = (size: { width: number; height: number }): Aspect => aspectOf(size.width, size.height);

/**
 * What the renderer draws for a layer beyond its tracks, from its v2 layer in a frame of `aspect` (boxes reflowed
 * from `source`, the size the recipe was laid out at): a text's words, size, layout box and alignment in it; a shape's box, fill and
 * corners. The editor, the export, the stills and the check all read it here, so they never drift apart.
 */
export function sceneLayerContent(
  scene: Scene | undefined,
  layer: LayerV3,
  aspect: Aspect,
  source: Aspect = aspect,
): LayerContent | undefined {
  const v2 = scene?.layers.find((l) => l.id === layer.id);
  const b = v2 && scene ? boxFor(v2, aspect, source, scene.layout) : undefined;
  const box = b && { x: b.x, y: b.y, w: b.w, h: b.h };
  // Recipe px are 1080 wide; v2 sizes are px at a 1080 short side.
  const frame = { width: 1080, height: aspect === '9:16' ? 1920 : aspect === '1:1' ? 1080 : 607.5 };
  const k = Math.min(frame.width, frame.height) / 1080;
  if (layer.kind === 'text') {
    const fontSize = v2?.type === 'text' ? sizeOn(v2, aspect) * k : undefined;
    const align = v2?.type === 'text' && (v2.align === 'left' || v2.align === 'right') ? v2.align : undefined;
    const valign = v2?.type === 'text' && v2.valign === 'top' ? v2.valign : undefined;
    return {
      text: sceneLayerText(scene, layer) ?? '',
      ...(fontSize ? { fontSize } : {}),
      ...(box ? { box } : {}),
      ...(align ? { align } : {}),
      ...(valign ? { valign } : {}),
    };
  }
  if (v2?.type !== 'shape' || !box) return undefined;
  return { size: { w: box.w * frame.width, h: box.h * frame.height }, color: v2.fill, shape: v2.shape, radius: v2.radius === undefined ? undefined : v2.radius * k, box };
}

/** The content of every layer of `scene` that has some, by layer id. */
export function sceneContents(
  scene: { layers: readonly LayerV3[] },
  v2: Scene | undefined,
  aspect: Aspect,
  source: Aspect = aspect,
): Record<string, LayerContent> {
  const out: Record<string, LayerContent> = {};
  for (const l of scene.layers) {
    const c = sceneLayerContent(v2, l, aspect, source);
    if (c) out[l.id] = c;
  }
  return out;
}
