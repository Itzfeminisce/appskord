import { PROVIDERS as LLM_PROVIDERS } from '@appskord/llm';
import { chat, pickProvider, type ChatMessage, type FetchLike, type ProviderConfig } from '@/lib/llm';
import { availableEngines, isCloudNotes, type Engine } from '@/lib/notes/engines';
import { loadKeys } from '@/lib/penv';
import { getSettings } from '@/lib/settings';
import { LIVE_MODEL } from '@/lib/transcribe/whisper';
import type { Call } from '@/lib/ai/ops';
import type { CloudSpeech, Settings } from '@/lib/types';

/** Everything Ask AI reaches outside React; tests set fakes with `setAiDeps`. Keys never leave this object. */
export interface AiDeps {
  keys(): Promise<Record<string, string>>;
  /** The Notes and Ask pick from Settings; Ask AI uses only this provider. */
  notes(): Promise<Settings['notes']>;
  /** The Transcripts pick from Settings, for "Say it instead". */
  transcripts?(): Promise<Settings['transcripts']>;
  fetch: FetchLike;
  online(): boolean;
  /** Calls `onChange` when the computer goes on or off line. */
  watchOnline(onChange: () => void): () => void;
  /** "Say it instead": starts the mic; `stop` resolves with the words heard, through the picked cloud Transcripts provider. */
  hear?(speech: Speech): Promise<{ stop(): Promise<string>; cancel(): void }>;
  /** Defaults to Chrome's `LanguageModel`; tests pass a fake. */
  globalObject?: object;
  /** Whether Whisper's live model is already downloaded, so the mic can use it here. */
  whisperReady?(): Promise<boolean>;
}

function browserAiDeps(): AiDeps {
  return {
    keys: loadKeys,
    notes: async () => (await getSettings()).notes,
    transcripts: async () => (await getSettings()).transcripts,
    fetch: (u, i) => fetch(u, i),
    online: () => navigator.onLine,
    watchOnline(onChange) {
      addEventListener('online', onChange);
      addEventListener('offline', onChange);
      return () => { removeEventListener('online', onChange); removeEventListener('offline', onChange); };
    },
    hear: async (speech) => (await import('./mic')).hear(speech),
    async whisperReady() {
      const cache = await caches.open(WHISPER_CACHE);
      return (await cache.keys()).some((r) => r.url.includes(`/${LIVE_MODEL}/`));
    },
  };
}

// Where transformers.js keeps downloaded models.
const WHISPER_CACHE = 'transformers-cache';

/** The Transcripts pick for the mic: a cloud provider with its key, or Whisper on this computer. */
export type Speech = { provider: CloudSpeech; model: string; key: string } | { provider: 'local'; model: string };

/** The picked cloud Transcripts provider when its key is loaded, or Whisper here when it is picked and downloaded; null hides the mic. */
export async function speechSetup(): Promise<Speech | null> {
  const picked = await aiDeps().transcripts?.().catch(() => undefined);
  if (!picked) return null;
  if (picked.provider === 'local') {
    const ready = await aiDeps().whisperReady?.().catch(() => false);
    return ready ? { provider: 'local', model: LIVE_MODEL } : null;
  }
  const key = (await aiDeps().keys())[LLM_PROVIDERS[picked.provider].keyName!];
  return key ? { provider: picked.provider, model: picked.model, key } : null;
}

let deps: AiDeps | null = null;
export const aiDeps = (): AiDeps => (deps ??= browserAiDeps());
export const setAiDeps = (next: AiDeps | null): void => { deps = next; };

const LOWER = new Set(['mini', 'nano', 'oss', 'turbo', 'flash', 'pro']);
const DROP = /^(versatile|instant|latest|preview|chat|instruct|\d+b|\d{4,8})$/i;

/** The short model name for people, never the id: "openai/gpt-oss-120b" is "GPT-oss", "claude-haiku-5-5" is "Claude Haiku 5.5". */
export function shortModel(id: string): string {
  const parts = (id.split('/').pop() ?? id).split(/[-_:]/).filter((t) => t && !DROP.test(t));
  const out: string[] = [];
  for (const t of parts) {
    const prev = out.at(-1);
    // Version parts split by dashes join with a dot: 4-5 is 4.5.
    if (prev && /^\d+(\.\d+)?$/.test(prev) && /^\d+$/.test(t)) { out[out.length - 1] = `${prev}.${t}`; continue; }
    if (prev === 'GPT') { out[out.length - 1] = `GPT-${t}`; continue; }
    out.push(/^gpt$/i.test(t) ? 'GPT' : LOWER.has(t.toLowerCase()) || /\d/.test(t) ? t : t[0]!.toUpperCase() + t.slice(1));
  }
  return out.join(' ') || id;
}

/** Who answers Ask AI: a cloud provider, or an engine on this computer. */
export type AiProvider = Pick<ProviderConfig, 'id' | 'model'> | { id: 'builtin' | 'ollama'; model: string };

const BUILTIN_LABEL = 'Chrome’s built-in AI';

/** The Ask AI header: "{provider} · {model}", with the provider's display name from `@appskord/llm`. */
export function header(p: AiProvider): string {
  if (p.id === 'builtin') return `${BUILTIN_LABEL} · on this computer`;
  const info = LLM_PROVIDERS[p.id];
  return `${info.label} · ${shortModel(p.model)}${info.host === 'localhost' ? ' · on this computer' : ''}`;
}
export const providerName = (p: AiProvider): string => (p.id === 'builtin' ? BUILTIN_LABEL : LLM_PROVIDERS[p.id].label);

export interface AiSetup { keys: Record<string, string>; provider: AiProvider; engine?: Engine }

/** The provider picked for Notes and Ask with its key, or an engine on this computer when a local one is picked; never another cloud provider. Null when AI is not set up. */
export async function setup(): Promise<AiSetup | null> {
  const notes = await aiDeps().notes().catch(() => undefined);
  if (!notes) return null;
  const keys = await aiDeps().keys();
  if (isCloudNotes(notes.provider)) {
    const picked = pickProvider(keys, notes.provider);
    return picked ? { keys, provider: { id: picked.id, model: notes.model || picked.model } } : null;
  }
  // A local pick: no keys are passed, so only engines on this computer can answer.
  const [engine] = await availableEngines({ settings: { notes }, keys: {}, fetchFn: aiDeps().fetch, globalObject: aiDeps().globalObject });
  if (!engine || isCloudNotes(engine.id)) return null;
  return { keys: {}, provider: { id: engine.id, model: engine.model ?? notes.model }, engine };
}

/** A conversation as one system and one user text, for engines that take only those. */
function flatten(messages: ChatMessage[]): { system: string; user: string } {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  const user = rest.length === 1 ? rest[0]!.content : rest.map((m) => `${m.role}: ${m.content}`).join('\n\n');
  return { system, user };
}

/** One JSON call with the set-up provider and model: through `@appskord/llm` for a cloud one, else the local engine. */
export function callWith(s: AiSetup, signal?: AbortSignal): Call {
  const engine = s.engine;
  if (engine) return async (messages) => { const { system, user } = flatten(messages); return engine.complete(system, user, { json: true, signal }); };
  const id = s.provider.id as ProviderConfig['id'];
  return (messages, { maxTokens }) =>
    chat(messages, { json: true, maxTokens, keys: s.keys, provider: id, model: s.provider.model, signal }, aiDeps().fetch);
}
