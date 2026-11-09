import { describe, expect, it } from 'vitest';
import type { LayerV3 } from '@appskord/motion/types';
import type { Scene } from '../types';
import { sceneLayerContent } from './text';

const scene = (template: string): Scene => ({ id: 's', template, layers: [], durationMs: 3000 }) as unknown as Scene;
const added = (id: string, kind: LayerV3['kind'] = 'shape'): LayerV3 => ({ id, kind, depth: 'back', tracks: {} });

describe('template layers', () => {
  it('backs the text with glass, and draws blobs, arches and paths as decor', () => {
    expect(sceneLayerContent(scene('title-hook'), added('glass'), '16:9')).toEqual({ backs: ['kicker', 'headline'] });
    expect(sceneLayerContent(scene('quote'), added('v3-blob'), '16:9')).toMatchObject({ decor: true, shape: 'blob' });
    expect(sceneLayerContent(scene('hero'), added('arch'), '16:9')).toMatchObject({ decor: true, shape: 'arch' });
    expect(sceneLayerContent(scene('steps'), added('path', 'path'), '16:9')).toEqual({ decor: true });
    expect(sceneLayerContent(scene('stat-reveal'), added('bar'), '16:9')).toEqual({ under: 'number', shape: 'line' });
    expect(sceneLayerContent(scene('hero'), added('pills', 'model'), '16:9')).toBeUndefined();
  });

  it('keeps decor within 60% of the frame\'s shorter side', () => {
    for (const [aspect, short] of [['16:9', 607.5], ['9:16', 1080], ['1:1', 1080]] as const)
      for (const [t, id] of [['hero', 'arch'], ['steps', 'blob']]) {
        const size = sceneLayerContent(scene(t!), added(id!), aspect)!.size!;
        expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(short * 0.6 + 1e-9);
      }
  });
});
