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
    expect(sceneLayerContent(scene('stat-reveal'), added('bar'), '16:9')).toBeUndefined();
  });
});
