import * as THREE from 'three';
import { UNIT } from './scene';

/** Which way the mask moves as it uncovers the layer; MotionV3 draws a left-to-right reveal. */
export type MaskFrom = 'left' | 'right' | 'top' | 'bottom';
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp01 = (x: number): number => (x > 0 ? (x >= 1 ? 1 : x) : 0);

/** The uncovered part of a layer's box at mask progress 0..1 (the layer's `mask` track), and where the moving edge is. Recipe units, y down. */
export function maskReveal(box: Box, mask: number, from: MaskFrom = 'left'): { visible: Box; edge: number } {
  const p = clamp01(mask);
  const { x, y, width: w, height: h } = box;
  if (from === 'left') return { visible: { x, y, width: w * p, height: h }, edge: x + w * p };
  if (from === 'right') return { visible: { x: x + w * (1 - p), y, width: w * p, height: h }, edge: x + w * (1 - p) };
  if (from === 'top') return { visible: { x, y, width: w, height: h * p }, edge: y + h * p };
  return { visible: { x, y: y + h * (1 - p), width: w, height: h * p }, edge: y + h * (1 - p) };
}

/** Masked line entrance (MotionV3 "Masked, 120 ms a line"): the line rises out of its own box, from one line height below. */
export function lineRise(progress: number, lineHeight: number): number {
  return (1 - clamp01(progress)) * lineHeight;
}

/**
 * Clipping planes that keep only `visible` in a layer group's local space, for `material.clippingPlanes`
 * (needs `renderer.localClippingEnabled`). Planes are in world space, so pass the group's world matrix.
 */
export function maskPlanes(visible: Box, matrixWorld: THREE.Matrix4 = new THREE.Matrix4()): THREE.Plane[] {
  const x0 = visible.x * UNIT;
  const x1 = (visible.x + visible.width) * UNIT;
  const y0 = -visible.y * UNIT;
  const y1 = -(visible.y + visible.height) * UNIT;
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -x0),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), x1),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), y0),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -y1),
  ].map((plane) => plane.applyMatrix4(matrixWorld));
}

/** Puts a mask reveal on every material under a layer group, from the state applyFrame left in its userData. */
export function applyMask(group: THREE.Object3D, box: Box, from: MaskFrom = 'left'): void {
  const raw = (group.userData.mask as number | undefined) ?? 1;
  const mask = Number.isFinite(raw) ? raw : 1;
  const planes = mask >= 1 ? [] : maskPlanes(maskReveal(box, mask, from).visible, group.matrixWorld);
  group.traverse((o) => {
    const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) m.clippingPlanes = planes;
  });
}
