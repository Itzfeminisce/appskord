/** Klipkord's chat client for cloud notes, from `@appskord/llm`, with Klipkord's own sentences. Never logs or returns a key. */
import { chatCloud, LLMError, PROVIDERS as API_PROVIDERS, type ChatMessage, type ErrorText, type FetchLike, type ProviderKeyName } from '@appskord/llm';
import { loadKeys } from './penv';

export { LLMError, type ChatMessage, type FetchLike, type LLMErrorCode } from '@appskord/llm';

export type ProviderId = 'groq' | 'openai' | 'openrouter' | 'anthropic' | 'google' | 'xai';

export interface ProviderConfig { id: ProviderId; baseUrl: string; keyName: ProviderKeyName; model: string }

const provider = (id: ProviderId, model: string): ProviderConfig => ({ id, baseUrl: API_PROVIDERS[id].baseUrl, keyName: API_PROVIDERS[id].keyName!, model });

/** In fallback order: the first provider with a key loaded writes the notes. */
export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  groq: provider('groq', 'llama-3.3-70b-versatile'),
  openai: provider('openai', 'gpt-4.1-mini'),
  openrouter: provider('openrouter', 'openai/gpt-oss-120b'),
  anthropic: provider('anthropic', 'claude-haiku-4-5'),
  google: provider('google', 'gemini-2.5-flash'),
  xai: provider('xai', 'grok-3-mini'),
};

export interface ChatOptions {
  provider?: ProviderId;   // default: the first provider with a key
  json?: boolean;          // ask for a JSON object reply
  maxTokens?: number;
  temperature?: number;    // default 0.2
  signal?: AbortSignal;
  keys?: Record<string, string>; // use these instead of storage
}

const text: ErrorText = ({ reason, status }) => {
  if (reason === 'no-key') return 'No cloud key is loaded.';
  if (reason === 'offline' || reason === 'cancelled') return 'Could not reach the AI service.';
  if (reason === 'auth') return 'The AI service did not accept the key.';
  if (reason === 'busy') return 'The AI service is busy.';
  if (status) return `The AI service returned an error (${status}).`;
  return 'The AI service sent an unexpected reply.';
};

// A model the provider listed in place of a retired default, for the rest of the session.
const repicked: Partial<Record<ProviderId, string>> = {};

/** The provider to use: the requested one, else the first whose key is loaded. */
export function pickProvider(keys: Record<string, string>, wanted?: ProviderId): ProviderConfig | undefined {
  if (wanted) return keys[PROVIDERS[wanted].keyName] ? PROVIDERS[wanted] : undefined;
  return Object.values(PROVIDERS).find((p) => keys[p.keyName]);
}

/** Sends `messages` and returns the reply text. Throws LLMError. */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
  fetchFn: FetchLike = (u, i) => fetch(u, i),
): Promise<string> {
  const keys = opts.keys ?? (await loadKeys());
  const p = pickProvider(keys, opts.provider);
  if (!p) throw new LLMError(text({ reason: 'no-key', label: '' }), 'no-key');
  return chatCloud(messages, {
    app: 'Klipkord',
    text,
    provider: p.id,
    // Anthropic goes through its OpenAI-compatible endpoint, as before.
    openaiCompatible: true,
    key: keys[p.keyName],
    model: repicked[p.id] ?? p.model,
    // Only Groq retires the default under it; any other gone model is reported.
    modelGone: p.id === 'groq' ? 'repick' : 'report',
    onRepick: (model) => { repicked[p.id] = model; },
    json: opts.json,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    signal: opts.signal,
    fetch: fetchFn,
  });
}
