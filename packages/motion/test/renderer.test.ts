import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// troika needs a DOM and fonts; a stand-in Text keeps the graph testable in Node.
vi.mock('../src/text', () => ({
  Text: class extends THREE.Object3D {
    clipRect: unknown = null;
    fillOpacity = 1;
    color = '';
    sync = vi.fn();
    dispose = vi.fn();
  },
}));

import { chartLayers, CHART_DEFAULTS } from '../src/charts';
import { bakeParticles, PARTICLE_DEFAULTS } from '../src/particles';
import { StrokeMesh } from '../src/paths';
import { autoRig, rigLayers, RIG_DEFAULTS } from '../src/rigs';
import { ShapeMesh } from '../src/shapes';
import { V3Renderer } from '../src/renderer';
import { clip, scene } from './fixture';

const look = {
  id: 'g',
  name: 'Studio',
  palette: ['#0B0B10', '#F5F5F7', '#8B9CFF', '#1A1B2E', '#8E90A0'],
  type: { display: 'Geist', text: 'Geist' },
  feel: 'smooth' as const,
  light: 'left' as const,
  texture: 0.2,
  camera: 'push-in' as const,
};

describe('V3Renderer', () => {
  it('builds the graph, content and finish chain and poses every frame without a GPU', () => {
    const s = scene();
    s.effects = [{ effect: 'glow', amount: 0.6, scope: 'layer', sceneId: s.id, layerId: 'headline' }];
    const r = new V3Renderer(s, {
      width: 1080,
      height: 1920,
      quality: 'reduced',
      fps: 30,
      fontUrl: '/fonts/geist.woff2',
      finish: clip().finish,
      look,
      content: (l) =>
        l.kind === 'text' ? { text: l.id === 'headline' ? 'Notes that\nfind you.' : 'INTRODUCING' } : undefined,
    });
    expect(r.graph.layers.size).toBe(s.layers.length);
    expect(r.chain.plan.blur?.samples).toBe(5);
    for (const t of [0, 400, 1500, 3000]) {
      const f = r.pose(t);
      expect(f.t).toBe(t);
    }
    expect(r.graph.layers.get('headline')!.children).toHaveLength(1);
    expect(() => r.render(0)).toThrow(/attach/);
    r.dispose();
  });

  it('shows saved particles and spreads depth for Show depth', async () => {
    const s = scene();
    const settings = { ...PARTICLE_DEFAULTS, bounce: false, amount: 20 };
    const bake = await bakeParticles({ settings, seed: 3, ms: 1000, fps: 30 });
    s.layers.push({
      id: 'p',
      kind: 'particles',
      depth: 'middle',
      start: 0,
      seed: 3,
      tracks: {},
      particles: { ...settings, bake },
    });
    const r = new V3Renderer(s, {
      width: 540,
      height: 960,
      quality: 'reduced',
      fps: 30,
      fontUrl: '/f.woff2',
      spread: true,
    });
    r.pose(500);
    expect(r.graph.depths.back.position.z).toBeLessThan(0);
    expect(r.graph.layers.get('p')!.children[0]).toBeInstanceOf(THREE.Points);
    r.dispose();
  });

  it('draws shapes, paths, charts, masks and rigs from their tracks, the same at the same t', () => {
    const s = scene();
    const host = { id: 'mascot', kind: 'shape' as const, depth: 'middle' as const, start: 0, tracks: {} };
    s.layers.push(
      {
        id: 'u',
        kind: 'path',
        depth: 'front',
        start: 0,
        tracks: {
          draw: [
            { t: 0, v: 0 },
            { t: 1000, v: 1 },
          ],
        },
      },
      {
        id: 'w',
        kind: 'shape',
        depth: 'front',
        start: 0,
        tracks: {
          mask: [
            { t: 0, v: 0 },
            { t: 1000, v: 1 },
          ],
        },
      },
      {
        id: 'b',
        kind: 'shape',
        depth: 'front',
        start: 0,
        tracks: {
          morph: [
            { t: 0, v: 0 },
            { t: 1000, v: 1 },
          ],
        },
      },
      { id: 'c', kind: 'chart', depth: 'front', start: 0, tracks: {} },
      ...chartLayers(
        { id: 'c', depth: 'front' },
        [
          { label: 'a', value: 3 },
          { label: 'b', value: 6 },
        ],
        CHART_DEFAULTS,
      ),
      host,
      ...rigLayers(host, autoRig({ w: 320, h: 200 }), { ...RIG_DEFAULTS, moves: { body: 'hop', 'arm-left': 'wave' } }),
    );
    const make = () =>
      new V3Renderer(s, {
        width: 540,
        height: 960,
        quality: 'reduced',
        fps: 30,
        fontUrl: '/f.woff2',
        content: (l) => (l.id === 'u' ? { path: 'M -100 0 L 100 0', strokeWidth: 10 } : undefined),
      });
    const r = make();
    const g = (id: string) => r.graph.layers.get(id)!;
    expect(g('u').children[0]).toBeInstanceOf(StrokeMesh);
    expect(g('c~bar~0').children[0]).toBeInstanceOf(ShapeMesh);
    expect(g('c').children).toHaveLength(0);
    expect(g('mascot~bone~body').children).toHaveLength(0);
    expect(g('c~count~1').children).toHaveLength(1);
    r.pose(500);
    const strokes = g('u').children[0] as StrokeMesh;
    expect(strokes.geometry.drawRange.count).toBe(6);
    const mask = (g('w').children[0] as ShapeMesh).material.clippingPlanes;
    expect(mask).toHaveLength(4);
    const bar = (g('c~bar~1').children[0] as ShapeMesh).geometry;
    bar.computeBoundingBox();
    const grown = bar.boundingBox!.max.y - bar.boundingBox!.min.y;
    const mascot = () => {
      const m = (g('mascot').children[0] as ShapeMesh).geometry;
      m.computeBoundingBox();
      return m.boundingBox!.clone();
    };
    const at500 = mascot();
    r.pose(2000);
    bar.computeBoundingBox();
    const full = (g('c~bar~1').children[0] as ShapeMesh).geometry;
    full.computeBoundingBox();
    expect(full.boundingBox!.max.y - full.boundingBox!.min.y).toBeGreaterThan(grown);
    expect((g('w').children[0] as ShapeMesh).material.clippingPlanes).toHaveLength(0);
    const again = make();
    again.pose(500);
    const m2 = (again.graph.layers.get('mascot')!.children[0] as ShapeMesh).geometry;
    m2.computeBoundingBox();
    expect(m2.boundingBox!.equals(at500)).toBe(true);
    r.dispose();
    again.dispose();
  });
});
