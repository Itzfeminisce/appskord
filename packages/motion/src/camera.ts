import { ease, FEEL } from './curves';
import type { FrameState } from './scene';
import { PARALLAX } from './types';
import type { CameraMove, Depth, Feel, SceneV3 } from './types';

/** The camera's names, as in the frames. */
export const CAMERA_LABELS: Readonly<Record<CameraMove, string>> = {
  'push-in': 'Push in',
  'pull-out': 'Pull out',
  pan: 'Pan',
  orbit: 'Orbit',
  'rack-focus': 'Rack focus',
  hold: 'Hold',
};
const FEEL_LABELS: Readonly<Record<Feel, string>> = {
  smooth: 'Smooth',
  snappy: 'Snappy',
  bouncy: 'Bouncy',
  steady: 'Steady',
  floaty: 'Floaty',
};

/** Recipe px a pan at amount 1 travels: half the 1080-wide frame. */
export const PAN_SPAN = 540;
/** Degrees an orbit at amount 1 sweeps. */
export const ORBIT_SPAN = 30;
/** World units from the camera to the front layer; a layer with parallax p sits at CAMERA_DISTANCE / p. */
export const CAMERA_DISTANCE = 10;

/**
 * Where the 2.5D camera is at one instant. x and y are recipe px the camera has moved, zoom is the front layer's
 * scale, yaw the orbit angle in degrees, focus the parallax of the depth that is sharp.
 */
export interface CameraPose {
  x: number;
  y: number;
  zoom: number;
  yaw: number;
  focus: number;
}

/** The depth of the scene's focus layer, or front when the camera has none. */
export function focusDepth(scene: Pick<SceneV3, 'layers' | 'camera'>): Depth {
  const id = scene.camera.focus;
  return scene.layers.find((l) => l.id === id)?.depth ?? 'front';
}

/** Where a rack focus starts: the far end of the stack from the layer it lands on. */
export function rackFrom(target: Depth): Depth {
  return target === 'front' ? 'back' : 'front';
}

/** The camera pose for a frame. Pure: the move eases through the scene with the look's feel; amount is -1..1, its sign the direction. */
export function cameraAt(camera: FrameState['camera'], target: Depth = 'front', feel: Feel = 'smooth'): CameraPose {
  const p = ease(FEEL[feel].curve)(camera.progress);
  const a = camera.amount;
  const pose: CameraPose = { x: 0, y: 0, zoom: 1, yaw: 0, focus: PARALLAX[target] };
  switch (camera.move) {
    case 'push-in':
      pose.zoom = 1 + Math.abs(a) * p;
      break;
    case 'pull-out':
      pose.zoom = 1 + Math.abs(a) * (1 - p);
      break;
    case 'pan':
      pose.x = a * PAN_SPAN * (p - 0.5);
      break;
    case 'orbit':
      pose.yaw = a * ORBIT_SPAN * (p - 0.5);
      break;
    case 'rack-focus': {
      const from = PARALLAX[rackFrom(target)];
      pose.focus = from + (PARALLAX[target] - from) * p;
      break;
    }
    case 'hold':
      break;
  }
  return pose;
}

/** World distance from the camera to the plane in focus, for the depth-of-field pass. */
export function focusDistance(pose: CameraPose): number {
  return CAMERA_DISTANCE / pose.focus;
}

/** The amount as the editor shows it: a percent, or degrees for an orbit. */
export function amountLabel(move: CameraMove, amount: number): string {
  if (move === 'orbit') return `${Math.round(Math.abs(amount) * ORBIT_SPAN)}°`;
  return `${Math.round(Math.abs(amount) * 100)}%`;
}

/** "Push in · 4% · Smooth"; Hold and Rack focus have no amount. */
export function cameraLabel(move: CameraMove, amount: number, feel: Feel): string {
  const parts = [CAMERA_LABELS[move]];
  if (move !== 'hold' && move !== 'rack-focus') parts.push(amountLabel(move, amount));
  parts.push(FEEL_LABELS[feel]);
  return parts.join(' · ');
}
