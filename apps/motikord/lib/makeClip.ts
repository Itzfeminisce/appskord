import { useEffect, useState, useSyncExternalStore } from 'react';
import { AiError, type AiStateId } from './ai/errors';
import { detectType } from './ai/detectType';
import type { CriticSkip, FrameRenderer } from './ai/critic';
import { StoryboardFailed } from './ai/storyboard';
import { writeClip, type AiOptions, type MakeStep, type PipelineEvents } from './ai/writeRecipe';
import { deleteClip, getBrandKit, putClip } from './db';
import { getMedia } from './media';
import { MediaCache } from './render/cache';
import { renderFrames } from './render/frames';
import type { HostAccess } from './hostAccess';
import { send } from './messages';
import { getSettings, onSettingsChanged } from './settings';
import { copyTemplate, type Template } from './templates';
import { autoStyle } from './templates/scenes';
import type { Aspect, Asset, BrandKit, Clip, ClipType, CriticNote, Issue, Mood, Pace, Provider, Recipe, Settings, StyleId, Storyboard } from './types';

/** What a failed make shows: an AI state card, or one of the two setup cards Making can show. */
export type MakeState = AiStateId | 'penv-disconnected' | 'provider-access' | 'storyboard-failed';

/** A make that did not finish. `state` is undefined when you cancelled. */
export class MakeFailure extends Error {
  constructor(readonly state: MakeState | undefined, readonly retryAfterMs?: number) {
    super(state ? `Motikord could not make the clip: ${state}` : 'Motikord make cancelled');
    this.name = 'MakeFailure';
  }
}

export interface MakeInput { prompt: string; aspect: Aspect; type?: ClipType; assets: Asset[]; id?: string }
export interface MakeHooks extends AiOptions, PipelineEvents {
  settings?: Settings;
  brand?: BrandKit;
  save?: (clip: Clip) => Promise<void>;
  now?: () => number;
  onType?: (type: ClipType, by: Provider | 'builtin' | 'settings' | 'guess' | 'you') => void;
  onRecipe?: (recipe: Recipe) => void;
}
export interface MakeResult {
  clip: Clip; type: ClipType; notices: AiStateId[]; by: Provider | 'builtin';
  storyboard: Storyboard; fixes: string[]; issues: Issue[];
  critic?: { scenes: number[]; frames: number; notes: CriticNote[] }; criticSkipped?: CriticSkip;
}

/** The failure a thrown error stands for. No key means Penv Cloud was disconnected when that is where the key came from. */
export function failureFor(error: unknown, settings: Pick<Settings, 'keySource'>): MakeFailure {
  if (error instanceof MakeFailure) return error;
  if (error instanceof StoryboardFailed) return new MakeFailure('storyboard-failed');
  const ai = error instanceof AiError ? error : new AiError('invalid-reply', 'make');
  if (ai.code === 'cancelled') return new MakeFailure(undefined);
  if (ai.code === 'no-key') return new MakeFailure(settings.keySource === 'penv-app' ? 'penv-disconnected' : 'key-needed');
  return new MakeFailure(ai.state ?? 'making-failed', ai.detail.retryAfterMs);
}

/** Keeps the assets the clip really uses: shown media, the music, and fonts some text is set in. */
function pruneAssets(recipe: Recipe): Recipe {
  const used = new Set<string>();
  const fonts = new Set<string>();
  for (const layer of recipe.scenes.flatMap((s) => s.layers)) {
    if (layer.type === 'image' || layer.type === 'video') used.add(layer.assetId);
    if (layer.type === 'text') fonts.add(layer.font);
  }
  if (recipe.music) used.add(recipe.music.assetId);
  const assets = Object.fromEntries(Object.entries(recipe.assets).filter(([id, a]) => used.has(id) || (a.kind === 'font' && fonts.has(a.name))));
  return { ...recipe, assets };
}

/** The critic's frames, drawn with the clip's own media read from this computer. */
const opfsFrames: FrameRenderer = async (recipe, times) => {
  const cache = new MediaCache({ read: async (asset) => getMedia(asset.opfsPath) });
  await cache.load(recipe);
  return renderFrames(recipe, times, { cache });
};

/** The brand kit the scenes are expanded with: the kit when used for new clips, and an attached font over its fonts. */
function kitFor(brand: BrandKit | undefined, assets: Asset[]): BrandKit | undefined {
  const font = assets.find((a) => a.kind === 'font')?.name;
  let kit: BrandKit | undefined = brand?.useForNewClips ? { ...brand } : undefined;
  if (font) kit = { ...(kit ?? { colours: [], useForNewClips: true }), headingFont: font, bodyFont: font };
  // The kit's logo is placed only when its media came with the make; otherwise the clip would name a file it lacks.
  const logo = kit?.logoAssetId;
  if (kit && logo && !assets.some((a) => a.id === logo)) { const { logoAssetId: _, ...rest } = kit; kit = rest; }
  return kit;
}

/** Detects the type, plans the story, fills each scene, checks it, looks at a few frames and saves the clip. Throws MakeFailure. */
export async function makeClip(input: MakeInput, hooks: MakeHooks = {}): Promise<MakeResult> {
  const {
    settings: given, brand, save = putClip, now = Date.now, onType, onRecipe,
    onStep, onStoryboard, gate, onFilling, onFilled, onRetry, onFixes, onCritic, onCriticSkipped, frames = opfsFrames, ...ai
  } = hooks;
  const settings = given ?? (await getSettings());
  try {
    let type = input.type;
    if (type) onType?.(type, 'you');
    else {
      const found = await detectType(input.prompt, { ...ai, settings });
      type = found.type;
      onType?.(type, found.by);
    }
    const look = settings.look;
    const style: StyleId = look.style === 'auto' ? autoStyle(type) : look.style;
    const kit = kitFor(brand, input.assets);
    const wrote = await writeClip({
      prompt: input.prompt, type, aspect: input.aspect, assets: input.assets, id: input.id,
      style, pace: look.pace, mood: look.mood, brand: kit, critic: settings.critic, settings,
    }, ai, { onStep, onStoryboard, gate, onFilling, onFilled, onRetry, onFixes, onCritic, onCriticSkipped, frames });
    let recipe = pruneAssets(wrote.recipe);
    const song = input.assets.find((a) => a.kind === 'audio');
    if (song && !recipe.music) recipe = { ...recipe, music: { assetId: song.id, volume: 0.8, fadeInMs: 500, fadeOutMs: 1000 }, assets: { ...recipe.assets, [song.id]: song } };
    if (brand?.useForNewClips) recipe = { ...recipe, brandApplied: true };
    onRecipe?.(recipe);
    onStep?.('open');
    const at = now();
    const clip: Clip = { id: recipe.id, recipe, history: [], createdAt: at, updatedAt: at };
    if (ai.signal?.aborted) throw new AiError('cancelled', 'make');
    await save(clip);
    return {
      clip, type, notices: wrote.notices, by: wrote.by, storyboard: wrote.storyboard, fixes: wrote.fixes, issues: wrote.issues,
      critic: wrote.critic, criticSkipped: wrote.criticSkipped,
    };
  } catch (error) {
    throw failureFor(error, settings);
  }
}

/** Your own copy of a template, saved to the library. */
export async function makeFromTemplate(template: Template, hooks: { save?: (clip: Clip) => Promise<void>; now?: () => number; id?: string } = {}): Promise<Clip> {
  const at = (hooks.now ?? Date.now)();
  const recipe = copyTemplate(template, hooks.id);
  const clip: Clip = { id: recipe.id, recipe, history: [], createdAt: at, updatedAt: at };
  await (hooks.save ?? putClip)(clip);
  return clip;
}

// ---- What you typed and attached on Home, kept while you move between screens ----

export interface MakeDraft { prompt: string; attached: Asset[]; type?: ClipType; aspect?: Aspect }
const EMPTY: MakeDraft = { prompt: '', attached: [] };

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) { value = next; listeners.forEach((l) => l()); },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

const draftStore = createStore<MakeDraft>(EMPTY);
export const draft = {
  get: draftStore.get,
  set: (patch: Partial<MakeDraft>) => draftStore.set({ ...draftStore.get(), ...patch }),
  clear: () => draftStore.set(EMPTY),
};
export const useDraft = () => useSyncExternalStore(draftStore.subscribe, draftStore.get);

/** True when there is something to make a clip from. */
export const canMake = (d: MakeDraft) => d.prompt.trim() !== '' || d.attached.length > 0;
/** The prompt sent to the AI; with only media attached there is no text, so say what is attached. */
export const promptFor = (d: MakeDraft) => d.prompt.trim() || `A clip made from my ${d.attached.map((a) => a.kind).join(', ')}.`;

// ---- The run Making shows ----

export interface RunState {
  status: 'idle' | 'running' | 'done' | 'failed';
  steps: number;                 // v1 Making: finished steps of clip type, writing, motion and layout, checking
  step?: MakeStep;               // v2 Making: the step under way
  look?: { style: StyleId; pace: Pace; mood: Mood };   // the pill under the title
  storyboard?: Storyboard;
  filled: number; total: number; // "Filling scene {n} of {total}", "{n} of {total} done"
  filling?: number;              // index of the scene being filled ("Scene 3 · List")
  retrying?: number;             // scene-retrying: index of the scene asked again
  fixes: string[];               // "Fixed 2 things", one line each
  critic?: { scenes: number[]; frames: number; notes: CriticNote[] };   // "Groq is looking at 3 small frames"
  criticSkipped?: CriticSkip; criticModel?: string;                     // critic-off, critic-not-available ({model}), critic-unreachable
  issuesLeft: Issue[];           // checker-left-issues
  pausing: boolean;              // "Pause and check the plan" asked; stops at the next scene once the plan is in
  paused: boolean;               // waiting on StoryboardEdit with `storyboard`
  type?: ClipType; typeBy?: Provider | 'builtin' | 'settings' | 'guess' | 'you';
  recipe?: Recipe; clipId?: string;
  failure?: MakeState; retryAfterMs?: number;
  notices: AiStateId[]; by?: Provider | 'builtin';
  editorOpen: boolean;
  busyRetries: number;           // automatic provider-busy retries already made
}
/** provider-busy is retried by itself this many times; after that only "Try now" remains. */
export const MAX_BUSY_RETRIES = 1;
const IDLE: RunState = { status: 'idle', steps: 0, filled: 0, total: 0, fixes: [], issuesLeft: [], pausing: false, paused: false, notices: [], editorOpen: false, busyRetries: 0 };

export interface RunnerDeps {
  make: typeof makeClip;
  openEditor(clipId: string): Promise<unknown>;
  notifySaved(clipId: string): Promise<unknown>;
  save(clip: Clip): Promise<void>;
  remove(clipId: string): Promise<void>;
  settings(): Promise<Settings>;
  brand(): Promise<BrandKit | undefined>;
  id(): string;
  fetch?: AiOptions['fetch'];
}

const defaultDeps: RunnerDeps = {
  make: makeClip,
  openEditor: (clipId) => send({ type: 'editor/open', clipId }),
  notifySaved: (clipId) => send({ type: 'clip/saved', clipId }),
  save: putClip,
  remove: deleteClip,
  settings: getSettings,
  brand: getBrandKit,
  id: () => globalThis.crypto?.randomUUID?.() ?? `clip-${Date.now().toString(36)}`,
};

/** One make at a time. Starting again, or cancelling, stops the one before. Nothing starts until `start` is called from a click. */
export function createRunner(deps: RunnerDeps = defaultDeps) {
  const store = createStore<RunState>(IDLE);
  let controller: AbortController | undefined;
  let reserved: string | undefined;
  let placeholder = false;
  let pending: Promise<unknown> = Promise.resolve();
  let sequence = 0;
  let opening = false;
  let pauseWanted = false;
  let release: ((next: Storyboard | 'replan') => void) | undefined;
  const patch = (p: Partial<RunState>) => store.set({ ...store.get(), ...p });

  /** The pipeline's pause point: lets the plan through unless "Pause and check the plan" was asked. */
  const gateFor = (signal: AbortSignal, live: () => boolean) => (sb: Storyboard): Promise<Storyboard | 'replan'> => {
    if (!pauseWanted || !live()) return Promise.resolve(sb);
    patch({ paused: true, pausing: false, storyboard: sb });
    return new Promise((resolve, reject) => {
      release = (next) => { release = undefined; resolve(next); };
      signal.addEventListener('abort', () => { release = undefined; reject(new AiError('cancelled', 'make')); }, { once: true });
    });
  };

  async function start(d: MakeDraft, opts: { access?: HostAccess; auto?: boolean } = {}): Promise<void> {
    controller?.abort();
    const mine = ++sequence;
    const ctl = (controller = new AbortController());
    const before = store.get();
    // A remake while the editor shows the placeholder reuses its id, so the finished clip replaces it.
    const reuse = placeholder && reserved !== undefined;
    if (!reuse) reserved = deps.id();
    const busyRetries = opts.auto ? before.busyRetries + 1 : 0;
    store.set({ ...IDLE, status: 'running', type: d.type, busyRetries, ...(reuse ? { editorOpen: before.editorOpen, clipId: before.clipId } : {}) });
    const live = () => mine === sequence;
    pauseWanted = false;
    release = undefined;
    try {
      const settings = await deps.settings();
      const style = settings.look.style;
      if (live()) patch({ look: { style: style === 'auto' ? autoStyle(d.type ?? 'social') : style, pace: settings.look.pace, mood: settings.look.mood } });
      if (opts.access === 'denied' && settings.ai === 'cloud') throw new MakeFailure('provider-access');
      const result = await deps.make(
        { prompt: promptFor(d), aspect: d.aspect ?? settings.defaultAspect, type: d.type, assets: d.attached, id: reserved },
        {
          signal: ctl.signal, fetch: deps.fetch, settings, brand: await deps.brand(),
          save: async (clip) => {
            await pending;
            if (!live()) throw new AiError('cancelled', 'make');
            await deps.save(clip);
            placeholder = false;
          },
          onType: (type, by) => {
            if (!live()) return;
            const look = store.get().look;
            patch({ type, typeBy: by, steps: 1, ...(look && settings.look.style === 'auto' ? { look: { ...look, style: autoStyle(type) } } : {}) });
          },
          onRecipe: (recipe) => { if (live()) patch({ recipe, steps: 3 }); },
          onStep: (step) => { if (live()) patch({ step, ...(step === 'plan' ? { storyboard: undefined, filled: 0, total: 0 } : {}), ...(step === 'check' ? { steps: 3 } : {}) }); },
          onStoryboard: (storyboard) => { if (live()) patch({ storyboard, total: storyboard.beats.length, filled: 0, steps: Math.max(store.get().steps, 2) }); },
          gate: gateFor(ctl.signal, live),
          onFilling: (index, total) => { if (live()) patch({ filling: index, total, retrying: undefined }); },
          onFilled: (filled, total) => { if (live()) patch({ filled, total, retrying: undefined }); },
          onRetry: (index) => { if (live()) patch({ retrying: index }); },
          onFixes: (fixes) => { if (live()) patch({ fixes }); },
          onCritic: (look) => { if (live()) patch({ critic: { ...look, notes: [] } }); },
          onCriticSkipped: (criticSkipped, criticModel) => { if (live()) patch({ criticSkipped, criticModel, critic: criticSkipped === 'critic-unreachable' ? store.get().critic : undefined }); },
        },
      );
      if (!live()) return;
      placeholder = false;
      patch({
        status: 'done', steps: 4, step: 'open', clipId: result.clip.id, recipe: result.clip.recipe, notices: result.notices, by: result.by,
        storyboard: result.storyboard, fixes: result.fixes, issuesLeft: result.issues, critic: result.critic, criticSkipped: result.criticSkipped,
        filling: undefined, retrying: undefined,
      });
      if (store.get().editorOpen) await deps.notifySaved(result.clip.id);
      else { await deps.openEditor(result.clip.id); patch({ editorOpen: true }); }
    } catch (error) {
      if (!live()) return;
      const failure = failureFor(error, await deps.settings().catch(() => ({ keySource: null as Settings['keySource'] })));
      await pending;
      await discard();
      if (!live()) return;
      if (failure.state === undefined) { store.set(IDLE); return; }
      patch({ status: 'failed', failure: failure.state, retryAfterMs: failure.retryAfterMs });
    }
  }

  /** "Open the editor now": opens the tab on a clip with its scenes still to come. */
  async function openNow(d: MakeDraft): Promise<void> {
    const mine = sequence;
    const settings = await deps.settings();
    const s = store.get();
    const id = reserved;
    if (mine !== sequence || s.status !== 'running' || !id || s.editorOpen || opening) return;
    opening = true;
    const at = Date.now();
    const recipe: Recipe = {
      version: 1, id, name: promptFor(d).slice(0, 40), type: s.type ?? 'social', aspect: d.aspect ?? settings.defaultAspect,
      scenes: [{ id: 's1', durationMs: 3000, background: '#FFFFFF', layout: 'center', layers: [] }], assets: {}, prompt: d.prompt || undefined,
    };
    placeholder = true;
    const saving = deps.save({ id, recipe, history: [], createdAt: at, updatedAt: at });
    pending = saving.catch(() => undefined);
    try { await saving; } catch (error) { placeholder = false; opening = false; throw error; }
    opening = false;
    if (mine !== sequence) return;
    patch({ editorOpen: true, clipId: id });
    await deps.openEditor(id);
  }

  async function discard(): Promise<void> {
    if (placeholder && reserved) await deps.remove(reserved).catch((e: unknown) => console.error('Motikord: could not remove the unfinished clip', e));
    placeholder = false;
  }

  async function cancel(): Promise<void> {
    sequence++;
    controller?.abort();
    await pending;
    await discard();
    store.set(IDLE);
  }

  /** "Pause and check the plan": the make stops once the plan is in, before the next scene. */
  function pause(): void {
    if (store.get().status !== 'running' || store.get().paused) return;
    pauseWanted = true;
    patch({ pausing: true });
  }
  /** "Make these scenes": goes on with the storyboard as edited; unchanged scenes already filled are kept. */
  function resume(storyboard: Storyboard): void {
    if (!release) return;
    pauseWanted = false;
    patch({ paused: false, pausing: false, storyboard });
    release(storyboard);
  }
  /** "Plan it again": plans afresh and stays paused on the new plan. */
  function replan(): void {
    if (!release) return;
    patch({ paused: false, pausing: true, storyboard: undefined });
    release('replan');
  }

  return { get: store.get, subscribe: store.subscribe, start, openNow, cancel, pause, resume, replan, reset: () => { sequence++; controller?.abort(); store.set(IDLE); } };
}

export const runner = createRunner();
export const useRun = () => useSyncExternalStore(runner.subscribe, runner.get);

/** Settings as the screens need them: null until read, then live. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    getSettings().then(setSettings).catch((error: unknown) => console.error('Motikord: could not read settings', error));
    return onSettingsChanged(setSettings);
  }, []);
  return settings;
}
