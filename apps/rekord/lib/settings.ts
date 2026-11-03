import { PROVIDERS as API_PROVIDERS, SUGGESTED } from '@appskord/llm';
import type { ProviderConfig, ProviderId, Settings } from './types';

const STORAGE_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  transcription: { provider: 'groq', model: 'whisper-large-v3-turbo' },
  summary: { provider: 'groq', model: 'openai/gpt-oss-120b' },
  keySource: 'penv',
  penv: { org: 'penvhq', project: 'meeting-notes-taker', env: 'testing' },
  language: 'en',
  onboarded: false,
  features: { ask: true, liveSuggestions: true, speakerNames: true },
  diarization: { provider: 'deepgram', model: 'nova-3', keyName: 'DEEPGRAM_API_KEY' },
  keepAudio: false,
  setup: 'free',
  realtimeBackup: true,
  google: { calendar: false, docs: false },
  notion: {},
  memory: {
    recall: true,
    clash: false,
    brief: { on: true, minutes: 5 },
    dueReminders: true,
    lookBack: { on: true, day: 5, hour: 16 },
    tellPeople: true,
    searchModel: 'none',
    backfill: 'ask',
    folder: false,
  },
};

const provider = (id: ProviderId): ProviderConfig => {
  const { baseUrl, keyName } = API_PROVIDERS[id];
  return keyName ? { id, baseUrl, keyName } : { id, baseUrl };
};

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  groq: provider('groq'),
  openrouter: provider('openrouter'),
  ollama: provider('ollama'),
  openai: provider('openai'),
  anthropic: provider('anthropic'),
  google: provider('google'),
  xai: provider('xai'),
};

// Retired ids from MODELS.md: a saved one moves to the provider's Recommended model, if it has one.
const RETIRED = new Set([
  'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'moonshotai/kimi-k2-instruct-0905',
  'meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3.6-27b',
  'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1',
]);

function unretired<C extends { provider: string; model: string; gone?: string }>(c: C, kind: 'chat' | 'speech'): C {
  const next = RETIRED.has(c.model) ? SUGGESTED[c.provider as ProviderId]?.[kind]?.[0] : undefined;
  return next ? { ...c, model: next, gone: c.model } : c;
}

function merge(stored: Partial<Settings> | undefined): Settings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    transcription: unretired({ ...DEFAULT_SETTINGS.transcription, ...s.transcription }, 'speech'),
    summary: unretired({ ...DEFAULT_SETTINGS.summary, ...s.summary }, 'chat'),
    penv: { ...DEFAULT_SETTINGS.penv, ...s.penv },
    features: { ...DEFAULT_SETTINGS.features, ...s.features },
    diarization: { ...DEFAULT_SETTINGS.diarization, ...s.diarization },
    google: { ...DEFAULT_SETTINGS.google, ...s.google },
    notion: { ...DEFAULT_SETTINGS.notion, ...s.notion },
    memory: {
      ...DEFAULT_SETTINGS.memory,
      ...s.memory,
      brief: { ...DEFAULT_SETTINGS.memory.brief, ...s.memory?.brief },
      lookBack: { ...DEFAULT_SETTINGS.memory.lookBack, ...s.memory?.lookBack },
    },
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return merge(stored[STORAGE_KEY] as Partial<Settings> | undefined);
}

/** Shallow-merges top-level fields; nested objects passed are replaced whole. Returns the new settings. */
export async function updateSettings(partial: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...partial };
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** Calls `cb` with the full settings whenever they change. Returns an unsubscribe function. */
export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && STORAGE_KEY in changes) cb(merge(changes[STORAGE_KEY].newValue as Partial<Settings>));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
