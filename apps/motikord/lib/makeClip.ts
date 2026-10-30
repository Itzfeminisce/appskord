import { useEffect, useState, useSyncExternalStore } from 'react';
import { AiError, type AiStateId } from './ai/errors';
import { detectType } from './ai/detectType';
import { writeRecipe, type AiOptions } from './ai/writeRecipe';
import { deleteClip, getBrandKit, putClip } from './db';
import type { HostAccess } from './hostAccess';
import { send } from './messages';
import { getSettings, onSettingsChanged } from './settings';
import { copyTemplate, type Template } from './templates';
import type { Aspect, Asset, BrandKit, Clip, ClipType, Recipe, Settings } from './types';

/** What a failed make shows: an AI state card, or one of the two setup cards Making can show. */
export type MakeState = AiStateId | 'penv-disconnected' | 'groq-access';

/** A make that did not finish. `state` is undefined when you cancelled. */
export class MakeFailure extends Error {
  constructor(readonly state: MakeState | undefined, readonly retryAfterMs?: number) {
    super(state ? `Motikord could not make the clip: ${state}` : 'Motikord make cancelled');
    this.name = 'MakeFailure';
  }
}

export interface MakeInput { prompt: string; aspect: Aspect; type?: ClipType; assets: Asset[]; id?: string }
export interface MakeHooks extends AiOptions {
  settings?: Settings;
  brand?: BrandKit;
  save?: (clip: Clip) => Promise<void>;
  now?: () => number;
  onType?: (type: ClipType, by: 'groq' | 'builtin' | 'settings' | 'guess' | 'you') => void;
  onRecipe?: (recipe: Recipe) => void;
}
export interface MakeResult { clip: Clip; type: ClipType; notices: AiStateId[]; by: 'groq' | 'builtin' }

/** The failure a thrown error stands for. No key means Penv Cloud was disconnected when that is where the key came from. */
export function failureFor(error: unknown, settings: Pick<Settings, 'keySource'>): MakeFailure {
  if (error instanceof MakeFailure) return error;
  const ai = error instanceof AiError ? error : new AiError('invalid-reply', 'make');
  if (ai.code === 'cancelled') return new MakeFailure(undefined);
  if (ai.code === 'no-key') return new MakeFailure(settings.keySource === 'penv-app' ? 'penv-disconnected' : 'groq-down');
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

/** Detects the type, writes the recipe, checks it and saves the clip. Throws MakeFailure. */
export async function makeClip(input: MakeInput, hooks: MakeHooks = {}): Promise<MakeResult> {
  const { settings: given, brand, save = putClip, now = Date.now, onType, onRecipe, ...ai } = hooks;
  const settings = given ?? (await getSettings());
  try {
    let type = input.type;
    if (type) onType?.(type, 'you');
    else {
      const found = await detectType(input.prompt, { ...ai, settings });
      type = found.type;
      onType?.(type, found.by);
    }
    const fonts = input.assets.filter((a) => a.kind === 'font');
    const useBrand = brand?.useForNewClips;
    const wrote = await writeRecipe({
      prompt: input.prompt, type, aspect: input.aspect, assets: input.assets, id: input.id,
      brand: {
        colours: useBrand ? brand.colours.map((c) => c.hex) : undefined,
        headingFont: fonts[0]?.name ?? (useBrand ? brand.headingFont : undefined),
        bodyFont: fonts[0]?.name ?? (useBrand ? brand.bodyFont : undefined),
      },
    }, ai);
    let recipe = pruneAssets(wrote.recipe);
    const song = input.assets.find((a) => a.kind === 'audio');
    if (song && !recipe.music) recipe = { ...recipe, music: { assetId: song.id, volume: 0.8, fadeInMs: 500, fadeOutMs: 1000 }, assets: { ...recipe.assets, [song.id]: song } };
    if (useBrand) recipe = { ...recipe, brandApplied: true };
    onRecipe?.(recipe);
    const at = now();
    const clip: Clip = { id: recipe.id, recipe, history: [], createdAt: at, updatedAt: at };
    await save(clip);
    return { clip, type, notices: wrote.notices, by: wrote.by };
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
  steps: number;                 // finished steps of: clip type, writing, motion and layout, checking
  type?: ClipType; typeBy?: 'groq' | 'builtin' | 'settings' | 'guess' | 'you';
  recipe?: Recipe; clipId?: string;
  failure?: MakeState; retryAfterMs?: number;
  notices: AiStateId[]; by?: 'groq' | 'builtin';
  editorOpen: boolean;
}
const IDLE: RunState = { status: 'idle', steps: 0, notices: [], editorOpen: false };

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
  let sequence = 0;
  const patch = (p: Partial<RunState>) => store.set({ ...store.get(), ...p });

  async function start(d: MakeDraft, opts: { access?: HostAccess } = {}): Promise<void> {
    controller?.abort();
    const mine = ++sequence;
    const ctl = (controller = new AbortController());
    reserved = deps.id();
    placeholder = false;
    store.set({ ...IDLE, status: 'running', type: d.type });
    const live = () => mine === sequence;
    try {
      const settings = await deps.settings();
      if (opts.access === 'denied' && settings.ai === 'cloud') throw new MakeFailure('groq-access');
      const result = await deps.make(
        { prompt: promptFor(d), aspect: d.aspect ?? settings.defaultAspect, type: d.type, assets: d.attached, id: reserved },
        {
          signal: ctl.signal, fetch: deps.fetch, settings, brand: await deps.brand(), save: deps.save,
          onType: (type, by) => { if (live()) patch({ type, typeBy: by, steps: 1 }); },
          onRecipe: (recipe) => { if (live()) patch({ recipe, steps: 3 }); },
        },
      );
      if (!live()) return;
      patch({ status: 'done', steps: 4, clipId: result.clip.id, recipe: result.clip.recipe, notices: result.notices, by: result.by });
      if (store.get().editorOpen) await deps.notifySaved(result.clip.id);
      else { await deps.openEditor(result.clip.id); patch({ editorOpen: true }); }
    } catch (error) {
      if (!live()) return;
      const failure = failureFor(error, await deps.settings().catch(() => ({ keySource: null as Settings['keySource'] })));
      if (failure.state === undefined) { await discard(); store.set(IDLE); return; }
      await discard();
      patch({ status: 'failed', failure: failure.state, retryAfterMs: failure.retryAfterMs });
    }
  }

  /** "Open the editor now": opens the tab on a clip with its scenes still to come. */
  async function openNow(d: MakeDraft): Promise<void> {
    const s = store.get();
    if (s.status !== 'running' || !reserved || s.editorOpen) return;
    const settings = await deps.settings();
    const at = Date.now();
    const recipe: Recipe = {
      version: 1, id: reserved, name: promptFor(d).slice(0, 40), type: s.type ?? 'social', aspect: d.aspect ?? settings.defaultAspect,
      scenes: [{ id: 's1', durationMs: 3000, background: '#FFFFFF', layout: 'center', layers: [] }], assets: {}, prompt: d.prompt || undefined,
    };
    await deps.save({ id: reserved, recipe, history: [], createdAt: at, updatedAt: at });
    placeholder = true;
    patch({ editorOpen: true, clipId: reserved });
    await deps.openEditor(reserved);
  }

  async function discard(): Promise<void> {
    if (placeholder && reserved) await deps.remove(reserved).catch((e: unknown) => console.error('Motikord: could not remove the unfinished clip', e));
    placeholder = false;
  }

  async function cancel(): Promise<void> {
    sequence++;
    controller?.abort();
    await discard();
    store.set(IDLE);
  }

  return { get: store.get, subscribe: store.subscribe, start, openNow, cancel, reset: () => { sequence++; controller?.abort(); store.set(IDLE); } };
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
