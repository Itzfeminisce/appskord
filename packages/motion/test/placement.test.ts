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
import { CLEAR, cameraLimit, freeSpot, limitPose } from '../src/placement';
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

describe('cameraLimit', () => {
  const pan = (amount: number): CameraPose[] => [0, 1].map((progress) => cameraAt({ move: 'pan', amount, progress }));
  it('keeps the whole move when text has room, and cuts it back when text sits at the edge', () => {
    const middle = { rect: { x: -100, y: -50, width: 200, height: 100 }, depth: 'front' as const };
    expect(cameraLimit([middle], pan(0.5), safe)).toBe(1);
    const edge = { rect: { x: safe.x + 20, y: -50, width: 300, height: 100 }, depth: 'front' as const };
    const k = cameraLimit([edge], pan(0.5), safe);
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(1);
    for (const p of pan(0.5)) {
      const x = -limitPose(p, k).x;
      expect(edge.rect.x + x).toBeGreaterThanOrEqual(safe.x - 0.6);
    }
  });

  it('holds a push-in so a wide block never grows past the safe area', () => {
    const wide = { rect: { x: safe.x + 10, y: -50, width: safe.width - 20, height: 100 }, depth: 'front' as const };
    const push = [0, 1].map((progress) => cameraAt({ move: 'push-in', amount: 0.4, progress }));
    const k = cameraLimit([wide], push, safe);
    const zoom = limitPose(push[1]!, k).zoom;
    expect(wide.rect.x * zoom).toBeGreaterThanOrEqual(safe.x - 0.6);
    // Behind the text a layer moves less, so a back block barely limits the move.
    expect(cameraLimit([{ ...wide, depth: 'back' }], push, safe)).toBeGreaterThan(k);
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

  it('cuts a pan back so text at the safe edge stays inside through the scene', () => {
    const box = { x: 0.07, y: 0.4, w: 0.4, h: 0.1 };
    const r = new V3Renderer(base([text('t')], { move: 'pan', amount: 1 }), {
      ...options,
      measure: () => (w: string) => w.length * 30,
      content: () => ({ text: 'Fresh bread', fontSize: 60, box, align: 'left' }),
    });
    for (const t of [0, 1500, 2950]) {
      r.pose(t);
      const front = r.graph.depths.front.position.x / UNIT;
      expect(at(r, 't').x - 165 + front).toBeGreaterThanOrEqual(safe.x - 1);
    }
    r.dispose();
  });
});
