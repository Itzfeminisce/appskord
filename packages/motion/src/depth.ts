import { cameraAt, focusDepth } from './camera';
import type { CameraPose } from './camera';
import { UNIT } from './scene';
import type { FrameState, MotionGraph } from './scene';
import { DEPTHS, PARALLAX } from './types';
import type { Depth, Feel, SceneV3 } from './types';

export const DEPTH_LABELS: Readonly<Record<Depth, string>> = { front: 'Front', middle: 'Middle', back: 'Back' };

/** Recipe px a depth slides sideways per orbit radian for each unit of parallax it sits from the focus. */
export const ORBIT_SHIFT = 900;
/** Parallax gap that reaches full depth blur: front to back. */
const BLUR_RANGE = PARALLAX.front - PARALLAX.back;
/** World units "Show depth" pulls each layer back per unit of parallax, so the editor can see what moves. */
export const SPREAD = 6;

/** How one depth layer sits for a camera pose. x and y in recipe px, blur 0..1 before the depth-blur strength. */
export interface DepthPose {
  x: number;
  y: number;
  scale: number;
  rotateY: number;
  blur: number;
}

/** Further back moves less: every camera offset scales by the depth's parallax; orbits slide layers either side of the focus apart. */
export function depthPose(depth: Depth, pose: CameraPose, strength = 1): DepthPose {
  const p = PARALLAX[depth];
  const yaw = (pose.yaw * Math.PI) / 180;
  return {
    x: -pose.x * p + Math.sin(yaw) * ORBIT_SHIFT * (p - pose.focus),
    y: -pose.y * p,
    scale: 1 + (pose.zoom - 1) * p,
    rotateY: yaw * p,
    blur: Math.min(1, (Math.abs(p - pose.focus) / BLUR_RANGE) * strength),
  };
}

/** "Front · moves 1.0× · sharp (focus)". */
export function depthLabel(depth: Depth, pose: CameraPose, strength = 1): string {
  const p = PARALLAX[depth];
  const moves = Number.isInteger(p * 10) ? p.toFixed(1) : String(p);
  const blur = depthPose(depth, pose, strength).blur;
  const sharp =
    Math.abs(p - pose.focus) < 1e-6
      ? 'sharp (focus)'
      : blur < 1e-6
        ? 'sharp'
        : blur < 0.6
          ? 'slight blur'
          : 'soft blur';
  return `${DEPTH_LABELS[depth]} · moves ${moves}× · ${sharp}`;
}

/** Puts the camera onto the graph's depth groups; each group's userData.blur is for the depth-of-field pass. `spread` is "Show depth". */
export function applyCamera(graph: MotionGraph, pose: CameraPose, strength = 1, spread = false): void {
  for (const depth of DEPTHS) {
    const g = graph.depths[depth];
    const d = depthPose(depth, pose, strength);
    g.position.set(d.x * UNIT, -d.y * UNIT, spread ? -(1 - PARALLAX[depth]) * SPREAD : 0);
    g.scale.setScalar(d.scale);
    g.rotation.set(0, d.rotateY, 0);
    g.userData.blur = d.blur;
  }
  graph.root.updateMatrixWorld(true);
}

/** The camera pose for a frame of a scene: its move, eased by the feel, focused on the scene's focus layer. */
export function scenePose(scene: SceneV3, frame: FrameState, feel: Feel = 'smooth'): CameraPose {
  return cameraAt(frame.camera, focusDepth(scene), feel);
}
