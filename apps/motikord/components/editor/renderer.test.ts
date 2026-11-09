import { describe, expect, it, vi } from 'vitest';

// troika typesets with a DOM and real fonts; a stand-in Text keeps the graph buildable in Node. three is the motion
// package's dependency, so it is loaded from there.
vi.mock('@appskord/motion/text', async () => {
  const url = new URL('../../../../packages/motion/node_modules/three/build/three.module.js', import.meta.url);
  const THREE = (await import(/* @vite-ignore */ url.pathname)) as { Object3D: new () => object };
  return { Text: class extends THREE.Object3D {
    clipRect: unknown = null;
    fillOpacity = 1;
    color = '';
    sync = vi.fn();
    dispose = vi.fn();
  } };
});

import { V3Renderer } from '@appskord/motion/renderer';
import { packFinish, packLook, PACKS_V3 } from '../../lib/look/packs';
import { buildScene } from '../../lib/templates/v3/build';
import { TEMPLATES_V3 } from '../../lib/templates/v3/templates';

describe('V3Renderer smoke', () => {
  it('builds and poses a graph for every template in every pack', () => {
    let built = 0;
    for (const t of TEMPLATES_V3)
      for (const pack of PACKS_V3) {
        const scene = buildScene(t, pack, { id: `${t.id}-${pack.id}` });
        const r = new V3Renderer(scene, {
          width: 1080, height: 1920, quality: 'reduced', fps: 30, fontUrl: '/fonts/test.woff',
          finish: packFinish(pack), look: packLook(pack), content: (l) => (l.kind === 'text' ? { text: 'Notes that find you' } : undefined),
        });
        expect(r.graph.layers.size, `${t.id} × ${pack.id}`).toBe(scene.layers.length);
        for (const ms of [0, scene.ms / 2, scene.ms]) expect(r.pose(ms).layers).toHaveLength(scene.layers.length);
        r.dispose();
        built++;
      }
    expect(built).toBe(TEMPLATES_V3.length * PACKS_V3.length);
  });
});
