// "Add the motion": each approved key frame gets its template's beats in the look's feel, then continuity
// transitions pick the layers that carry from one scene into the next. Runs on this computer, no AI.
import { validateClip } from '@appskord/motion/recipe';
import type { ClipV3, Finish, LayerV3, LookGuide, SceneV3 } from '@appskord/motion/types';
import { packFinish, type PackV3 } from '../../look/packs';
import { linkScenes } from '../../templates/v3/build';
import type { Layer, Recipe } from '../../types';
import { allApproved, motionScene, type KeyFrameBoard } from './keyFrames';

/** Why two layers carry, strongest first. */
export type CarryWhy = 'same-layer' | 'same-media' | 'same-text' | 'same-shape' | 'same-slot';
export interface Carry {
  /** The scene the layer leaves, from 0; it lands in the next one. */
  from: number;
  layerId: string;
  toLayerId: string;
  carry: string;
  why: CarryWhy;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function why(a: LayerV3, b: LayerV3, va: Layer | undefined, vb: Layer | undefined): CarryWhy | undefined {
  if (a.kind !== b.kind) return undefined;
  if (a.id === b.id) return 'same-layer';
  if (va && vb) {
    if ('assetId' in va && 'assetId' in vb && va.assetId === vb.assetId) return 'same-media';
    if (va.type === 'text' && vb.type === 'text' && norm(va.text) && norm(va.text) === norm(vb.text)) return 'same-text';
    if (va.type === 'shape' && vb.type === 'shape' && va.shape === vb.shape && va.fill === vb.fill) return 'same-shape';
  }
  if (a.slotId && a.slotId === b.slotId) return 'same-slot';
  return undefined;
}
const RANK: readonly CarryWhy[] = ['same-layer', 'same-media', 'same-text', 'same-shape', 'same-slot'];

/** Picks one carry pair per cut where the pack carries; template carries stay. Pure. */
export function continuity(
  scenes: readonly SceneV3[],
  recipe: Recipe,
  pack: PackV3,
): { scenes: SceneV3[]; carries: Carry[] } {
  const out = structuredClone(scenes) as SceneV3[];
  const carries: Carry[] = [];
  if (!pack.transitions.includes('carry')) return { scenes: linkScenes(out), carries };
  const v2 = new Map(recipe.scenes.map((s) => [s.id, new Map(s.layers.map((l) => [l.id, l]))]));
  // Layers that took a carry from the previous cut can't hand a second one on.
  const received = new Set<LayerV3>();
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i]!;
    const b = out[i + 1]!;
    // A template carry already makes this cut's pair.
    if ((a.transition.carry ?? []).some((c) => b.layers.some((l) => l.carry === c))) continue;
    const va = v2.get(a.id);
    const vb = v2.get(b.id);
    let best: { la: LayerV3; lb: LayerV3; why: CarryWhy } | undefined;
    for (const la of a.layers) {
      if (received.has(la)) continue;
      for (const lb of b.layers) {
        // A layer already carrying something else can't take a second carry id.
        if (lb.carry && lb.carry !== la.carry) continue;
        const w = why(la, lb, va?.get(la.id), vb?.get(lb.id));
        if (w && (!best || RANK.indexOf(w) < RANK.indexOf(best.why))) best = { la, lb, why: w };
      }
    }
    if (!best) continue;
    const id = best.la.carry ?? `carry-${b.id}-${best.lb.id}`;
    best.la.carry = id;
    best.lb.carry = id;
    received.add(best.lb);
    a.transition = { kind: 'carry', carry: [id] };
    carries.push({ from: i, layerId: best.la.id, toLayerId: best.lb.id, carry: id, why: best.why });
  }
  return { scenes: linkScenes(out), carries };
}

export interface MotionInput {
  recipe: Recipe;
  board: KeyFrameBoard;
  look: LookGuide;
  pack: PackV3;
  fps?: 30 | 60;
  finish?: Finish;
  /** Scenes that already have motion, from a run that stopped: "Try again to carry on from scene 4". */
  done?: SceneV3[];
  /** "Adding motion to scene 3 of 5". */
  onScene?: (scene: number, total: number) => void;
}
export type MotionResult =
  | { ok: true; clip: ClipV3; carries: Carry[] }
  | { ok: false; state: 'keyframes-waiting' }
  | { ok: false; state: 'motion-failed'; sceneIndex: number; done: SceneV3[] };

/** The full clip from approved key frames. A scene that fails stops here and keeps the scenes before it. */
export function addMotion(input: MotionInput): MotionResult {
  const { recipe, board, look, pack } = input;
  if (!allApproved(board) || board.frames.length !== recipe.scenes.length) return { ok: false, state: 'keyframes-waiting' };
  const done = [...(input.done ?? [])].slice(0, recipe.scenes.length);
  for (let i = done.length; i < recipe.scenes.length; i++) {
    input.onScene?.(i + 1, recipe.scenes.length);
    try {
      done.push({ ...motionScene(recipe, i, look, pack, board.frames[i]!.variant), keyFrameApproved: true });
    } catch (error) {
      console.error('Motikord: could not add motion', error);
      return { ok: false, state: 'motion-failed', sceneIndex: i, done };
    }
  }
  const { scenes, carries } = continuity(done, recipe, pack);
  const clip: ClipV3 = {
    version: 3,
    scenes,
    lookGuideId: look.id,
    packId: pack.id,
    fps: input.fps ?? 30,
    finish: input.finish ?? packFinish(pack),
  };
  const checked = validateClip(clip);
  if (!checked.ok) {
    console.error('Motikord: could not add motion', checked.errors);
    const at = Number(/scenes\[(\d+)\]/.exec(checked.errors[0] ?? '')?.[1] ?? 0);
    return { ok: false, state: 'motion-failed', sceneIndex: at, done: done.slice(0, at) };
  }
  return { ok: true, clip, carries };
}
