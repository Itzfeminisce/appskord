import * as THREE from 'three';
import { CAMERA_DISTANCE } from './camera';
import { UNIT } from './scene';
import { PARALLAX } from './types';
import type { Depth, LookGuide } from './types';

/** Where the key light comes from on the "Light from" pad: x right, y up, both -1..1. */
export interface LightDot {
  x: number;
  y: number;
}
export type Material = 'matte' | 'gloss' | 'glass' | 'metal';
export type Bevel = 'none' | 'soft' | 'sharp';
export const MATERIAL_LABELS: Readonly<Record<Material, string>> = {
  matte: 'Matte',
  gloss: 'Gloss',
  glass: 'Glass',
  metal: 'Metal',
};
export const BEVEL_LABELS: Readonly<Record<Bevel, string>> = { none: 'None', soft: 'Soft', sharp: 'Sharp' };

/** The look guide's light as a dot; "none" has no key light. */
export const GUIDE_LIGHT: Readonly<Record<LookGuide['light'], LightDot | null>> = {
  left: { x: -0.8, y: 0.3 },
  right: { x: 0.8, y: 0.3 },
  top: { x: 0, y: 0.85 },
  none: null,
};

/** Unit direction toward the light in world space (z toward the viewer). */
export function lightDirection(dot: LightDot): THREE.Vector3 {
  return new THREE.Vector3(dot.x, dot.y, 1).normalize();
}

/** "Top left", "Right", "Front" for the pad's dot. */
export function lightLabel(dot: LightDot): string {
  const v = dot.y > 0.33 ? 'top' : dot.y < -0.33 ? 'bottom' : '';
  const h = dot.x > 0.33 ? 'right' : dot.x < -0.33 ? 'left' : '';
  const words = [v, h].filter(Boolean).join(' ') || 'front';
  return words[0]!.toUpperCase() + words.slice(1);
}

/** One key light from the look guide's direction, with soft shadows when `shadow` is on. */
export function keyLight(dot: LightDot, shadow: boolean): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xfff4e8, 2.4);
  light.position.copy(lightDirection(dot).multiplyScalar(CAMERA_DISTANCE));
  light.castShadow = shadow;
  if (shadow) {
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.radius = 6;
    light.shadow.bias = -0.0005;
    const c = light.shadow.camera;
    c.left = c.bottom = -8;
    c.right = c.top = 8;
  }
  return light;
}

/** Physical material settings for the 3D text materials. */
export const MATERIALS: Readonly<Record<Material, THREE.MeshPhysicalMaterialParameters>> = {
  matte: { roughness: 0.9, metalness: 0 },
  gloss: { roughness: 0.25, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1 },
  glass: { roughness: 0.05, metalness: 0, transmission: 1, thickness: 0.6, ior: 1.5 },
  metal: { roughness: 0.3, metalness: 1 },
};

export function material(kind: Material, color: THREE.ColorRepresentation): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ ...MATERIALS[kind], color });
}

/** ExtrudeGeometry options for 3D text `depth` recipe px deep with a bevel. */
export function extrudeOptions(depth: number, bevel: Bevel): THREE.ExtrudeGeometryOptions {
  const d = depth * UNIT;
  if (bevel === 'none') return { depth: d, bevelEnabled: false, curveSegments: 6 };
  return {
    depth: d,
    bevelEnabled: true,
    bevelThickness: d * 0.2,
    bevelSize: d * (bevel === 'soft' ? 0.12 : 0.08),
    bevelSegments: bevel === 'soft' ? 4 : 1,
    curveSegments: 6,
  };
}

/** Recipe px a layer's shadow reaches per unit of parallax gap to the layer behind. */
export const SHADOW_REACH = 60;
const BEHIND: Readonly<Record<Depth, Depth | null>> = { front: 'middle', middle: 'back', back: null };

/** Depth shadows: a layer casts a soft drop shadow, away from the light, onto the depth behind it. Back casts none. */
export function depthShadow(
  depth: Depth,
  dot: LightDot | null,
): { dx: number; dy: number; blur: number; opacity: number } | null {
  const behind = BEHIND[depth];
  if (!dot || !behind) return null;
  const gap = PARALLAX[depth] - PARALLAX[behind];
  const dir = lightDirection(dot);
  return {
    dx: -dir.x * SHADOW_REACH * gap * 2,
    dy: dir.y * SHADOW_REACH * gap * 2,
    blur: SHADOW_REACH * gap,
    opacity: 0.35,
  };
}
