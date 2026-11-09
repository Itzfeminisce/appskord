import { describe, expect, test } from 'vitest';
import {
  CAMERA_DISTANCE,
  cameraAt,
  cameraLabel,
  focusDepth,
  focusDistance,
  ORBIT_SPAN,
  PAN_SPAN,
  rackFrom,
} from '../src/camera';
import { applyCamera, depthLabel, depthPose, scenePose } from '../src/depth';
import { buildGraph, frameAt, UNIT } from '../src/scene';
import type { CameraMove } from '../src/types';
import { scene } from './fixture';

const cam = (move: CameraMove, amount: number, progress: number) => ({ move, amount, progress });
const ends = (move: CameraMove, amount: number) => [0, 0.5, 1].map((p) => cameraAt(cam(move, amount, p)));

describe('camera paths', () => {
  test('push in grows the front layer by the amount; pull out comes back from it', () => {
    expect(ends('push-in', 0.04).map((c) => c.zoom)).toEqual([1, expect.any(Number), 1.04]);
    expect(ends('pull-out', 0.04).map((c) => c.zoom)).toEqual([1.04, expect.any(Number), 1]);
    const mid = cameraAt(cam('push-in', 0.04, 0.5)).zoom;
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(1.04);
  });
  test('pan travels amount × PAN_SPAN, centred, sign is direction', () => {
    expect(ends('pan', 1).map((c) => c.x)).toEqual([-PAN_SPAN / 2, expect.any(Number), PAN_SPAN / 2]);
    expect(cameraAt(cam('pan', -0.5, 1)).x).toBe(-PAN_SPAN / 4);
  });
  test('orbit sweeps amount × ORBIT_SPAN degrees about the centre', () => {
    expect(ends('orbit', 0.4).map((c) => c.yaw)).toEqual([-6, expect.any(Number), 6]);
    expect(Math.abs(ends('orbit', 0.4)[2]!.yaw - ends('orbit', 0.4)[0]!.yaw)).toBeCloseTo(0.4 * ORBIT_SPAN);
  });
  test('hold never moves', () => {
    for (const c of ends('hold', 1)) expect(c).toEqual({ x: 0, y: 0, zoom: 1, yaw: 0, focus: 1 });
  });
  test('the feel shapes the path but not its ends', () => {
    const smooth = cameraAt(cam('pan', 1, 0.25), 'front', 'smooth').x;
    const steady = cameraAt(cam('pan', 1, 0.25), 'front', 'steady').x;
    expect(smooth).not.toBe(steady);
    expect(cameraAt(cam('pan', 1, 1), 'front', 'bouncy').x).toBeCloseTo(PAN_SPAN / 2);
  });
});

describe('rack focus', () => {
  test('focus distance racks from the far end of the stack to the focus layer', () => {
    expect(rackFrom('front')).toBe('back');
    expect(rackFrom('back')).toBe('front');
    const start = cameraAt(cam('rack-focus', 0, 0), 'front');
    const end = cameraAt(cam('rack-focus', 0, 1), 'front');
    expect(focusDistance(start)).toBeCloseTo(CAMERA_DISTANCE / 0.3);
    expect(focusDistance(end)).toBeCloseTo(CAMERA_DISTANCE);
    expect(focusDistance(cameraAt(cam('rack-focus', 0, 1), 'middle'))).toBeCloseTo(CAMERA_DISTANCE / 0.6);
    const mid = focusDistance(cameraAt(cam('rack-focus', 0, 0.5), 'front'));
    expect(mid).toBeLessThan(CAMERA_DISTANCE / 0.3);
    expect(mid).toBeGreaterThan(CAMERA_DISTANCE);
  });
  test('the scene focus layer picks the depth', () => {
    const s = scene();
    expect(focusDepth(s)).toBe(s.layers.find((l) => l.id === 'headline')!.depth);
    expect(focusDepth({ ...s, camera: { move: 'hold', amount: 0 } })).toBe('front');
  });
});

describe('parallax', () => {
  test('further back moves less: offsets and zoom scale 1 / 0.6 / 0.3', () => {
    const pan = cameraAt(cam('pan', 1, 1));
    expect(depthPose('front', pan).x).toBeCloseTo(-270);
    expect(depthPose('middle', pan).x).toBeCloseTo(-162);
    expect(depthPose('back', pan).x).toBeCloseTo(-81);
    const push = cameraAt(cam('push-in', 0.1, 1));
    expect(['front', 'middle', 'back'].map((d) => depthPose(d as 'front', push).scale)).toEqual([
      1.1,
      expect.closeTo(1.06),
      expect.closeTo(1.03),
    ]);
  });
  test('an orbit slides layers either side of the focus in opposite directions', () => {
    const o = cameraAt(cam('orbit', 1, 1), 'middle');
    expect(depthPose('middle', o).x).toBeCloseTo(0);
    expect(Math.sign(depthPose('front', o).x)).toBe(-Math.sign(depthPose('back', o).x));
  });
  test('depth blur grows away from the focus; strength 0 is all sharp', () => {
    const pose = cameraAt(cam('hold', 0, 0), 'front');
    expect(depthPose('front', pose).blur).toBe(0);
    expect(depthPose('back', pose).blur).toBeCloseTo(1);
    expect(depthPose('back', pose, 0).blur).toBe(0);
    expect(depthLabel('front', pose)).toBe('Front · moves 1.0× · sharp (focus)');
    expect(depthLabel('middle', pose)).toBe('Middle · moves 0.6× · slight blur');
    expect(depthLabel('back', pose)).toBe('Back · moves 0.3× · soft blur');
  });
  test('applyCamera moves each depth group of the graph', () => {
    const s = { ...scene(), camera: { move: 'pan' as const, amount: 1 } };
    const g = buildGraph(s);
    applyCamera(g, scenePose(s, frameAt(s, s.ms)));
    expect(g.depths.front.position.x).toBeCloseTo(-270 * UNIT);
    expect(g.depths.back.position.x).toBeCloseTo(-81 * UNIT);
    applyCamera(g, scenePose(s, frameAt(s, s.ms)), 1, true);
    expect(g.depths.back.position.z).toBeLessThan(g.depths.front.position.z);
  });
});

test('labels read as in the frames', () => {
  expect(cameraLabel('push-in', 0.04, 'smooth')).toBe('Push in · 4% · Smooth');
  expect(cameraLabel('orbit', 0.4, 'smooth')).toBe('Orbit · 12° · Smooth');
  expect(cameraLabel('hold', 0, 'steady')).toBe('Hold · Steady');
});
