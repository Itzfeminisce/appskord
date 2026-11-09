import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ease, FEEL } from '../src/curves';
import { applyFrame, buildGraph, frameAt, type MotionGraph } from '../src/scene';
import { frameAtMs, frameCount, frameMs } from '../src/time';
import { scene } from './fixture';

// A tiny CPU canvas: each visible layer stamps a unit square through its world matrix, weighted by opacity.
function pixelsHash(graph: MotionGraph, size = 24): string {
  const px = new Uint8Array(size * size);
  const p = new THREE.Vector3();
  graph.layers.forEach((g) => {
    if (!g.visible) return;
    const a = Math.round(((g.userData.opacity as number) ?? 1) * 255);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        p.set((x / size - 0.5) * 10, (y / size - 0.5) * 10, 0);
        const local = p.clone().applyMatrix4(g.matrixWorld.clone().invert());
        if (Math.abs(local.x) <= 0.5 && Math.abs(local.y) <= 0.5)
          px[y * size + x] = Math.max(px[y * size + x] as number, a);
      }
  });
  return createHash('sha256').update(px).digest('hex');
}

const render = (t: number) => {
  const graph = buildGraph(scene());
  applyFrame(graph, frameAt(scene(), t));
  return pixelsHash(graph);
};

describe('frameAt', () => {
  it('gives the same state and pixels for the same t, in any order', () => {
    const ts = [0, 123, 480, 900, 2999];
    const forward = ts.map((t) => JSON.stringify(frameAt(scene(), t)));
    const backward = [...ts].reverse().map((t) => JSON.stringify(frameAt(scene(), t)));
    expect(backward.reverse()).toEqual(forward);
    expect(ts.map(render)).toEqual(ts.map(render));
    expect(render(0)).not.toBe(render(900));
    // Reusing one graph across frames leaves no trace of earlier frames.
    const graph = buildGraph(scene());
    applyFrame(graph, frameAt(scene(), 2000));
    applyFrame(graph, frameAt(scene(), 480));
    expect(pixelsHash(graph)).toBe(render(480));
  });

  it('times layers by hierarchy and samples their tracks', () => {
    const f = frameAt(scene(), 320);
    const [kicker, headline, blob] = f.layers;
    expect(kicker?.props.opacity).toBe(ease(FEEL.smooth.curve)(320 / 360));
    expect(headline?.start).toBe(320);
    expect(headline?.props.scale).toBe(0.6);
    expect(blob?.props.z).toBe(-4);
    expect(f.camera).toEqual({ move: 'push-in', amount: 0.4, focus: 'headline', progress: 320 / 3000 });
    expect(frameAt(scene(), 5000).layers[1]?.props.scale).toBe(1);
  });

  it('builds one group per layer under its depth', () => {
    const graph = buildGraph(scene());
    expect(graph.depths.back.children.map((c) => c.name)).toEqual(['blob']);
    expect(graph.depths.middle.userData.parallax).toBe(0.6);
    applyFrame(graph, frameAt(scene(), 0));
    expect(graph.layers.get('headline')?.visible).toBe(false);
  });

  it('maps frames to ms without drift', () => {
    expect(frameCount(15000, 30)).toBe(450);
    expect(frameMs(450, 60)).toBe(7500);
    for (let i = 0; i < 900; i++) expect(frameAtMs(frameMs(i, 60), 60)).toBe(i);
  });
});
