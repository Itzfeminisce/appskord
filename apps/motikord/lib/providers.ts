import { PROVIDERS as API_PROVIDERS, type ProviderKeyName } from '@appskord/llm';
import type { Provider } from './types';

/** What each cloud AI provider is called and where its keys come from. Strings are FRAMES.md "AI provider and model". */
export interface ProviderInfo {
  id: Provider;
  label: string;          // {provider}
  mono: string;           // the Settings tile monogram
  prefix: string;         // {prefix}
  keyName: ProviderKeyName; // {keyName}
  host: string;           // {host}
  keysUrl: string;
  getKey: string;         // "Get a free Groq key"; only Groq says "free"
}

// Motikord's tile monogram and "get a key" line; the rest comes from `@appskord/llm`.
const COPY: Record<Provider, { mono: string; getKey: string }> = {
  groq: { mono: 'Gq', getKey: 'Get a free Groq key' },
  openai: { mono: 'OA', getKey: 'Get an OpenAI key' },
  anthropic: { mono: 'An', getKey: 'Get an Anthropic key' },
  openrouter: { mono: 'OR', getKey: 'Get an OpenRouter key' },
};

const info = (id: Provider): ProviderInfo => {
  const p = API_PROVIDERS[id];
  return { id, label: p.label, prefix: p.prefix!, keyName: p.keyName!, host: p.host, keysUrl: p.keysUrl!, ...COPY[id] };
};

export const PROVIDERS: Record<Provider, ProviderInfo> = { groq: info('groq'), openai: info('openai'), anthropic: info('anthropic'), openrouter: info('openrouter') };

/** Models built into Motikord, so Settings always has something to pick: best first, then `faster` (a small one). */
export const SUGGESTED_MODELS: Record<Provider, { models: string[]; faster: string }> = {
  groq: { models: ['moonshotai/kimi-k2-instruct-0905', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'], faster: 'llama-3.1-8b-instant' },
  openai: { models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'], faster: 'gpt-4.1-mini' },
  anthropic: { models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'], faster: 'claude-haiku-4-5' },
  openrouter: { models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4.1', 'openai/gpt-4.1-mini'], faster: 'openai/gpt-4.1-mini' },
};

/** "a Groq key", "an OpenAI key". */
export const withArticle = (name: string) => `${/^[AEIOU]/i.test(name) ? 'an' : 'a'} ${name}`;

/** Settings and Setup order; Groq is the default. */
export const PROVIDER_IDS: Provider[] = ['groq', 'openai', 'anthropic', 'openrouter'];
export const DEFAULT_PROVIDER: Provider = 'groq';

export const isProvider = (v: unknown): v is Provider => typeof v === 'string' && (PROVIDER_IDS as string[]).includes(v);

/** The provider whose Penv Cloud key name this is, or undefined (Pexels). */
export function providerForKey(name: string): Provider | undefined {
  return PROVIDER_IDS.find((p) => PROVIDERS[p].keyName === name);
}
