/** Motikord's AI calls, from `@appskord/llm`: the chosen cloud provider or Chrome's built-in AI, with Motikord's own sentences. */
import {
  chatCloud,
  chatLocal,
  chatUrl,
  listModels as listProviderModels,
  LLMError,
  modelsUrl,
  notForText,
  PROVIDERS as API_PROVIDERS,
  recommendedModel as pickModel,
  type ChatMessage,
  type ErrorText,
  type FetchLike,
  type LanguageModelLike,
  type ModelCache,
  type ModelList,
} from '@appskord/llm';
import type { AiMode, Provider } from './types';
import { DEFAULT_SETTINGS, getKey, getSettings } from './settings';
import { PROVIDER_IDS, SUGGESTED_MODELS } from './providers';

export {
  chatModels,
  extractJson,
  GROQ_MODEL_PREFERENCE,
  LLMError,
  notForText,
  type ChatMessage,
  type FetchLike,
  type LanguageModelLike,
  type LLMErrorCode,
  type ModelList,
} from '@appskord/llm';

export const GROQ_URL = chatUrl({ provider: 'groq' });
export const GROQ_MODELS_URL = modelsUrl({ provider: 'groq' });

/** Used when the provider's list can't be read; a wrong guess is re-picked from the list on model_not_found. */
export const FALLBACK_MODEL = Object.fromEntries(PROVIDER_IDS.map((p) => [p, SUGGESTED_MODELS[p].models[0]!])) as Record<Provider, string>;

/** Motikord's sentences. Screens show frame copy for the code instead, so these stay in logs and tests. */
const text: ErrorText = ({ reason, label, model, status, detail }) => {
  switch (reason) {
    case 'no-key': return `No ${label} key in this session.`;
    case 'offline': return `Could not reach ${label}.`;
    case 'cancelled': return 'Cancelled.';
    case 'auth': return `${label} did not accept the key.`;
    case 'busy': return `${label} is busy.`;
    case 'not-for-text': return `${model} can't write text.`;
    case 'model-not-found': return `${label} has no model ${model}.`;
    case 'no-model': return `${label} has no model Motikord can use.`;
    case 'bad-json': return `${label} could not write valid JSON.`;
    case 'refused': return `${label} refused the request (${detail ?? status}).`;
    case 'status': return `${label} returned ${status}.`;
    case 'unexpected-reply': return `${label} sent an unexpected reply.`;
    case 'cut-off': return `${label} cut the reply off.`;
    case 'no-list': return `${label} doesn't let this key list models.`;
    case 'unexpected-list': return `${label} sent an unexpected list.`;
    case 'local-unavailable': return 'Built-in AI is not available.';
    case 'local-turn': return 'The last message must be from the user.';
    case 'local-failed': return 'Built-in AI could not answer.';
  }
};

export interface ChatOptions {
  json?: boolean;           // ask for a JSON object reply
  maxTokens?: number;
  temperature?: number;     // default 0.2
  signal?: AbortSignal;
  fetch?: FetchLike;        // injected in tests and the scoring script
  ai?: AiMode;              // instead of Settings.ai
  provider?: Provider;      // instead of Settings.provider
  model?: string;           // instead of Settings.models[provider]
  key?: string;             // instead of the session key
  languageModel?: LanguageModelLike;
}

export interface ChatReply { text: string; by: Provider | 'builtin' }

type Store = { get(k: string): Promise<Record<string, unknown>>; set(o: Record<string, unknown>): Promise<void>; remove(k: string): Promise<void> };
const sessionStore = (): Store | undefined => { try { return browser.storage.session as unknown as Store; } catch { return undefined; } };
const cacheKey = (p: string) => `${p}Model`;

/** The recommended model per provider, kept in chrome.storage.session for the session. */
const modelCache: ModelCache = {
  async get(p) {
    const k = cacheKey(p);
    const v = await sessionStore()?.get(k).then((r) => r[k], () => undefined);
    return typeof v === 'string' && v ? v : undefined;
  },
  async set(p, model) { await sessionStore()?.set({ [cacheKey(p)]: model }); },
  async remove(p) { await sessionStore()?.remove(cacheKey(p)); },
};

/** Sends `messages` to the chosen AI and returns the reply text. Throws LLMError. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatReply> {
  const needSettings = !opts.ai || !opts.provider || opts.model === undefined;
  // The scoring script runs outside Chrome: no settings there, so the defaults apply.
  const settings = needSettings ? await getSettings().catch(() => DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
  const ai = opts.ai ?? settings.ai;
  if (ai === 'local') return { text: await chatLocal(messages, { text, json: opts.json, signal: opts.signal, languageModel: opts.languageModel }), by: 'builtin' };
  const provider = opts.provider ?? settings.provider;
  const model = opts.model ?? settings.models[provider];
  const key = opts.key ?? (await getKey(provider));
  const reply = await chatCloud(messages, {
    app: 'Motikord', text, provider, key, model, cache: modelCache, fallback: FALLBACK_MODEL[provider],
    json: opts.json, maxTokens: opts.maxTokens, temperature: opts.temperature, signal: opts.signal, fetch: opts.fetch,
  });
  return { text: reply, by: provider };
}

/** The model Motikord recommends from a provider's chat model ids; FALLBACK_MODEL when none fits. */
export function recommendedModel(provider: Provider, ids: string[]): string {
  return pickModel(provider, ids, { fallback: FALLBACK_MODEL[provider] }) ?? FALLBACK_MODEL[provider];
}

/** Asks the provider for its models: recommended first, then the rest. Throws LLMError (offline, auth, no-list, server, cancelled). */
export async function listModels(provider: Provider, key: string, fetchFn?: FetchLike, signal?: AbortSignal): Promise<ModelList & { recommended: string }> {
  const list = await listProviderModels({ provider, key, text, fetch: fetchFn, signal, fallback: FALLBACK_MODEL[provider] });
  return { ...list, recommended: list.recommended ?? FALLBACK_MODEL[provider] };
}

/** "Check model": one tiny request to `model` with `key`. Resolves the time it took in ms; throws LLMError. */
export async function checkModel(provider: Provider, model: string, key: string, fetchFn?: FetchLike, now: () => number = () => performance.now()): Promise<number> {
  if (notForText(model)) throw new LLMError(text({ reason: 'not-for-text', label: API_PROVIDERS[provider].label, model }), 'not-for-text');
  const start = now();
  await chat([{ role: 'user', content: 'Reply with OK.' }], { ai: 'cloud', provider, model, key, maxTokens: 16, temperature: 0, fetch: fetchFn });
  return now() - start;
}
