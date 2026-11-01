// The test clip: 3 scenes of 5 s, each with 10 layers moving on eased paths. Pure poses; drawing lives in the page.
export const SCENE_SECONDS = 5;
export const SCENES = 3;
export const LAYERS = 10;

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export type LayerKind = 'text' | 'shape' | 'image';
export interface Pose { kind: LayerKind; x: number; y: number; scale: number; rotate: number; alpha: number; hue: number }

/** 2 images, 3 text layers (with shadow) and 5 gradient shapes, in that order. */
export function layerKind(i: number): LayerKind {
  return i < 2 ? 'image' : i < 5 ? 'text' : 'shape';
}

export function sceneAt(seconds: number): { scene: number; local: number } {
  const loop = ((seconds % (SCENES * SCENE_SECONDS)) + SCENES * SCENE_SECONDS) % (SCENES * SCENE_SECONDS);
  const scene = Math.min(SCENES - 1, Math.floor(loop / SCENE_SECONDS));
  return { scene, local: loop - scene * SCENE_SECONDS };
}

/** Where layer i sits at `seconds`, in canvas units of width w and height h. */
export function poseAt(i: number, seconds: number, w: number, h: number): Pose {
  const { scene, local } = sceneAt(seconds);
  const enter = easeOutBack(clamp01((local - i * 0.12) / 0.8));
  const drift = easeInOutCubic(clamp01(local / SCENE_SECONDS));
  const exit = 1 - easeInOutCubic(clamp01((local - (SCENE_SECONDS - 0.6)) / 0.6));
  const col = i % 5;
  const row = Math.floor(i / 5);
  const baseX = w * (0.12 + col * 0.19);
  const baseY = h * (0.3 + row * 0.38);
  const dir = scene % 2 === 0 ? 1 : -1;
  return {
    kind: layerKind(i),
    x: baseX + dir * (1 - enter) * w * 0.25 + drift * w * 0.03 * dir,
    y: baseY + Math.sin(seconds * 1.3 + i) * h * 0.02,
    scale: 0.6 + 0.4 * enter,
    rotate: (scene - 1) * 0.08 * drift + (layerKind(i) === 'shape' ? seconds * 0.4 : 0),
    alpha: clamp01(enter) * exit,
    hue: (scene * 120 + i * 29) % 360,
  };
}
