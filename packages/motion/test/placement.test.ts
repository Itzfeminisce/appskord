import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/text', () => ({
  Text: class extends THREE.Object3D {
    clipRect: unknown = null;
    fillOpacity = 1;
    color = '';
    sync = vi.fn();
    dispose = vi.fn();
  },
}));

import { cameraAt, type CameraPose } from '../src/camera';
import { depthPose } from '../src/depth';
import { CLEAR, freeSpot, mapSlot, MIN_INSET_SHARE, travelSafe, union } from '../src/placement';
import { V3Renderer } from '../src/renderer';
import { UNIT } from '../src/scene';
import { safeRect, type Rect } from '../src/type';
import type { LayerV3, SceneV3 } from '../src/types';

const safe = safeRect(1080, 1920);
const hits = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('freeSpot', () => {
  it('rests a block clear of the text boxes, inside the area', () => {
    const text: Rect = { x: -400, y: -300, width: 800, height: 600 };
    const s = freeSpot({ width: 320, height: 200 }, [text], safe);
    expect(s.scale).toBe(1);
    const block = { x: s.x - 160 - CLEAR + 1, y: s.y - 100 - CLEAR + 1, width: 318, height: 198 };
    expect(hits(block, text)).toBe(false);
    expect(s.x - 160).toBeGreaterThanOrEqual(safe.x - 1e-6);
    expect(s.y + 100).toBeLessThanOrEqual(safe.y + safe.height + 1e-6);
  });

  it('shrinks to fit a gap, and settles for the least overlap when nothing clears', () => {
    const top: Rect = { x: safe.x, y: safe.y, width: safe.width, height: safe.height / 2 - 70 };
    const bottom: Rect = { x: safe.x, y: 70, width: safe.width, height: safe.height / 2 };
    expect(freeSpot({ width: 320, height: 200 }, [top, bottom], safe).scale).toBeLessThan(1);
    const all = freeSpot({ width: 320, height: 200 }, [safe], safe);
    expect(all.scale).toBe(0.35);
  });
});

describe('travelSafe', () => {
  const pan = (amount: number): CameraPose[] => [0, 1].map((progress) => cameraAt({ move: 'pan', amount, progress }));
  const shows = (x: number, p: CameraPose) => x * depthPose('front', p).scale + depthPose('front', p).x;

  it('keeps the whole pan and insets text so neither end carries it out', () => {
    const inner = travelSafe(safe, pan(0.5), 'front');
    expect(inner.width).toBeLessThan(safe.width);
    expect(inner.width).toBeCloseTo(safe.width - 0.5 * 540, 6);
    for (const p of pan(0.5)) {
      expect(Math.abs(p.x)).toBeCloseTo(135, 6);
      expect(shows(inner.x, p)).toBeGreaterThanOrEqual(safe.x - 1e-6);
      expect(shows(inner.x + inner.width, p)).toBeLessThanOrEqual(safe.x + safe.width + 1e-6);
    }
    expect(inner.height).toBe(safe.height);
  });

  it('shrinks for a push-in so the grown text stays inside, and less for a deeper layer', () => {
    const push = [0, 1].map((progress) => cameraAt({ move: 'push-in', amount: 0.4, progress }));
    const front = travelSafe(safe, push, 'front');
    expect(front.x * 1.4).toBeCloseTo(safe.x, 6);
    expect(travelSafe(safe, push, 'back').width).toBeGreaterThan(front.width);
  });

  it('is the safe area itself for a hold, and keeps at least half of it for a huge move', () => {
    expect(travelSafe(safe, [cameraAt({ move: 'hold', amount: 0, progress: 0 })], 'front')).toEqual(safe);
    expect(travelSafe(safe, pan(4), 'front').width).toBeCloseTo(safe.width * MIN_INSET_SHARE, 6);
  });
});

describe('mapSlot', () => {
  it('carries a layout box into the inset area by the same stretch', () => {
    const from: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const into: Rect = { x: 10, y: 20, width: 50, height: 80 };
    expect(mapSlot({ x: 50, y: 0, width: 50, height: 100 }, from, into)).toEqual({
      x: 35,
      y: 20,
      width: 25,
      height: 80,
    });
    expect(mapSlot(from, from, from)).toEqual(from);
  });
});

describe('union', () => {
  it('bounds every rect, and is undefined for none', () => {
    expect(union([])).toBeUndefined();
    expect(
      union([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: -5, width: 5, height: 5 },
      ]),
    ).toEqual({ x: 0, y: -5, width: 25, height: 15 });
  });
});

const text = (id: string): LayerV3 => ({ id, kind: 'text', depth: 'front', tracks: {} });
const base = (layers: LayerV3[], camera: SceneV3['camera'] = { move: 'hold', amount: 0 }): SceneV3 => ({
  version: 3,
  id: 's',
  templateId: 't',
  ms: 3000,
  layers,
  camera,
  transition: { kind: 'cut' },
});
const options = { width: 1080, height: 1920, quality: 'reduced' as const, fps: 30, fontUrl: '/fonts/test.woff2' };
const at = (r: V3Renderer, id: string) => {
  const g = r.graph.layers.get(id)!;
  return { x: g.position.x / UNIT, y: -g.position.y / UNIT };
};

describe('V3Renderer placement', () => {
  it('places a layer the template adds off the text, behind it, and a count in its own spot', () => {
    const box = { x: 0.07, y: 0.3, w: 0.86, h: 0.3 };
    const blob: LayerV3 = { id: 'blob', kind: 'shape', depth: 'back', tracks: {} };
    const count: LayerV3 = { id: 'count', kind: 'chart', depth: 'front', tracks: {}, count: { from: 0, to: 2400 } };
    const s = base([text('words'), blob, count]);
    const r = new V3Renderer(s, {
      ...options,
      content: (l) => (l.id === 'words' ? { text: 'Rest for a day', fontSize: 60, box } : undefined),
    });
    r.pose(1500);
    const words = { x: (box.x - 0.5) * 1080, y: (box.y - 0.5) * 1920, width: box.w * 1080, height: box.h * 1920 };
    const b = at(r, 'blob');
    expect(hits({ x: b.x - 160, y: b.y - 100, width: 320, height: 200 }, words)).toBe(false);
    const c = at(r, 'count');
    // A count draws one line above its origin.
    expect(hits({ x: c.x - 360, y: c.y - 120, width: 720, height: 120 }, words)).toBe(false);
    const order = (id: string) => (r.graph.layers.get(id)!.children[0] as THREE.Object3D).renderOrder;
    expect(order('blob')).toBeLessThan(order('words'));
    r.dispose();
  });

  it('lines text up on its box edge for align and valign', () => {
    const box = { x: 0.1, y: 0.2, w: 0.8, h: 0.4 };
    const make = (c: { align?: 'left' | 'right'; valign?: 'top' }) => {
      const r = new V3Renderer(base([text('t')]), {
        ...options,
        measure: () => (w: string) => w.length * 30,
        content: () => ({ text: 'Fresh', fontSize: 60, box, ...c }),
      });
      r.pose(1500);
      const p = at(r, 't');
      r.dispose();
      return p;
    };
    const left = (box.x - 0.5) * 1080;
    const right = left + box.w * 1080;
    expect(make({ align: 'left' }).x).toBeCloseTo(left + 75);
    expect(make({ align: 'right' }).x).toBeCloseTo(right - 75);
    expect(make({}).x).toBeCloseTo((left + right) / 2);
    expect(make({ valign: 'top' }).y).toBeCloseTo((box.y - 0.5) * 1920 + 33);
  });

  it('keeps the whole pan and rests text inset by its travel, inside the safe area through the scene', () => {
    const box = { x: 0.07, y: 0.4, w: 0.4, h: 0.1 };
    const r = new V3Renderer(base([text('t')], { move: 'pan', amount: 0.5 }), {
      ...options,
      measure: () => (w: string) => w.length * 30,
      content: () => ({ text: 'Fresh bread', fontSize: 60, box, align: 'left' }),
    });
    const fronts: number[] = [];
    for (const t of [0, 1500, 3000]) {
      r.pose(t);
      const front = r.graph.depths.front.position.x / UNIT;
      fronts.push(front);
      const half = (r.graph.layers.get('t')!.children[0] as unknown as { bounds(): Rect }).bounds().width / 2;
      expect(at(r, 't').x - half + front).toBeGreaterThanOrEqual(safe.x - 1);
      expect(at(r, 't').x + half + front).toBeLessThanOrEqual(safe.x + safe.width + 1);
    }
    // The pan is not cut back: the front layer travels the full 270 px.
    expect(fronts[0]! - fronts[2]!).toBeCloseTo(270, 0);
    r.dispose();
  });

  it("counts a text layer's own number up in place, and leaves text without a number alone", () => {
    const shown = (words: string, t: number) => {
      const layer: LayerV3 = {
        ...text('n'),
        count: { from: 0 },
        tracks: {
          draw: [
            { t: 0, v: 0 },
            { t: 1000, v: 1 },
          ],
        },
      };
      const r = new V3Renderer(base([layer]), { ...options, content: () => ({ text: words, fontSize: 60 }) });
      r.pose(t);
      const k = r.graph.layers.get('n')!.children[0]!;
      const out = (k.children[0] as unknown as { text: string }).text;
      r.dispose();
      return out;
    };
    expect(shown('1,200', 0)).toBe('0');
    const mid = Number(shown('1,200', 500).replace(/,/g, ''));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1200);
    expect(shown('1,200', 1000)).toBe('1,200');
    expect(shown('$4.5k', 0)).toBe('$0.0k');
    expect(shown('$4.5k', 1000)).toBe('$4.5k');
    expect(shown('98%', 0)).toBe('0%');
    expect(shown('Since dawn', 500)).toBe('Since dawn');
  });

  it('sits a backing panel behind the text it backs, sized to the block plus padding', () => {
    const box = { x: 0.1, y: 0.3, w: 0.8, h: 0.1 };
    const kicker: LayerV3 = { ...text('k'), slotId: 'kicker' };
    const glass: LayerV3 = { id: 'glass', kind: 'shape', depth: 'back', tracks: {} };
    const r = new V3Renderer(base([kicker, glass]), {
      ...options,
      measure: () => (w: string) => w.length * 30,
      content: (l) => (l.id === 'k' ? { text: 'Fresh', fontSize: 60, box } : { backs: ['kicker'] }),
    });
    r.pose(1500);
    expect(at(r, 'glass').x).toBeCloseTo(at(r, 'k').x);
    expect(at(r, 'glass').y).toBeCloseTo(at(r, 'k').y);
    const mesh = r.graph.layers.get('glass')!.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    mesh.geometry.boundingBox!.getSize(size);
    const pad = 1080 * 0.04;
    expect(size.x / UNIT).toBeCloseTo(150 + 2 * pad, 0);
    expect(size.y / UNIT).toBeCloseTo(66 + 2 * pad, 0);
    const order = (id: string) => (r.graph.layers.get(id)!.children[0] as THREE.Object3D).renderOrder;
    expect(order('glass')).toBeLessThan(order('k'));
    // It moves with the text under the camera, so parallax never slides it out from behind.
    expect(r.graph.layers.get('glass')!.parent).toBe(r.graph.depths.front);
    r.dispose();
  });
});
