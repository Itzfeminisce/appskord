import { describe, expect, it } from 'vitest';
import { validateScene } from '../src/recipe';
import {
  autoRig,
  boneLayerId,
  boneLine,
  canRig,
  FOLLOW_MS,
  moveTracks,
  poseBones,
  rigOf,
  RIG_DEFAULTS,
  withRig,
  type RigSettings,
} from '../src/rigs';
import { frameAt } from '../src/scene';
import type { LayerV3, SceneV3 } from '../src/types';

const bones = autoRig({ w: 200, h: 240 });
const cup: LayerV3 = { id: 'cup', kind: 'shape', depth: 'front', start: 100, tracks: {} };
const scene = (layers: LayerV3[]): SceneV3 => ({
  version: 3,
  id: 's1',
  templateId: 'hero',
  ms: 3000,
  layers,
  camera: { move: 'hold', amount: 0 },
  transition: { kind: 'cut' },
});

describe('rig poses', () => {
  it('auto rigs a shape into Body, Arm left, Arm right and Lid; photos cannot be rigged', () => {
    expect(bones.map((b) => [b.name, boneLine(b)])).toEqual([
      ['Body', 'root · 3 joints'],
      ['Arm left', '2 joints'],
      ['Arm right', '2 joints'],
      ['Lid', '1 joint'],
    ]);
    expect(boneLine(bones[2]!, 'wave')).toBe('2 joints · Wave');
    expect(canRig({ kind: 'shape' })).toBe(true);
    expect(canRig({ kind: 'path' })).toBe(true);
    expect(canRig({ kind: 'media' })).toBe(false);
  });

  it('keys each move into the bone layer and reads the rig back', () => {
    const o: RigSettings = { moves: { 'arm-right': 'wave', body: 'hop' }, squash: 0.4, follow: true };
    const layers = withRig([cup, { id: 'title', kind: 'text', depth: 'front', tracks: {} }], 'cup', bones, o, 100);
    expect(layers.map((l) => l.id)).toEqual(['cup', ...bones.map((b) => boneLayerId('cup', b.id)), 'title']);
    const arm = layers.find((l) => l.id === 'cup~bone~arm-right')!;
    expect(arm.start).toBe(100 + FOLLOW_MS);
    expect(arm.tracks.opacity).toEqual([{ t: 0, v: 0 }]);
    expect(arm.tracks.rotate!.map((k) => k.v)).toEqual([0, 70, 40, 70, 40, 70, 0]);
    const body = layers.find((l) => l.id === 'cup~bone~body')!;
    expect(body.start).toBe(100);
    expect(Math.min(...body.tracks.scale!.map((k) => k.v))).toBeCloseTo(0.88, 10);
    expect(validateScene(scene(layers)).ok).toBe(true);
    expect(rigOf(layers, 'cup', bones)).toEqual(o);
    expect(rigOf([cup], 'cup', bones)).toBeUndefined();
    const still = withRig(layers, 'cup', bones, { ...RIG_DEFAULTS, follow: false, squash: 0 });
    expect(rigOf(still, 'cup', bones)).toEqual({ moves: {}, squash: 0.4, follow: false });
    expect(withRig([{ ...cup, kind: 'media' }], 'cup', bones, o)).toHaveLength(1);
  });

  it('mirrors a wave on the left arm and squashes a hop by the slider', () => {
    expect(moveTracks('wave', bones[1]!, 0).rotate![1]!.v).toBe(-70);
    expect(moveTracks('hop', bones[0]!, 0).scale!.every((k) => k.v === 1)).toBe(true);
    expect(moveTracks('hop', bones[0]!, 1).scale![1]!.v).toBeCloseTo(0.7, 10);
    expect(moveTracks(undefined, bones[0]!, 0)).toEqual({ rotate: [{ t: 0, v: 0 }] });
  });

  it('poses joints by forward kinematics; children turn with the body', () => {
    const rest = poseBones(bones, {});
    expect(rest.body).toEqual(bones[0]!.points.map(([x, y]) => [x, y + 0]));
    expect(rest['arm-right']![0]).toEqual(bones[2]!.points[0]);
    const lean = poseBones(bones, { body: { rotate: 90, y: 0, scale: 1 } });
    // The body tip has turned the whole 90°: its last segment now runs sideways.
    const [a, b] = lean.body.slice(-2);
    expect(Math.abs(b![1] - a![1])).toBeLessThan(1e-9);
    expect(lean.lid[0]![0]).toBeCloseTo(lean.body[3]![0], 9);
    expect(lean.lid[0]![1]).toBeCloseTo(lean.body[3]![1], 9);
    const lifted = poseBones(bones, { body: { rotate: 0, y: -80, scale: 1 } });
    expect(lifted['arm-left']![0]![1]).toBe(bones[1]!.points[0]![1] - 80);
  });

  it('poses from the recipe and t alone', () => {
    const layers = withRig([cup], 'cup', bones, { moves: { 'arm-right': 'wave' }, squash: 0.4, follow: false }, 100);
    const s = scene(layers);
    const pose = (t: number) => {
      const p = frameAt(s, t).layers.find((l) => l.id === 'cup~bone~arm-right')!.props;
      return poseBones(bones, { 'arm-right': { rotate: p.rotate, y: p.y, scale: p.scale } })['arm-right'];
    };
    expect(pose(350)).toEqual(pose(350));
    expect(frameAt(s, 350).layers[3]!.props.rotate).toBe(70);
    expect(pose(100)).toEqual(poseBones(bones, {})['arm-right']);
  });
});
