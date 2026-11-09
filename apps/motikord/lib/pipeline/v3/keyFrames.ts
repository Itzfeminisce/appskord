// "Check the key frames": one still per scene from its v3 template in the look guide. No AI call.
import type { TemplateId } from '@appskord/scenes';
import { FEEL } from '@appskord/motion/curves';
import { validateScene } from '@appskord/motion/recipe';
import { CAMERA_MOVES, type CameraV3, type LayerV3, type LookGuide, type SceneV3 } from '@appskord/motion/types';
import type { PackV3 } from '../../look/packs';
import { buildScene, type LayerInput } from '../../templates/v3/build';
import { getTemplateV3, type TemplateV3 } from '../../templates/v3/templates';
import type { Layer, Recipe, Scene } from '../../types';

const KIND: Record<Layer['type'], LayerV3['kind']> = {
  text: 'text',
  image: 'media',
  video: 'media',
  shape: 'shape',
  chart: 'chart',
};

/** The pack with the look guide's feel and camera habit; the brand kit and fonts are applied elsewhere. */
export function lookPack(pack: PackV3, look: LookGuide): PackV3 {
  const curve = look.feel === pack.feel ? pack.curve : FEEL[look.feel].curve;
  const camera =
    look.camera === pack.camera.move
      ? pack.camera
      : { ...pack.camera, move: look.camera, amount: look.camera === 'hold' ? 0 : pack.camera.amount || 0.04 };
  return { ...pack, feel: look.feel, curve, camera };
}

function looseTemplate(pack: PackV3): TemplateV3 {
  return {
    id: 'free' as TemplateId,
    number: '',
    name: '',
    packId: pack.id,
    keyFrameS: 0.6,
    slotLabels: [],
    beats: [],
    plan: [],
    camera: { move: pack.camera.move, amount: pack.camera.amount },
    transition: pack.transitions[0] ?? 'crossfade',
    sample: {},
  };
}

const templateOf = (scene: Scene, pack: PackV3): TemplateV3 =>
  (scene.template && getTemplateV3(scene.template)) || looseTemplate(pack);

/** The camera a variant uses: 0 is the template's, each next one the next camera habit in Fixed-terms order. */
export function variantCamera(base: CameraV3, variant: number, scene: SceneV3, pack: PackV3): CameraV3 {
  if (variant <= 0) return base;
  const text = scene.layers.find((l) => l.kind === 'text');
  const start = CAMERA_MOVES.indexOf(base.move);
  const moves = CAMERA_MOVES.filter((m) => m !== base.move && (m !== 'rack-focus' || text));
  const move = moves[(Math.max(0, start) + variant - 1) % moves.length]!;
  if (move === 'hold') return { move, amount: 0 };
  if (move === 'rack-focus') return { move, amount: 0, focus: text!.id };
  return { move, amount: pack.camera.amount || 0.04 };
}

/** Scene `i` with its full motion in the look, for a variant. Throws when the scene can't be built. */
export function motionScene(recipe: Recipe, i: number, look: LookGuide, pack: PackV3, variant = 0): SceneV3 {
  const scene = recipe.scenes[i];
  if (!scene) throw new Error(`Motikord: could not find scene ${i + 1}`);
  const p = lookPack(pack, look);
  const t = templateOf(scene, p);
  const layers: LayerInput[] = scene.layers.map((l) => ({
    id: l.id,
    kind: KIND[l.type],
    ...(l.slot ? { slotId: l.slot } : {}),
  }));
  const built = buildScene(t, p, { id: scene.id, ms: scene.durationMs, layers });
  const out = { ...built, camera: variantCamera(built.camera, variant, built, p) };
  const checked = validateScene(out);
  if (!checked.ok) throw new Error(`Motikord: could not build scene ${i + 1}. ${checked.errors.join(' ')}`);
  return out;
}

/** The settled pose: every track held at its last value. */
export function still(scene: SceneV3): SceneV3 {
  return {
    ...scene,
    keyFrameApproved: false,
    layers: scene.layers.map((l) => ({
      ...l,
      tracks: Object.fromEntries(Object.entries(l.tracks).map(([p, tr]) => [p, [{ t: 0, v: tr.at(-1)!.v }]])),
    })),
  };
}

export type KeyFrameStatus = 'waiting' | 'approved' | 'failed';
export interface KeyFrame {
  sceneId: string;
  index: number;
  /** Template name, "Title hook". */
  name: string;
  /** The scene's words as one caption line. */
  words: string;
  variant: number;
  /** When the still is taken, from the template's "Key frame 0.9 s". */
  atMs: number;
  status: KeyFrameStatus;
  still?: SceneV3;
}
export interface KeyFrameBoard {
  lookGuideId: string;
  packId: string;
  frames: KeyFrame[];
}

const sentence = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
function wordsOf(scene: Scene): string {
  const parts = Object.values(scene.slots ?? {}).flatMap((v) =>
    typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [],
  );
  const text = parts.length ? parts : scene.layers.flatMap((l) => (l.type === 'text' ? [l.text] : []));
  return text.filter((s) => s.trim()).map(sentence).join(' ');
}

/** Draws one key frame; a scene that can't be built is `failed` and keeps the rest. */
export function drawKeyFrame(recipe: Recipe, i: number, look: LookGuide, pack: PackV3, variant = 0): KeyFrame {
  const scene = recipe.scenes[i]!;
  const t = templateOf(scene, pack);
  const base = {
    sceneId: scene.id,
    index: i,
    name: t.name,
    words: wordsOf(scene),
    variant,
    atMs: Math.min(scene.durationMs - 1, Math.round(t.keyFrameS * 1000)),
  };
  try {
    return { ...base, status: 'waiting', still: still(motionScene(recipe, i, look, pack, variant)) };
  } catch (error) {
    console.error('Motikord: could not draw key frame', error);
    return { ...base, status: 'failed' };
  }
}

/** One still per scene. `onDrawn` reports "1 of 4" while it draws. */
export function drawKeyFrames(
  recipe: Recipe,
  look: LookGuide,
  pack: PackV3,
  onDrawn?: (done: number, total: number) => void,
): KeyFrameBoard {
  const frames = recipe.scenes.map((_, i) => {
    const f = drawKeyFrame(recipe, i, look, pack);
    onDrawn?.(i + 1, recipe.scenes.length);
    return f;
  });
  return { lookGuideId: look.id, packId: pack.id, frames };
}

const setFrame = (board: KeyFrameBoard, i: number, f: KeyFrame): KeyFrameBoard => ({
  ...board,
  frames: board.frames.map((x, j) => (j === i ? f : x)),
});

export function approve(board: KeyFrameBoard, i: number): KeyFrameBoard {
  const f = board.frames[i];
  return f?.still ? setFrame(board, i, { ...f, status: 'approved' }) : board;
}

/** "Approve all": every frame that was drawn. */
export const approveAll = (board: KeyFrameBoard): KeyFrameBoard => ({
  ...board,
  frames: board.frames.map((f) => (f.still ? { ...f, status: 'approved' } : f)),
});

/** "Try another": the next camera habit for that scene, the same every time. */
export const tryAnother = (board: KeyFrameBoard, recipe: Recipe, look: LookGuide, pack: PackV3, i: number) =>
  setFrame(board, i, drawKeyFrame(recipe, i, look, pack, (board.frames[i]?.variant ?? 0) + 1));

/** keyframe-failed's "Try again": draws just that one. */
export const redraw = (board: KeyFrameBoard, recipe: Recipe, look: LookGuide, pack: PackV3, i: number) =>
  setFrame(board, i, drawKeyFrame(recipe, i, look, pack, board.frames[i]?.variant ?? 0));

export const allApproved = (board: KeyFrameBoard) => board.frames.every((f) => f.status === 'approved');

/** The footer: "Approve 2 more to add the motion" and "3/5", or nothing once all are approved. */
export function footer(board: KeyFrameBoard): { line?: string; count: string } {
  const done = board.frames.filter((f) => f.status === 'approved').length;
  const left = board.frames.length - done;
  const count = `${done}/${board.frames.length}`;
  return left ? { line: `Approve ${left} more to add the motion`, count } : { count };
}
