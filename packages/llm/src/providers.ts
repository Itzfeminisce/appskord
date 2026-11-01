/** The AI providers the apps talk to: where their API lives, how a key authenticates, and what the key is called. */

export type ProviderId = 'groq' | 'openai' | 'anthropic' | 'openrouter' | 'ollama';
export type CloudProviderId = Exclude<ProviderId, 'ollama'>;
export type ProviderKeyName = 'GROQ_API_KEY' | 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'OPENROUTER_API_KEY';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  baseUrl: string;
  host: string;
  /** 'anthropic' speaks the Messages API; the rest speak OpenAI's `/chat/completions`. */
  api: 'openai' | 'anthropic';
  keyName?: ProviderKeyName; // none for Ollama
  prefix?: string;
  keysUrl?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  groq: {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    host: 'api.groq.com',
    api: 'openai',
    keyName: 'GROQ_API_KEY',
    prefix: 'gsk_',
    keysUrl: 'https://console.groq.com/keys',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    host: 'api.openai.com',
    api: 'openai',
    keyName: 'OPENAI_API_KEY',
    prefix: 'sk-',
    keysUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    host: 'api.anthropic.com',
    api: 'anthropic',
    keyName: 'ANTHROPIC_API_KEY',
    prefix: 'sk-ant-',
    keysUrl: 'https://console.anthropic.com/settings/keys',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    host: 'openrouter.ai',
    api: 'openai',
    keyName: 'OPENROUTER_API_KEY',
    prefix: 'sk-or-',
    keysUrl: 'https://openrouter.ai/keys',
  },
  ollama: { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', host: 'localhost', api: 'openai' },
};

export const ANTHROPIC_VERSION = '2023-06-01';

/** Where a request goes and how it is signed: the provider, an optional base URL override, and whether to force `/chat/completions`. */
export interface Endpoint {
  provider: ProviderId;
  baseUrl?: string;
  /** Send every provider, Anthropic too, through OpenAI's `/chat/completions` with a Bearer key. */
  openaiCompatible?: boolean;
}

const base = (e: Endpoint) => (e.baseUrl || PROVIDERS[e.provider].baseUrl).replace(/\/+$/, '');
export const apiOf = (e: Endpoint): 'openai' | 'anthropic' =>
  e.openaiCompatible ? 'openai' : PROVIDERS[e.provider].api;

export function chatUrl(e: Endpoint): string {
  return `${base(e)}${apiOf(e) === 'anthropic' ? '/messages' : '/chat/completions'}`;
}

export function modelsUrl(e: Endpoint): string {
  return `${base(e)}/models${apiOf(e) === 'anthropic' ? '?limit=1000' : ''}`;
}

/** Request headers for a provider's API. The key goes only here. */
export function authHeaders(provider: ProviderId, key: string, openaiCompatible = false): Record<string, string> {
  if (provider === 'anthropic' && !openaiCompatible) {
    return {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }
  return { Authorization: `Bearer ${key}` };
}

export const CLOUD_PROVIDER_IDS: CloudProviderId[] = ['groq', 'openai', 'anthropic', 'openrouter'];

/** The cloud provider whose key name this is, or undefined. */
export function providerForKey(name: string): CloudProviderId | undefined {
  return CLOUD_PROVIDER_IDS.find((p) => PROVIDERS[p].keyName === name);
}

export const isProviderKeyName = (name: string): name is ProviderKeyName => providerForKey(name) !== undefined;
