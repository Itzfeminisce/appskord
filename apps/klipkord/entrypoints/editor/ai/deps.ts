import { PROVIDERS as LLM_PROVIDERS } from '@appskord/llm';
import { chat, pickProvider, type FetchLike, type ProviderConfig } from '@/lib/llm';
import { isCloudNotes } from '@/lib/notes/engines';
import { loadKeys } from '@/lib/penv';
import { getSettings } from '@/lib/settings';
import type { Call } from '@/lib/ai/ops';
import type { Settings } from '@/lib/types';

/** Everything Ask AI reaches outside React; tests set fakes with `setAiDeps`. Keys never leave this object. */
export interface AiDeps {
  keys(): Promise<Record<string, string>>;
  /** The Notes and Ask pick from Settings; absent means the first provider with a key. */
  notes?(): Promise<Settings['notes']>;
  fetch: FetchLike;
  online(): boolean;
  /** Calls `onChange` when the computer goes on or off line. */
  watchOnline(onChange: () => void): () => void;
  /** "Say it instead": starts the mic; `stop` resolves with the words heard, through the v2 Groq transcribe path. */
  hear?(groqKey: string): Promise<{ stop(): Promise<string>; cancel(): void }>;
}

function browserAiDeps(): AiDeps {
  return {
    keys: loadKeys,
    notes: async () => (await getSettings()).notes,
    fetch: (u, i) => fetch(u, i),
    online: () => navigator.onLine,
    watchOnline(onChange) {
      addEventListener('online', onChange);
      addEventListener('offline', onChange);
      return () => { removeEventListener('online', onChange); removeEventListener('offline', onChange); };
    },
    hear: async (key) => (await import('./mic')).hear(key),
  };
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

/** The Ask AI header: "{provider} · {model}", with the provider's display name from `@appskord/llm`. */
export function header(p: ProviderConfig): string {
  const info = LLM_PROVIDERS[p.id];
  return `${info.label} · ${shortModel(p.model)}${info.host === 'localhost' ? ' · on this computer' : ''}`;
}
export const providerName = (p: ProviderConfig): string => LLM_PROVIDERS[p.id].label;

export interface AiSetup { keys: Record<string, string>; provider: ProviderConfig }

/** The loaded keys and the provider to use: the cloud one picked in Settings when its key is loaded, else the first with a key. Null when AI is not set up. */
export async function setup(): Promise<AiSetup | null> {
  const keys = await aiDeps().keys();
  const notes = await aiDeps().notes?.().catch(() => undefined);
  const picked = notes && isCloudNotes(notes.provider) ? pickProvider(keys, notes.provider) : undefined;
  const provider = picked && notes?.model ? { ...picked, model: notes.model } : (picked ?? pickProvider(keys));
  return provider ? { keys, provider } : null;
}

/** One JSON call through `@appskord/llm` with the set-up provider and model. */
export function callWith(s: AiSetup, signal?: AbortSignal): Call {
  return (messages, { maxTokens }) =>
    chat(messages, { json: true, maxTokens, keys: s.keys, provider: s.provider.id, model: s.provider.model, signal }, aiDeps().fetch);
}
