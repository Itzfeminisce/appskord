import { PROVIDERS, SUGGESTED } from '@appskord/llm';
import type { CloudNotes, CloudSpeech, ModelChoice, NotesProvider, Settings, TranscriptsProvider } from './types';

const STORAGE_KEY = 'settings';

export const WHISPER = 'whisper';
export const BUILTIN = 'builtin';

/** The provider's Recommended model: the first suggested one in `@appskord/llm` (MODELS.md). */
export const recommendedSpeech = (p: CloudSpeech): string => SUGGESTED[p].speech![0]!;
/** Undefined for a provider with no fixed list (OpenRouter), which relies on the live list. */
export const recommendedChat = (p: CloudNotes): string | undefined => SUGGESTED[p].chat?.[0];

/** Groq for both pickers: what "Faster with Groq" and v1's `ai: 'cloud'` mean. */
export const GROQ_BOTH: Pick<Settings, 'transcripts' | 'notes'> = {
  transcripts: { provider: 'groq', model: recommendedSpeech('groq') },
  notes: { provider: 'groq', model: recommendedChat('groq')! },
};

// Retired ids from MODELS.md: a saved one is replaced by the provider's Recommended model, if it has one.
const RETIRED = new Set([
  'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'moonshotai/kimi-k2-instruct-0905',
  'meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3.6-27b',
  'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1',
]);

export const DEFAULT_SETTINGS: Settings = {
  transcripts: { provider: 'local', model: WHISPER },
  notes: { provider: 'builtin', model: BUILTIN },
  language: 'auto',
  keySource: null,
  capture: { mode: 'tab', mic: true, camera: false, sound: true, quality: '1080p' },
  bubble: { corner: 'bottom-left', size: 'M', mode: 'floating' },
  draw: { tool: 'pen', color: '#C2410C' },
  cleanup: { pauses: true, fillers: true, minPause: 2 },
  bakeCamera: false,
};

type Nested = 'capture' | 'bubble' | 'draw' | 'cleanup';

/** Settings saved before the model pickers: `ai` and `notesEngine` instead of `transcripts` and `notes`. */
type Stored = Partial<Settings> & { ai?: 'local' | 'cloud'; notesEngine?: 'builtin' | 'ollama' | 'groq' };

/** A retired id moves to the Recommended model and an empty one is filled with it; with no Recommended model the stored id stays. */
function unretired<P extends string>(c: ModelChoice<P>, recommended: (p: P) => string | undefined): ModelChoice<P> {
  const next = RETIRED.has(c.model) || !c.model ? recommended(c.provider) : undefined;
  if (!next) return c;
  return c.model ? { provider: c.provider, model: next, gone: c.model } : { ...c, model: next };
}

/** `transcripts` and `notes` from what is stored, moving v1-v3's `ai` and `notesEngine` over. */
export function migrateAi(s: Stored): Pick<Settings, 'transcripts' | 'notes'> {
  const cloud = s.ai === 'cloud';
  const engine = s.notesEngine ?? 'builtin';
  const oldNotes: ModelChoice<NotesProvider> =
    cloud || engine === 'groq' ? GROQ_BOTH.notes : engine === 'ollama' ? { provider: 'ollama', model: '' } : DEFAULT_SETTINGS.notes;
  const transcripts: ModelChoice<TranscriptsProvider> = s.transcripts ?? (cloud ? GROQ_BOTH.transcripts : DEFAULT_SETTINGS.transcripts);
  const notes = s.notes ?? oldNotes;
  return {
    transcripts: unretired(transcripts, (p) => (p === 'local' ? undefined : recommendedSpeech(p))),
    notes: unretired(notes, (p) => (p === 'builtin' || p === 'ollama' ? undefined : recommendedChat(p))),
  };
}

/** True when either picker sends something to a cloud provider. */
export const usesCloud = (s: Pick<Settings, 'transcripts' | 'notes'>): boolean =>
  s.transcripts.provider !== 'local' || (s.notes.provider !== 'builtin' && s.notes.provider !== 'ollama');

/** Fills every missing field from the defaults, including inside `capture`, `bubble`, `draw` and `cleanup`. */
export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const { ai: _ai, notesEngine: _engine, ...s } = (stored ?? {}) as Stored;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    ...migrateAi(stored ?? {}),
    capture: { ...DEFAULT_SETTINGS.capture, ...s.capture },
    bubble: { ...DEFAULT_SETTINGS.bubble, ...s.bubble },
    draw: { ...DEFAULT_SETTINGS.draw, ...s.draw },
    cleanup: { ...DEFAULT_SETTINGS.cleanup, ...s.cleanup },
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return mergeSettings(stored[STORAGE_KEY] as Partial<Settings> | undefined);
}

/** Merges top-level fields; `capture`, `bubble`, `draw` and `cleanup` merge one level deeper. Returns the new settings. */
export async function updateSettings(
  partial: Omit<Partial<Settings>, Nested> & { [K in Nested]?: Partial<Settings[K]> },
): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    ...current,
    ...partial,
    capture: { ...current.capture, ...partial.capture },
    bubble: { ...current.bubble, ...partial.bubble },
    draw: { ...current.draw, ...partial.draw },
    cleanup: { ...current.cleanup, ...partial.cleanup },
  };
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** Calls `cb` with the full settings whenever they change. Returns an unsubscribe function. */
export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && STORAGE_KEY in changes) cb(mergeSettings(changes[STORAGE_KEY].newValue as Partial<Settings>));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

export const getHintHidden = async (): Promise<boolean> => (await getSettings()).setupHintHidden === true;

export const setHintHidden = async (hidden: boolean): Promise<void> => void (await updateSettings({ setupHintHidden: hidden }));

/** Transcripts can be made without asking: a cloud provider with its key, or the local model already downloaded. */
export function aiReady(s: Pick<Settings, 'transcripts'>, keyNames: string[], modelCached: boolean): boolean {
  const { provider } = s.transcripts;
  return provider === 'local' ? modelCached : keyNames.includes(PROVIDERS[provider].keyName ?? '');
}

/** The Home "Set up AI" hint: no AI ready and not hidden. */
export const showSetupHint = (ready: boolean, hidden: boolean): boolean => !ready && !hidden;
