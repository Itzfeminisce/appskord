/** Model lists from each provider's `/models`, and the model picked from them. */
import { fail, isAbort, LLMError, readError, type ApiError, type ErrorText } from './errors';
import { authHeaders, modelsUrl, PROVIDERS, type Endpoint, type ProviderId } from './providers';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Capable Groq chat models with JSON mode, best first. Groq retires models, so the one used is picked from /models. */
export const GROQ_MODEL_PREFERENCE = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

// Listed models that can't chat: speech, images, embeddings, moderation and agent systems.
const NOT_CHAT =
  /embed|whisper|tts|transcri|speech|audio|realtime|image|dall-e|moderation|guard|orpheus|compound|search|computer-use|davinci|babbage|turbo-instruct|sora|playai|distil/i;
// OpenAI models that only answer on the Responses API.
const OPENAI_NOT_CHAT = /-pro(\b|-)|deep-research|codex/i;

/** True when a model id names something that can't write text (speech, images, embeddings…). */
export const notForText = (model: string) => NOT_CHAT.test(model);

const VISION = /vision|llama-4|gpt-[4-9]|claude|gemini|grok-4|pixtral|qwen[\w.-]*vl|qwen3\.8/i;

/** True when a model id names a model that can read images. */
export const canSeeImages = (_provider: ProviderId, model: string) => VISION.test(model);

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
      if (provider === 'google' && !/^(models\/)?gemini/.test(m.id)) return false;
      const out = (m.architecture as { output_modalities?: unknown } | undefined)?.output_modalities;
      if (Array.isArray(out) && (!out.includes('text') || out.includes('image'))) return false;
      return true;
    })
    .map((m) => (provider === 'google' ? (m.id as string).replace(/^models\//, '') : (m.id as string)));
  const unique = [...new Set(ids)];
  return provider === 'anthropic' ? unique : unique.sort();
}

export interface PickOptions {
  /** Groq ids in the app's order of preference; GROQ_MODEL_PREFERENCE by default. */
  preference?: readonly string[];
  /** The app's curated default, used when nothing listed fits. */
  fallback?: string;
}

// The first suggested chat model the provider actually lists.
const listed = (provider: ProviderId, ids: string[]) => SUGGESTED[provider].chat?.find((id) => ids.includes(id));

/** The recommended model from a provider's chat model ids, else `fallback`. */
export function recommendedModel(provider: ProviderId, ids: string[], opts: PickOptions = {}): string | undefined {
  const { fallback } = opts;
  switch (provider) {
    case 'groq':
      return (opts.preference ?? GROQ_MODEL_PREFERENCE).find((id) => ids.includes(id)) ?? ids[0] ?? fallback;
    case 'openai':
      return (
        listed('openai', ids) ?? newest(ids, /^gpt-\d+(\.\d+)?o?$/) ?? newest(ids, /^gpt-\d/) ?? ids[0] ?? fallback
      );
    case 'anthropic':
      return listed('anthropic', ids) ?? ids.find((id) => /sonnet/.test(id)) ?? ids[0] ?? fallback;
    case 'openrouter':
      return (
        newest(ids, /^anthropic\/claude-sonnet-[\d.]+$/) ??
        newest(ids, /^anthropic\/claude-[\d.]+-sonnet$/) ??
        newest(ids, /^openai\/gpt-\d+(\.\d+)?o?$/) ??
        ids[0] ??
        fallback
      );
    case 'google':
      return listed('google', ids) ?? ids[0] ?? fallback;
    case 'xai':
      return listed('xai', ids) ?? ids[0] ?? fallback;
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
  return {
    models: recommended ? [recommended, ...ids.filter((id) => id !== recommended)] : ids,
    recommended,
  };
}

/** Where the picked model is remembered for the session. A model id is not a secret. */
export interface ModelCache {
  get(provider: ProviderId): Promise<string | undefined>;
  set(provider: ProviderId, model: string): Promise<void>;
  remove(provider: ProviderId): Promise<void>;
}

/** The recommended model, cached when a cache is given. A failed list is not cached and gives `fallback`. */
export async function recommendedFor(
  opts: ListOptions & {
    cache?: ModelCache;
    fresh: boolean;
    app: string;
    exclude?: string;
  },
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

export type ModelKind = 'chat' | 'speech';
export type ModelTag = 'Recommended' | 'Fastest' | 'Sees images';
export interface PickerModel {
  id: string;
  tag?: ModelTag;
}
export interface PickerList {
  models: PickerModel[];
  source: 'live' | 'suggested';
  /** Why the live list did not load (code `auth`, `offline`, `rate-limited`…); the suggested list shows instead. */
  error?: LLMError;
}
export interface PickerOptions {
  key?: string;
  fetch?: FetchLike;
  signal?: AbortSignal;
}

/** Sample lists shown when `/models` fails or no key is loaded; the first of each is "Recommended". */
export const SUGGESTED: Record<ProviderId, Partial<Record<ModelKind, readonly string[]>>> = {
  groq: {
    chat: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    speech: ['whisper-large-v3-turbo', 'whisper-large-v3'],
  },
  openai: {
    chat: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-luna'],
    speech: ['gpt-transcribe'],
  },
  anthropic: { chat: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'] },
  openrouter: { chat: [] },
  google: { chat: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.5-flash-lite'] },
  xai: { chat: ['grok-4.7'] },
  ollama: { chat: [] },
};

/** The speech-to-text model ids in a provider's /models `data`. Only Groq and OpenAI have any. */
export function speechModels(provider: ProviderId, data: unknown): string[] {
  const re = provider === 'groq' ? /^whisper-/ : provider === 'openai' ? /^gpt-transcribe$/ : undefined;
  if (!re || !Array.isArray(data)) return [];
  const ids = (data as Record<string, unknown>[])
    .filter((m) => typeof m?.id === 'string' && re.test(m.id) && m.active !== false)
    .map((m) => m.id as string);
  return [...new Set(ids)].sort();
}

const FASTEST = /gpt-oss-20b|-luna$|haiku|flash-lite/;

function tagged(provider: ProviderId, kind: ModelKind, ids: string[], recommended?: string): PickerModel[] {
  return ids.map((id) => {
    let tag: ModelTag | undefined;
    if (id === recommended) tag = 'Recommended';
    else if (kind === 'chat' && FASTEST.test(id)) tag = 'Fastest';
    else if (kind === 'chat' && canSeeImages(provider, id)) tag = 'Sees images';
    return tag ? { id, tag } : { id };
  });
}

const suggested = (provider: ProviderId, kind: ModelKind, error?: LLMError): PickerList => ({
  models: tagged(provider, kind, [...(SUGGESTED[provider][kind] ?? [])], SUGGESTED[provider][kind]?.[0]),
  source: 'suggested',
  ...(error ? { error } : {}),
});

const plainText: ErrorText = (f) => `${f.label}: ${f.reason}${f.status ? ` (${f.status})` : ''}`;

/** The models a provider offers for a job, tagged for the picker. Never throws: a failed list gives the suggested ones plus `error`. */
export async function listModelsFor(
  provider: ProviderId,
  kind: ModelKind,
  opts: PickerOptions = {},
): Promise<PickerList> {
  if (!SUGGESTED[provider][kind]) return { models: [], source: 'suggested' };
  if (!opts.key && provider !== 'ollama') return suggested(provider, kind);
  const label = PROVIDERS[provider].label;
  const fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
  try {
    let res: Response;
    try {
      res = await fetchFn(modelsUrl({ provider }), {
        method: 'GET',
        headers: authHeaders(provider, opts.key ?? ''),
        credentials: 'omit',
        signal: opts.signal,
      });
    } catch (e) {
      throw fail(plainText, {
        reason: isAbort(e) || opts.signal?.aborted ? 'cancelled' : 'offline',
        label,
      });
    }
    if (!res.ok) {
      const reason = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'busy' : 'status';
      throw fail(plainText, { reason, label, status: res.status });
    }
    let data: unknown;
    try {
      data = ((await res.json()) as { data?: unknown }).data;
    } catch {
      throw fail(plainText, { reason: 'unexpected-list', label });
    }
    const ids = kind === 'chat' ? chatModels(provider, data) : speechModels(provider, data);
    if (!ids.length) return suggested(provider, kind);
    const first = SUGGESTED[provider][kind]!.find((id) => ids.includes(id));
    const ordered = first ? [first, ...ids.filter((id) => id !== first)] : ids;
    return { models: tagged(provider, kind, ordered, first), source: 'live' };
  } catch (e) {
    if (e instanceof LLMError) return suggested(provider, kind, e);
    throw e;
  }
}
