import { chat, pickProvider, type FetchLike, type ProviderConfig, type ProviderId } from '@/lib/llm';
import { loadKeys } from '@/lib/penv';
import type { Call } from '@/lib/ai/ops';

/** Everything Ask AI reaches outside React; tests set fakes with `setAiDeps`. Keys never leave this object. */
export interface AiDeps {
  keys(): Promise<Record<string, string>>;
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

/** The header's provider: the one `chat` will use, as the frames name it. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  groq: 'Groq · Llama 3.3', openai: 'OpenAI · GPT-4.1 mini', openrouter: 'OpenRouter · gpt-oss-120b', anthropic: 'Anthropic · Claude Haiku 4.5',
};
export const providerName = (p: ProviderConfig): string => PROVIDER_LABELS[p.id].split(' · ')[0]!;

/** The loaded keys and the provider they give, or null when AI is not set up. */
export async function setup(): Promise<{ keys: Record<string, string>; provider: ProviderConfig } | null> {
  const keys = await aiDeps().keys();
  const provider = pickProvider(keys);
  return provider ? { keys, provider } : null;
}

/** One JSON call through `@appskord/llm` with these keys. */
export function callWith(keys: Record<string, string>, signal?: AbortSignal): Call {
  return (messages, { maxTokens }) => chat(messages, { json: true, maxTokens, keys, signal }, aiDeps().fetch);
}
