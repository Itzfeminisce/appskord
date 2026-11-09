import { expect, test } from 'vitest';
import { depthShadow, extrudeOptions, GUIDE_LIGHT, keyLight, lightLabel } from '../src/light';

test('the pad dot names where the light comes from', () => {
  expect(lightLabel({ x: -0.7, y: 0.7 })).toBe('Top left');
  expect(lightLabel(GUIDE_LIGHT.right!)).toBe('Right');
  expect(lightLabel(GUIDE_LIGHT.top!)).toBe('Top');
  expect(GUIDE_LIGHT.none).toBeNull();
});

test('one key light from the dot, shadows only when on', () => {
  const l = keyLight({ x: -0.7, y: 0.7 }, true);
  expect(l.position.x).toBeLessThan(0);
  expect(l.position.y).toBeGreaterThan(0);
  expect(l.castShadow).toBe(true);
  expect(keyLight({ x: 0, y: 1 }, false).castShadow).toBe(false);
});

test('depth shadows fall away from the light onto the layer behind; back casts none', () => {
  const s = depthShadow('front', { x: -0.7, y: 0.7 })!;
  expect(s.dx).toBeGreaterThan(0);
  expect(s.dy).toBeGreaterThan(0);
  expect(depthShadow('middle', { x: -0.7, y: 0.7 })!.dx).toBeLessThan(s.dx);
  expect(depthShadow('back', { x: 0, y: 1 })).toBeNull();
  expect(depthShadow('front', null)).toBeNull();
});

test('bevels', () => {
  expect(extrudeOptions(24, 'none').bevelEnabled).toBe(false);
  expect(extrudeOptions(24, 'soft').bevelSegments).toBeGreaterThan(extrudeOptions(24, 'sharp').bevelSegments!);
});
