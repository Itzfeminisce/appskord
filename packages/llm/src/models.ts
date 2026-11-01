/** Model lists from each provider's `/models`, and the model picked from them. */
import { fail, isAbort, LLMError, readError, type ApiError, type ErrorText } from './errors';
import { authHeaders, modelsUrl, PROVIDERS, type Endpoint, type ProviderId } from './providers';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Capable Groq chat models with JSON mode, best first. Groq retires models, so the one used is picked from /models. */
export const GROQ_MODEL_PREFERENCE = [
  // Models that answer without reasoning first, so the whole token budget goes to the reply.
  'moonshotai/kimi-k2-instruct-0905',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
];

// Listed models that can't chat: speech, images, embeddings, moderation and agent systems.
const NOT_CHAT =
  /embed|whisper|tts|transcri|speech|audio|realtime|image|dall-e|moderation|guard|orpheus|compound|search|computer-use|davinci|babbage|turbo-instruct|sora|playai|distil/i;
// OpenAI models that only answer on the Responses API.
const OPENAI_NOT_CHAT = /-pro(\b|-)|deep-research|codex/i;

/** True when a model id names something that can't write text (speech, images, embeddings…). */
export const notForText = (model: string) => NOT_CHAT.test(model);

const ver = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
function newer(a: string, b: string): number {
  const x = ver(a);
  const y = ver(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? -1) !== (y[i] ?? -1)) return (y[i] ?? -1) - (x[i] ?? -1);
  return 0;
}
const newest = (ids: string[], re: RegExp) => ids.filter((id) => re.test(id)).sort(newer)[0];

/** The chat model ids in a provider's /models `data`, active only. Anthropic keeps its newest-first order; the rest are sorted. */
export function chatModels(provider: ProviderId, data: unknown): string[] {
  const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const ids = list
    .filter((m) => {
      if (typeof m?.id !== 'string' || !m.id || NOT_CHAT.test(m.id) || m.active === false) return false;
      if (provider === 'openai' && (OPENAI_NOT_CHAT.test(m.id) || !/^(gpt-|o\d|chatgpt-)/.test(m.id))) return false;
      if (provider === 'anthropic' && !m.id.startsWith('claude')) return false;
      const out = (m.architecture as { output_modalities?: unknown } | undefined)?.output_modalities;
      if (Array.isArray(out) && (!out.includes('text') || out.includes('image'))) return false;
      return true;
    })
    .map((m) => m.id as string);
  const unique = [...new Set(ids)];
  return provider === 'anthropic' ? unique : unique.sort();
}

export interface PickOptions {
  /** Groq ids in the app's order of preference; GROQ_MODEL_PREFERENCE by default. */
  preference?: readonly string[];
  /** The app's curated default, used when nothing listed fits. */
  fallback?: string;
}

/** The recommended model from a provider's chat model ids, else `fallback`. */
export function recommendedModel(provider: ProviderId, ids: string[], opts: PickOptions = {}): string | undefined {
  const { fallback } = opts;
  switch (provider) {
    case 'groq':
      return (opts.preference ?? GROQ_MODEL_PREFERENCE).find((id) => ids.includes(id)) ?? ids[0] ?? fallback;
    case 'openai':
      return newest(ids, /^gpt-\d+(\.\d+)?o?$/) ?? newest(ids, /^gpt-\d/) ?? ids[0] ?? fallback;
    case 'anthropic':
      return ids.find((id) => /sonnet/.test(id)) ?? ids[0] ?? fallback;
    case 'openrouter':
      return (
        newest(ids, /^anthropic\/claude-sonnet-[\d.]+$/) ??
        newest(ids, /^anthropic\/claude-[\d.]+-sonnet$/) ??
        newest(ids, /^openai\/gpt-\d+(\.\d+)?o?$/) ??
        ids[0] ??
        fallback
      );
    case 'ollama':
      return ids[0] ?? fallback;
  }
}

export interface ModelList {
  models: string[];
  recommended: string | undefined;
}

export interface ListOptions extends Endpoint, PickOptions {
  key: string;
  text: ErrorText;
  fetch?: FetchLike;
  signal?: AbortSignal;
}

// A key that works for chat but may not list models: OpenAI restricted and project keys without the "Models: Read" scope.
const missingScope = (e: ApiError) =>
  (e.status === 401 || e.status === 403) &&
  /scope|insufficient permissions|not allowed to|permission/i.test(e.message ?? '');

/** Asks the provider for its models: recommended first, then the rest. Throws LLMError (offline, auth, no-list, server, cancelled). */
export async function listModels(opts: ListOptions): Promise<ModelList> {
  const { provider, signal, text } = opts;
  const label = PROVIDERS[provider].label;
  const fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
  let res: Response;
  try {
    res = await fetchFn(modelsUrl(opts), {
      method: 'GET',
      headers: authHeaders(provider, opts.key, opts.openaiCompatible),
      credentials: 'omit',
      signal,
    });
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw fail(text, { reason: 'cancelled', label });
    throw fail(text, { reason: 'offline', label });
  }
  if (!res.ok) {
    const err = await readError(res);
    if (missingScope(err)) throw fail(text, { reason: 'no-list', label, status: err.status });
    if (res.status === 401 || res.status === 403) throw fail(text, { reason: 'auth', label, status: res.status });
    throw fail(text, { reason: 'status', label, status: res.status });
  }
  let data: unknown;
  try {
    data = ((await res.json()) as { data?: unknown }).data;
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw fail(text, { reason: 'cancelled', label });
    throw fail(text, { reason: 'unexpected-list', label });
  }
  const ids = chatModels(provider, data);
  const recommended = recommendedModel(provider, ids, opts);
  return { models: recommended ? [recommended, ...ids.filter((id) => id !== recommended)] : ids, recommended };
}

/** Where the picked model is remembered for the session. A model id is not a secret. */
export interface ModelCache {
  get(provider: ProviderId): Promise<string | undefined>;
  set(provider: ProviderId, model: string): Promise<void>;
  remove(provider: ProviderId): Promise<void>;
}

/** The recommended model, cached when a cache is given. A failed list is not cached and gives `fallback`. */
export async function recommendedFor(
  opts: ListOptions & { cache?: ModelCache; fresh: boolean; app: string; exclude?: string },
): Promise<string | undefined> {
  const { cache, provider, exclude } = opts;
  if (opts.fresh) await cache?.remove(provider).catch(() => undefined);
  else {
    const cached = await cache?.get(provider).catch(() => undefined);
    if (cached) return cached;
  }
  let id: string | undefined;
  try {
    const { models, recommended } = await listModels(opts);
    // `exclude` is the model that just failed: never hand it back.
    id = exclude
      ? recommendedModel(
          provider,
          models.filter((m) => m !== exclude),
          opts,
        )
      : recommended;
  } catch (e) {
    if (e instanceof LLMError && e.code === 'cancelled') throw e;
    if (e instanceof LLMError && e.code !== 'offline' && e.code !== 'no-list') {
      console.error(`${opts.app}: could not list ${PROVIDERS[provider].label} models`, e.message);
    }
    return opts.fallback === exclude ? undefined : opts.fallback;
  }
  if (id === exclude) id = undefined;
  if (id) await cache?.set(provider, id).catch(() => undefined);
  return id;
}
