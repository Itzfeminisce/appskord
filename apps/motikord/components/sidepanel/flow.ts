// The v3 make flow the side panel shows: plan the story, draw a key frame per scene, wait for approval, add the
// motion, run the quality check, open the editor. One make at a time. Pure steps live in lib/pipeline/v3.
import { useSyncExternalStore } from 'react';
import type { ClipV3, LookGuide, SceneV3 } from '@appskord/motion/types';
import { criticModel } from '../../lib/ai/critic';
import { getBrandKit, putClip } from '../../lib/db';
import type { QualityResult } from '../../lib/critic/v3';
import { brandLook } from '../../lib/look/brand';
import { getPackV3, packLook, type PackId } from '../../lib/look/packs';
import { makeClip, MakeFailure, promptFor, type MakeDraft } from '../../lib/makeClip';
import { send } from '../../lib/messages';
import type { KeyFrameBoard } from '../../lib/pipeline/v3';
import { getSettings } from '../../lib/settings';
import type { Clip, Recipe, Settings } from '../../lib/types';
import { clipFrames } from './stills';

const engine = () => import('./engine');

export type Stage = 'idle' | 'planning' | 'plan-failed' | 'keyframes' | 'motion' | 'motion-failed' | 'checking' | 'opening' | 'failed';

export interface FlowState {
  stage: Stage;
  packId: PackId;
  look: LookGuide;
  recipe?: Recipe;
  board?: KeyFrameBoard;
  /** "Approve 2 more to add the motion" and "3/5"; the line goes once all are approved. */
  left?: { line?: string; count: string };
  /** Frames being drawn again after "Try another". */
  drawing: number[];
  /** "Adding motion to scene 3 of 5". */
  scene?: { at: number; total: number };
  failure?: MakeFailure;
  /** Scenes that already have motion, kept for "Try again". */
  done?: SceneV3[];
  failedScene?: number;
  quality?: QualityResult;
  clipId?: string;
}

export interface FlowDeps {
  /** The story as a recipe; nothing is saved yet. */
  plan(draft: MakeDraft, look: Settings['look'], signal: AbortSignal): Promise<Recipe>;
  brand(): Promise<Parameters<typeof brandLook>[1]>;
  save(clip: Clip): Promise<void>;
  openEditor(clipId: string): Promise<unknown>;
  /** The three-pass check; undefined when it can't run. */
  check(clip: ClipV3, recipe: Recipe, look: LookGuide, signal: AbortSignal): Promise<QualityResult | undefined>;
  /** Lets the screen paint between steps. */
  tick(): Promise<void>;
  now(): number;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const defaultDeps: FlowDeps = {
  async plan(d, look, signal) {
    const settings = await getSettings();
    const made = await makeClip(
      { prompt: promptFor(d), aspect: d.aspect ?? settings.defaultAspect, type: d.type, assets: d.attached },
      { settings: { ...settings, look }, brand: await getBrandKit(), save: async () => undefined, signal },
    );
    return made.clip.recipe;
  },
  brand: getBrandKit,
  save: putClip,
  openEditor: (clipId) => send({ type: 'editor/open', clipId }),
  async check(clip, recipe, look, signal) {
    const settings = await getSettings();
    const critic = await criticModel(settings, { signal });
    const { qualityCheck } = await engine();
    return qualityCheck({ recipe, clip, look }, { critic, signal, render: clipFrames() });
  },
  tick,
  now: Date.now,
};

const isV2Style = (id: PackId): id is 'clean' | 'bold' | 'playful' | 'corporate' => ['clean', 'bold', 'playful', 'corporate'].includes(id);

export function createFlow(deps: FlowDeps = defaultDeps) {
  const initialPack = getPackV3('studio');
  let state: FlowState = { stage: 'idle', packId: initialPack.id, look: packLook(initialPack), drawing: [] };
  const listeners = new Set<() => void>();
  let controller: AbortController | undefined;
  let sequence = 0;
  let lastDraft: MakeDraft | undefined;
  let lastLook: Settings['look'] = { style: 'auto', pace: 'normal', mood: 'upbeat' };
  // The clip once its motion is made, for "Open the editor now" while the check still runs.
  let ready: { clip: ClipV3; recipe: Recipe } | undefined;

  const set = (patch: Partial<FlowState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  type Engine = Awaited<ReturnType<typeof engine>>;
  const packOf = (e: Engine) => e.lookPack(getPackV3(state.packId), state.look);
  const setBoard = (e: Engine, board: KeyFrameBoard) => set({ board, left: e.footer(board) });

  async function plan(draft: MakeDraft, look: Settings['look']): Promise<void> {
    controller?.abort();
    const mine = ++sequence;
    const ctl = (controller = new AbortController());
    lastDraft = draft;
    lastLook = look;
    ready = undefined;
    set({ stage: 'planning', recipe: undefined, board: undefined, failure: undefined, done: undefined, failedScene: undefined, quality: undefined, drawing: [] });
    try {
      // The v2 writer knows four styles; the other packs only shape the motion.
      const written = { ...look, style: isV2Style(state.packId) ? state.packId : ('auto' as const) };
      const recipe = await deps.plan(draft, written, ctl.signal);
      if (mine !== sequence) return;
      const guide = brandLook(state.look, await deps.brand()).guide;
      const e = await engine();
      const board = e.drawKeyFrames(recipe, guide, packOf(e));
      set({ stage: 'keyframes', recipe });
      setBoard(e, board);
    } catch (error) {
      if (mine !== sequence) return;
      console.error('Motikord: could not plan the story', error);
      set({ stage: 'plan-failed', failure: error instanceof MakeFailure ? error : new MakeFailure(undefined) });
    }
  }

  async function open(clip: ClipV3, recipe: Recipe, mine: number): Promise<void> {
    try {
      const at = deps.now();
      const row: Clip & { v3: ClipV3 } = { id: recipe.id, recipe, history: [], createdAt: at, updatedAt: at, v3: clip };
      await deps.save(row);
      if (mine !== sequence) return;
      set({ clipId: row.id });
      await deps.openEditor(row.id);
    } catch (error) {
      console.error('Motikord: could not open the editor', error);
      if (mine === sequence) set({ stage: 'failed' });
    }
  }

  return {
    get: () => state,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    /** The pack chosen on Home; its look guide follows unless a saved guide was picked. */
    choosePack(id: PackId) { set({ packId: id, look: packLook(getPackV3(id)) }); },
    /** "Use for this clip" on the look guide. */
    useLook(look: LookGuide) { set({ look }); },
    plan,
    retryPlan() { return lastDraft ? plan(lastDraft, lastLook) : Promise.resolve(); },
    async approve(i: number) { const e = await engine(); if (state.board) setBoard(e, e.approve(state.board, i)); },
    async approveAll() { const e = await engine(); if (state.board) setBoard(e, e.approveAll(state.board)); },
    async another(i: number) {
      const { recipe, board: b } = state;
      if (!recipe || !b || state.drawing.includes(i)) return;
      set({ drawing: [...state.drawing, i] });
      await deps.tick();
      const e = await engine();
      const latest = state.board;
      if (latest) setBoard(e, e.tryAnother(latest, recipe, state.look, packOf(e), i));
      set({ drawing: state.drawing.filter((x) => x !== i) });
    },
    /** keyframe-failed's "Try again". */
    async redraw(i: number) {
      const e = await engine();
      const { recipe, board: b } = state;
      if (recipe && b) setBoard(e, e.redraw(b, recipe, state.look, packOf(e), i));
    },
    /** "Add the motion": motion for every scene, the quality check, then the editor. */
    async addTheMotion(): Promise<void> {
      const e = await engine();
      const { recipe, board: b } = state;
      if (!recipe || !b || !e.allApproved(b)) return;
      controller?.abort();
      const mine = ++sequence;
      const ctl = (controller = new AbortController());
      const total = recipe.scenes.length;
      set({ stage: 'motion', scene: { at: Math.min(1, total) || 1, total }, failedScene: undefined, quality: undefined });
      await deps.tick();
      const guide = brandLook(state.look, await deps.brand()).guide;
      const made = e.addMotion({
        recipe, board: b, look: guide, pack: packOf(e), done: state.done,
        onScene: (at, n) => set({ scene: { at, total: n } }),
      });
      if (mine !== sequence) return;
      if (!made.ok) {
        set(made.state === 'motion-failed' ? { stage: 'motion-failed', done: made.done, failedScene: made.sceneIndex } : { stage: 'keyframes' });
        return;
      }
      ready = { clip: made.clip, recipe };
      set({ stage: 'checking', done: undefined });
      await deps.tick();
      let quality: QualityResult | undefined;
      try {
        quality = await deps.check(made.clip, recipe, guide, ctl.signal);
      } catch (error) {
        if (mine !== sequence) return;
        console.error('Motikord: could not run the quality check', error);
      }
      if (mine !== sequence) return;
      set({ stage: 'opening', quality });
      await open(quality?.clip ?? made.clip, quality?.recipe ?? recipe, mine);
    },
    /** "Open the editor now": skips what is left of the check. */
    async openNow(): Promise<void> {
      if (!ready) return;
      controller?.abort();
      const mine = ++sequence;
      set({ stage: 'opening' });
      await open(ready.clip, ready.recipe, mine);
    },
    /** Cancel: stops what is running and goes back to the key frames. */
    cancel() {
      controller?.abort();
      sequence++;
      set({ stage: state.board ? 'keyframes' : 'idle', scene: undefined });
    },
    reset() {
      controller?.abort();
      sequence++;
      ready = undefined;
      state = { stage: 'idle', packId: initialPack.id, look: packLook(initialPack), drawing: [] };
      listeners.forEach((l) => l());
    },
  };
}

/** The deps the shared flow runs on; tests replace the ones that reach the network or the browser. */
export const flowDeps: FlowDeps = { ...defaultDeps };
export const flow = createFlow(flowDeps);
export const useFlow = (f: ReturnType<typeof createFlow> = flow): FlowState => useSyncExternalStore(f.subscribe, f.get);
