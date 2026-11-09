import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

const made: { dispose: ReturnType<typeof vi.fn> }[] = [];
vi.mock('../src/text', () => ({
  Text: class extends THREE.Object3D {
    clipRect: unknown = null;
    fillOpacity = 1;
    sync = vi.fn();
    dispose = vi.fn();
    constructor() {
      super();
      made.push(this);
    }
  },
}));

import { applyMask, maskReveal } from '../src/masks';
import { morpher } from '../src/morph';
import { parsePath } from '../src/paths';
import { UNIT } from '../src/scene';
import { AxisText, KineticType, safeArea, unitProgress, type AxisFont } from '../src/type';

const box = { x: 0, y: 0, width: 100, height: 50 };
const font: AxisFont = {
  tables: { fvar: { axes: [{ tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900 }] } },
  getPath: vi.fn(() => ({
    commands: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }, { type: 'L', x: 10, y: 10 }, { type: 'Z' }],
  })),
  getAdvanceWidth: () => 10,
} as unknown as AxisFont;

describe('dispose', () => {
  it('KineticType removes and disposes every text', () => {
    made.length = 0;
    const k = new KineticType('ab cd', 'word', { measure: (s) => s.length * 10, fontSize: 40, fontUrl: '/f.ttf' });
    expect(k.children).toHaveLength(2);
    k.dispose();
    expect(k.children).toHaveLength(0);
    expect(made.every((t) => t.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('KineticType places words from the typeset carets once synced', async () => {
    made.length = 0;
    const k = new KineticType('ab cd', 'word', { measure: (s) => s.length * 100, fontSize: 40, fontUrl: '/f.ttf' });
    expect(k.boxes[0]!.x).toBe(-250);
    const line = made[2] as unknown as { textRenderInfo: unknown };
    const carets = new Float32Array(5 * 4);
    for (let i = 0; i < 5; i++) [carets[i * 4], carets[i * 4 + 1]] = [i * 10 * UNIT, (i + 1) * 10 * UNIT];
    line.textRenderInfo = { blockBounds: [0, -40 * UNIT, 50 * UNIT, 0], caretPositions: carets };
    await k.ready();
    expect(k.boxes.map((b) => [b.text, b.x, b.width].map((v) => (typeof v === 'number' ? Math.round(v) : v)))).toEqual([
      ['ab', -25, 20],
      ['cd', 5, 20],
    ]);
    expect(k.children[1]!.position.x).toBeCloseTo(5 * UNIT, 6);
    k.dispose();
  });

  it('KineticType wraps to the safe area, centres the block, breaks a too-wide word and shrinks a tall block', () => {
    made.length = 0;
    const area = { width: 300, height: 1000 };
    const k = new KineticType('ab cd ef', 'word', {
      measure: (s) => s.length * 100,
      fontSize: 40,
      fontUrl: '/f.ttf',
      area,
    });
    expect(k.boxes.map((b) => [b.text, b.line])).toEqual([
      ['ab', 0],
      ['cd', 1],
      ['ef', 2],
    ]);
    expect(k.scale.x).toBe(1);
    expect(k.bounds()).toEqual({ x: -100, y: -66, width: 200, height: 132 });
    expect(k.children[0]!.position.y).toBeCloseTo(66 * UNIT, 6);
    const wide = new KineticType('abcdefgh', 'word', {
      measure: (s) => s.length * 100,
      fontSize: 40,
      fontUrl: '/f.ttf',
      area: { width: 300, height: 100 },
    });
    expect(wide.boxes.map((b) => [b.text, b.line, b.order])).toEqual([
      ['abc', 0, 0],
      ['def', 1, 0],
      ['gh', 2, 0],
    ]);
    expect(wide.scale.x).toBeCloseTo(100 / 132, 6);
    // No fill and no area: the scale is left alone; a frame with no size never hides the words.
    const free = new KineticType('ab', 'word', { measure: (s) => s.length * 100, fontSize: 40, fontUrl: '/f.ttf' });
    expect(free.scale.x).toBe(1);
    const empty = new KineticType('ab', 'word', {
      measure: (s) => s.length * 100,
      fontSize: 40,
      fontUrl: '/f.ttf',
      area: safeArea(0, 0),
    });
    expect(empty.scale.x).toBe(1);
    expect(Number.isFinite(empty.bounds().width)).toBe(true);
    k.dispose();
    wide.dispose();
    free.dispose();
    empty.dispose();
  });

  it('AxisText disposes geometry and material', () => {
    const a = new AxisText(font, 'x', 40);
    const g = vi.spyOn(a.geometry, 'dispose');
    const m = vi.spyOn(a.material, 'dispose');
    a.dispose();
    expect(g).toHaveBeenCalled();
    expect(m).toHaveBeenCalled();
  });

  it('AxisText quantises and memoises axis cuts', () => {
    const calls = (font.getPath as ReturnType<typeof vi.fn>).mock.calls.length;
    const a = new AxisText(font, 'x', 40);
    a.update({ weight: 501 });
    a.update({ weight: 504 });
    a.update({ weight: 400 });
    expect((font.getPath as ReturnType<typeof vi.fn>).mock.calls.length - calls).toBe(2);
  });
});

describe('NaN safety', () => {
  it('unitProgress treats NaN and a zero duration safely', () => {
    expect(unitProgress(2, 'word', Number.NaN)).toEqual([0, 0]);
    expect(unitProgress(1, 'word', 10, 0)).toEqual([1]);
  });
  it('maskReveal treats NaN as 0', () => {
    expect(maskReveal(box, Number.NaN).visible.width).toBe(0);
  });
  it('applyMask treats a non-finite mask as fully shown', () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    g.userData.mask = Number.NaN;
    applyMask(g, box);
    expect(((g.children[0] as THREE.Mesh).material as THREE.Material).clippingPlanes).toEqual([]);
  });
});

describe('morpher', () => {
  it('holds the nearer end for rings under 3 points', () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 1],
    ];
    const tri: [number, number][] = [
      [0, 0],
      [10, 0],
      [5, 9],
    ];
    const at = morpher(line, tri);
    expect(at(0.2)).toEqual(line);
    expect(at(0.8)).toEqual(tri);
  });
});

describe('parsePath', () => {
  it('starts a new subpath at the start point after Z', () => {
    const p = parsePath('M0 0 L10 0 L10 10 Z L5 5');
    expect(p).toHaveLength(2);
    expect(p[0]?.at(-1)).toEqual([0, 0]);
    expect(p[1]).toEqual([
      [0, 0],
      [5, 5],
    ]);
  });
  it('names the command when operands are missing', () => {
    expect(() => parsePath('M0 0 L10')).toThrow(/command L/);
    expect(() => parsePath('M0 0 C1 1 2 2 L3 3')).toThrow(/command C/);
  });
});

describe('fontUrl', () => {
  const opts = { measure: () => 1, fontSize: 40 };
  it('rejects remote and relative font URLs', () => {
    expect(() => new KineticType('a', 'letter', { ...opts, fontUrl: 'https://x.com/f.ttf' })).toThrow(/fontUrl/);
    expect(() => new KineticType('a', 'letter', { ...opts, fontUrl: 'f.ttf' })).toThrow(/extension-local/);
  });
  it('accepts extension-local URLs', () => {
    expect(() => new KineticType('a', 'letter', { ...opts, fontUrl: 'chrome-extension://id/f.ttf' })).not.toThrow();
  });
});
