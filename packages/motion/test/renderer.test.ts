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
import { UNIT } from '../src/scene';
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

  it('rests each text layer at the centre of its layout box, inside the safe area', () => {
    const s = scene();
    const ids = s.layers.filter((l) => l.kind === 'text').map((l) => l.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const kicker = { x: 0.07, y: 0.16, w: 0.86, h: 0.04 };
    const r = new V3Renderer(s, {
      width: 1080,
      height: 1920,
      quality: 'reduced',
      fps: 30,
      fontUrl: '/fonts/geist.woff2',
      finish: clip().finish,
      look,
      // The second layer's box runs off the bottom: it is pulled back inside the safe area.
      content: (l) => {
        const i = ids.indexOf(l.id);
        if (i < 0) return undefined;
        return {
          text: 'Fresh sourdough',
          fontSize: 60,
          box: i === 0 ? kicker : { x: 0.07, y: 0.95, w: 0.86, h: 0.2 },
        };
      },
    });
    const still = new V3Renderer(s, {
      width: 1080,
      height: 1920,
      quality: 'reduced',
      fps: 30,
      fontUrl: '/fonts/geist.woff2',
      finish: clip().finish,
      look,
      content: (l) => (ids.includes(l.id) ? { text: 'Fresh sourdough', fontSize: 60 } : undefined),
    });
    r.pose(5000);
    still.pose(5000);
    const y = (v: V3Renderer, id: string) => -v.graph.layers.get(id)!.position.y / UNIT;
    // Without a box a layer sits where its tracks put it; with one, that far from the box's centre.
    expect(y(r, ids[0]!) - y(still, ids[0]!)).toBeCloseTo(-960 + 0.18 * 1920, 3);
    const bottom = 960 - 0.16 * 1920;
    expect(y(r, ids[1]!) - y(still, ids[1]!)).toBeLessThanOrEqual(bottom);
    expect(y(r, ids[1]!) - y(still, ids[1]!)).toBeGreaterThan(bottom - 100);
    r.dispose();
    still.dispose();
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
    const bar = g('c~bar~1').children[0] as ShapeMesh;
    const grown = bar.scale.y;
    const cut = bar.geometry.index;
    const mascot = () => {
      const m = (g('mascot').children[0] as ShapeMesh).geometry;
      m.computeBoundingBox();
      return m.boundingBox!.clone();
    };
    const at500 = mascot();
    r.pose(2000);
    // Bars grow by scaling about their bottom edge; the triangles are cut once.
    expect(bar.scale.y).toBeGreaterThan(grown);
    expect(bar.geometry.index).toBe(cut);
    expect((g('w').children[0] as ShapeMesh).material.clippingPlanes).toHaveLength(0);
    const again = make();
    again.pose(500);
    const m2 = (again.graph.layers.get('mascot')!.children[0] as ShapeMesh).geometry;
    m2.computeBoundingBox();
    expect(m2.boundingBox!.equals(at500)).toBe(true);
    r.dispose();
    again.dispose();
  });

  it('skips the edge of an empty outline instead of throwing', () => {
    const s = scene();
    s.layers.push({ id: 'i', kind: 'icon', depth: 'front', start: 0, tracks: {} });
    const r = new V3Renderer(s, {
      width: 540,
      height: 960,
      quality: 'reduced',
      fps: 30,
      fontUrl: '/f.woff2',
      content: (l) => (l.id === 'i' ? { path: 'M 0 0', stroke: '#fff', strokeWidth: 4 } : undefined),
    });
    expect(() => r.pose(100)).not.toThrow();
    expect(r.graph.layers.get('i')!.children.some((c) => c instanceof StrokeMesh)).toBe(false);
    r.dispose();
  });

  it('morphs and rigs in place: one geometry, positions moved, no re-cut', () => {
    const s = scene();
    const host = { id: 'm', kind: 'shape' as const, depth: 'middle' as const, start: 0, tracks: {} };
    s.layers.push(
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
      host,
      ...rigLayers(host, autoRig({ w: 320, h: 200 }), { ...RIG_DEFAULTS, moves: { body: 'lean' } }),
    );
    const r = new V3Renderer(s, { width: 540, height: 960, quality: 'reduced', fps: 30, fontUrl: '/f.woff2' });
    for (const id of ['b', 'm']) {
      const mesh = r.graph.layers.get(id)!.children[0] as ShapeMesh;
      r.pose(100);
      const position = mesh.geometry.getAttribute('position');
      const before = [...(position.array as Float32Array)];
      r.pose(700);
      expect(mesh.geometry.getAttribute('position')).toBe(position);
      expect([...(position.array as Float32Array)]).not.toEqual(before);
    }
    r.dispose();
  });

  it('ready() waits for every text still typesetting', async () => {
    const s = scene();
    const r = new V3Renderer(s, {
      width: 540,
      height: 960,
      quality: 'reduced',
      fps: 30,
      fontUrl: '/f.woff2',
      content: (l) => (l.kind === 'text' ? { text: 'Two words' } : undefined),
    });
    r.pose(0);
    // Mark one unit as mid-typeset, the way troika leaves a text whose string just changed.
    const unit = r.graph.layers.get('headline')!.children[0]!.children[0] as THREE.Object3D & {
      _needsSync?: boolean;
      sync: (cb?: () => void) => void;
    };
    let finish: (() => void) | undefined;
    unit._needsSync = true;
    unit.sync = (cb) => {
      finish = cb;
    };
    let done = false;
    const waiting = r.ready().then(() => {
      done = true;
    });
    await new Promise((res) => setTimeout(res, 10));
    expect(done).toBe(false);
    finish!();
    await waiting;
    expect(done).toBe(true);
    r.dispose();
  });
});
