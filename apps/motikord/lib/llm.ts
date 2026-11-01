/**
 * Chat client adapted from Rekord's llm.ts: a cloud provider (Groq, OpenAI, OpenRouter: OpenAI-compatible; Anthropic: Messages API)
 * or Chrome's built-in LanguageModel. Never logs or returns a key, and never logs a prompt. Errors are LLMError with a `code`.
 */
import type { AiMode, Provider } from './types';
import { DEFAULT_SETTINGS, getKey, getSettings } from './settings';
import { PROVIDER_IDS, PROVIDERS, SUGGESTED_MODELS } from './providers';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export const PROVIDER_API: Record<Provider, { chatUrl: string; modelsUrl: string }> = {
  groq: { chatUrl: 'https://api.groq.com/openai/v1/chat/completions', modelsUrl: 'https://api.groq.com/openai/v1/models' },
  openai: { chatUrl: 'https://api.openai.com/v1/chat/completions', modelsUrl: 'https://api.openai.com/v1/models' },
  openrouter: { chatUrl: 'https://openrouter.ai/api/v1/chat/completions', modelsUrl: 'https://openrouter.ai/api/v1/models' },
  anthropic: { chatUrl: 'https://api.anthropic.com/v1/messages', modelsUrl: 'https://api.anthropic.com/v1/models?limit=1000' },
};
export const GROQ_URL = PROVIDER_API.groq.chatUrl;
export const GROQ_MODELS_URL = PROVIDER_API.groq.modelsUrl;
export const ANTHROPIC_VERSION = '2023-06-01';

/** Capable chat models with JSON mode, best first. Groq retires models, so the one used is picked from /models. */
export const GROQ_MODEL_PREFERENCE = [
  // Models that answer without reasoning first, so the whole token budget goes to the recipe.
  'moonshotai/kimi-k2-instruct-0905',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
];
/** Used when the provider's list can't be read; a wrong guess is re-picked from the list on model_not_found. */
export const FALLBACK_MODEL = Object.fromEntries(PROVIDER_IDS.map((p) => [p, SUGGESTED_MODELS[p].models[0]!])) as Record<Provider, string>;
// Listed models that can't write a clip: speech, images, embeddings, moderation and agent systems.
const NOT_CHAT = /embed|whisper|tts|transcri|speech|audio|realtime|image|dall-e|moderation|guard|orpheus|compound|search|computer-use|davinci|babbage|turbo-instruct|sora|playai/i;
// OpenAI models that only answer on the Responses API.
const OPENAI_NOT_CHAT = /-pro(\b|-)|deep-research|codex/i;
const cacheKey = (p: Provider) => `${p}Model`; // a model id is not a secret

/** The slice of Chrome's built-in AI (`LanguageModel`) Motikord uses. */
export interface LanguageModelLike {
  availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts: { initialPrompts?: ChatMessage[]; temperature?: number; topK?: number; signal?: AbortSignal }): Promise<{
    prompt(input: string, opts?: { signal?: AbortSignal; responseConstraint?: object }): Promise<string>;
    destroy?(): void;
  }>;
}

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

export type LLMErrorCode = 'no-key' | 'offline' | 'auth' | 'rate-limited' | 'server' | 'bad-reply' | 'local-unavailable' | 'cancelled'
  | 'model-not-found' | 'not-for-text' | 'no-list';

export class LLMError extends Error {
  constructor(message: string, readonly code: LLMErrorCode, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'LLMError';
  }
}

export interface ChatReply { text: string; by: Provider | 'builtin' }

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const cancelled = () => new LLMError('Cancelled.', 'cancelled');

/** Sends `messages` to the chosen AI and returns the reply text. Throws LLMError. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatReply> {
  const needSettings = !opts.ai || !opts.provider || opts.model === undefined;
  // The scoring script runs outside Chrome: no settings there, so the defaults apply.
  const settings = needSettings ? await getSettings().catch(() => DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
  const ai = opts.ai ?? settings.ai;
  if (ai === 'local') return { text: await chatLocal(messages, opts), by: 'builtin' };
  const provider = opts.provider ?? settings.provider;
  const model = opts.model ?? settings.models[provider];
  return { text: await chatCloud(provider, messages, opts, model || undefined), by: provider };
}

/** Request headers for a provider's API. The key goes only here. */
export function authHeaders(provider: Provider, key: string): Record<string, string> {
  if (provider === 'anthropic') return { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' };
  return { Authorization: `Bearer ${key}` };
}

// ---- Model lists ----

const ver = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
function newer(a: string, b: string): number {
  const x = ver(a), y = ver(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (y[i] ?? -1) - (x[i] ?? -1);
  return 0;
}
const newest = (ids: string[], re: RegExp) => ids.filter((id) => re.test(id)).sort(newer)[0];

/** The chat model ids in a provider's /models reply, in the order the list shows them. */
export function chatModels(provider: Provider, data: unknown): string[] {
  const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const ids = list.filter((m) => {
    if (typeof m?.id !== 'string' || !m.id || NOT_CHAT.test(m.id) || m.active === false) return false;
    if (provider === 'openai' && (OPENAI_NOT_CHAT.test(m.id) || !/^(gpt-|o\d|chatgpt-)/.test(m.id))) return false;
    if (provider === 'anthropic' && !m.id.startsWith('claude')) return false;
    const arch = m.architecture as { input_modalities?: unknown; output_modalities?: unknown } | undefined;
    const out = arch?.output_modalities;
    if (Array.isArray(out) && (!out.includes('text') || out.includes('image'))) return false;
    return true;
  }).map((m) => m.id as string);
  const unique = [...new Set(ids)];
  // Anthropic lists newest first; the others have no useful order.
  return provider === 'anthropic' ? unique : unique.sort();
}

/** The model Motikord recommends from a provider's chat model ids; FALLBACK_MODEL when none fits. */
export function recommendedModel(provider: Provider, ids: string[]): string {
  switch (provider) {
    case 'groq': return GROQ_MODEL_PREFERENCE.find((id) => ids.includes(id)) ?? ids[0] ?? FALLBACK_MODEL.groq;
    case 'openai': return newest(ids, /^gpt-\d+(\.\d+)?o?$/) ?? newest(ids, /^gpt-\d/) ?? ids[0] ?? FALLBACK_MODEL.openai;
    case 'anthropic': return ids.find((id) => /sonnet/.test(id)) ?? ids[0] ?? FALLBACK_MODEL.anthropic;
    case 'openrouter':
      return newest(ids, /^anthropic\/claude-sonnet-[\d.]+$/) ?? newest(ids, /^anthropic\/claude-[\d.]+-sonnet$/)
        ?? newest(ids, /^openai\/gpt-\d+(\.\d+)?o?$/) ?? ids[0] ?? FALLBACK_MODEL.openrouter;
  }
}

/** Kept for Groq callers: the recommended id in a Groq /models `data` array. */
export function pickGroqModel(data: unknown): string {
  return recommendedModel('groq', chatModels('groq', data));
}

export interface ModelList { models: string[]; recommended: string }

/** True when a model id names something that can't write a clip (speech, images, embeddings…). */
export const notForText = (model: string) => NOT_CHAT.test(model);

// A key that works for chat but may not list models: OpenAI restricted and project keys without the "Models: Read" scope.
const missingScope = (e: ApiError) => (e.status === 401 || e.status === 403) && /scope|insufficient permissions|not allowed to|permission/i.test(e.message ?? '');

/** Asks the provider for its models: recommended first, then the rest. Throws LLMError (offline, auth, no-list, server, cancelled). */
export async function listModels(provider: Provider, key: string, fetchFn: FetchLike = (u, i) => fetch(u, i), signal?: AbortSignal): Promise<ModelList> {
  const label = PROVIDERS[provider].label;
  let res: Response;
  try {
    res = await fetchFn(PROVIDER_API[provider].modelsUrl, { method: 'GET', headers: authHeaders(provider, key), credentials: 'omit', signal });
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw cancelled();
    throw new LLMError(`Could not reach ${label}.`, 'offline');
  }
  if (!res.ok) {
    const err = await readError(res);
    if (missingScope(err)) throw new LLMError(`${label} doesn't let this key list models.`, 'no-list');
    if (res.status === 401 || res.status === 403) throw new LLMError(`${label} did not accept the key.`, 'auth');
    throw new LLMError(`${label} returned ${res.status}.`, 'server');
  }
  let data: unknown;
  try { data = ((await res.json()) as { data?: unknown }).data; } catch (e) {
    if (isAbort(e) || signal?.aborted) throw cancelled();
    throw new LLMError(`${label} sent an unexpected list.`, 'server');
  }
  const ids = chatModels(provider, data);
  const recommended = recommendedModel(provider, ids);
  return { models: [recommended, ...ids.filter((id) => id !== recommended)], recommended };
}

type Store = { get(k: string): Promise<Record<string, unknown>>; set(o: Record<string, unknown>): Promise<void>; remove(k: string): Promise<void> };
const sessionStore = (): Store | undefined => { try { return browser.storage.session as unknown as Store; } catch { return undefined; } };

/** The recommended model, cached for the session. A failed list is not cached, so the next call asks again. */
async function recommendedFor(provider: Provider, key: string, fetchFn: FetchLike, signal: AbortSignal | undefined, fresh: boolean): Promise<string> {
  const store = sessionStore();
  const k = cacheKey(provider);
  if (fresh) await store?.remove(k).catch(() => undefined);
  else {
    const cached = await store?.get(k).then((r) => r[k], () => undefined);
    if (typeof cached === 'string' && cached) return cached;
  }
  let id: string;
  try {
    id = (await listModels(provider, key, fetchFn, signal)).recommended;
  } catch (e) {
    if (e instanceof LLMError && e.code === 'cancelled') throw e;
    if (e instanceof LLMError && e.code !== 'offline' && e.code !== 'no-list') console.error(`Motikord: could not list ${PROVIDERS[provider].label} models`, e.message);
    return FALLBACK_MODEL[provider];
  }
  await store?.set({ [k]: id }).catch(() => undefined);
  return id;
}

// ---- Requests ----

interface ApiError { status: number; code?: string; type?: string; message?: string; param?: string }

async function readError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: unknown; type?: unknown; message?: unknown; param?: unknown } } | undefined;
  try { body = (await res.json()) as typeof body; } catch { /* not JSON */ }
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const e = body?.error;
  return { status: res.status, code: str(e?.code), type: str(e?.type), message: str(e?.message), param: str(e?.param) };
}

// A refused prompt-plus-max_tokens over the tokens-per-minute limit (413, or 429 of type "tokens").
const tooManyTokens = (e: ApiError) =>
  e.status === 413 || (e.status === 429 && (e.type === 'tokens' || /tokens per minute|request too large|\bTPM\b/i.test(e.message ?? '')));
const MIN_TOKENS = 800;
const modelGone = (e: ApiError) =>
  e.code === 'model_not_found' || e.code === 'model_decommissioned' || (e.status === 404 && (e.type === 'not_found_error' || /model/i.test(e.message ?? '')))
  || (e.status === 400 && /model\b.*(does not exist|not found|decommissioned|not a valid model|invalid model)/i.test(e.message ?? ''));
const notChat = (e: ApiError) => /not a chat model|not supported in the v1\/chat|does not support chat/i.test(e.message ?? '');
const DROPPABLE = ['temperature', 'reasoning_effort', 'response_format'];
/** The request field a 400 says the model doesn't take, if Motikord can leave it out. */
function unsupportedParam(e: ApiError): string | undefined {
  if (e.status !== 400) return undefined;
  const named = e.param ?? /unsupported (?:parameter|value): '(\w+)'/i.exec(e.message ?? '')?.[1]
    ?? DROPPABLE.find((p) => new RegExp(`\\b${p}\\b`).test(e.message ?? '') && /not supported|unsupported|does not support/i.test(e.message ?? ''));
  return named && DROPPABLE.includes(named) ? named : undefined;
}

function retryAfter(res: Response): number | undefined {
  const after = Number(res.headers.get('retry-after'));
  return Number.isFinite(after) && after > 0 ? after * 1000 : undefined;
}

// OpenAI reasoning models: no temperature, a reasoning budget on top of the reply.
const reasoning = (provider: Provider, model: string) => provider === 'openai' && /^(o\d|gpt-5)/.test(model) && !/chat/.test(model);
const REASONING_TOKENS = 4000;
const ANTHROPIC_MAX_TOKENS = 4096;
const JSON_ONLY = 'Reply with one JSON object only, with no text before or after it.';

interface Req { model: string; json: boolean; maxTokens?: number; dropped: Set<string> }

function requestBody(provider: Provider, messages: ChatMessage[], opts: ChatOptions, r: Req): Record<string, unknown> {
  const temperature = r.dropped.has('temperature') ? {} : { temperature: opts.temperature ?? 0.2 };
  if (provider === 'anthropic') {
    const system = [...messages.filter((m) => m.role === 'system').map((m) => m.content), ...(r.json ? [JSON_ONLY] : [])].join('\n\n');
    return {
      model: r.model, max_tokens: r.maxTokens ?? ANTHROPIC_MAX_TOKENS, ...temperature,
      ...(system ? { system } : {}),
      messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
    };
  }
  const think = reasoning(provider, r.model);
  const tokens = r.maxTokens ? (provider === 'openai' ? { max_completion_tokens: think ? r.maxTokens + REASONING_TOKENS : r.maxTokens } : { max_tokens: r.maxTokens }) : {};
  return {
    model: r.model,
    ...(think ? {} : temperature),
    ...(think && !r.dropped.has('reasoning_effort') ? { reasoning_effort: 'low' } : {}),
    ...tokens,
    ...(r.json && !r.dropped.has('response_format') ? { response_format: { type: 'json_object' } } : {}),
    messages,
  };
}

/** The reply text and whether the token limit cut it off. */
function readReply(provider: Provider, body: unknown): { text?: string; cut: boolean } {
  if (provider === 'anthropic') {
    const b = body as { content?: { type?: unknown; text?: unknown }[]; stop_reason?: unknown } | undefined;
    if (!Array.isArray(b?.content)) return { cut: false };
    const text = b.content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text as string).join('');
    return { text, cut: b.stop_reason === 'max_tokens' };
  }
  const choice = (body as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] } | undefined)?.choices?.[0];
  const content = choice?.message?.content;
  return { text: typeof content === 'string' ? content : undefined, cut: choice?.finish_reason === 'length' };
}

/** The JSON object in a reply that may wrap it in prose or a code fence. */
export function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

async function chatCloud(provider: Provider, messages: ChatMessage[], opts: ChatOptions, chosen: string | undefined): Promise<string> {
  const label = PROVIDERS[provider].label;
  const key = opts.key ?? (await getKey(provider));
  if (!key) throw new LLMError(`No ${label} key in this session.`, 'no-key');
  const fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
  const r: Req = { model: chosen ?? (await recommendedFor(provider, key, fetchFn, opts.signal, false)), json: !!opts.json, maxTokens: opts.maxTokens, dropped: new Set() };
  let shrunk = false;
  let unjsoned = false;
  let repicked = false;
  for (;;) {
    if (opts.signal?.aborted) throw cancelled();
    let res: Response;
    try {
      res = await fetchFn(PROVIDER_API[provider].chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(provider, key) },
        body: JSON.stringify(requestBody(provider, messages, opts, r)),
        credentials: 'omit',
        signal: opts.signal,
      });
    } catch (e) {
      if (isAbort(e)) throw cancelled();
      throw new LLMError(`Could not reach ${label}.`, 'offline');
    }
    if (!res.ok) {
      const err = await readError(res);
      if (opts.signal?.aborted) throw cancelled();
      console.error(`Motikord: could not reach ${label}`, err.status, err.code ?? err.type ?? '');
      if (err.status === 401 || err.status === 403) throw new LLMError(`${label} did not accept the key.`, 'auth');
      if (notChat(err)) throw new LLMError(`${r.model} can't write text.`, 'not-for-text');
      // The person's model is not there: say so, so they can change it. With no pick, the recommended one is re-picked once.
      if (modelGone(err) && chosen) throw new LLMError(`${label} has no model ${r.model}.`, 'model-not-found');
      if (modelGone(err)) {
        if (!repicked) { repicked = true; r.model = await recommendedFor(provider, key, fetchFn, opts.signal, true); continue; }
        throw new LLMError(`${label} has no model Motikord can use.`, 'server');
      }
      // JSON mode failed (bad or cut-off JSON): ask once more without it; callers pull the object out of the text.
      if (err.code === 'json_validate_failed') {
        if (r.json && !unjsoned) { r.json = false; unjsoned = true; continue; }
        throw new LLMError(`${label} could not write valid JSON.`, 'bad-reply');
      }
      const param = unsupportedParam(err);
      if (param && !r.dropped.has(param)) { r.dropped.add(param); continue; }
      if (tooManyTokens(err)) {
        if (!shrunk && r.maxTokens && r.maxTokens > MIN_TOKENS) { r.maxTokens = Math.max(MIN_TOKENS, Math.floor(r.maxTokens / 2)); shrunk = true; continue; }
        throw new LLMError(`${label} is busy.`, 'rate-limited', retryAfter(res));
      }
      if (err.status === 429) throw new LLMError(`${label} is busy.`, 'rate-limited', retryAfter(res));
      if (err.status === 400 || err.status === 422) throw new LLMError(`${label} refused the request (${err.code ?? err.type ?? err.status}).`, 'bad-reply');
      // 529 is Anthropic's "overloaded"; like any 5xx it shows provider-down.
      throw new LLMError(`${label} returned ${err.status}.`, 'server');
    }
    let reply: { text?: string; cut: boolean } = { cut: false };
    try {
      reply = readReply(provider, await res.json());
    } catch (e) {
      if (isAbort(e) || opts.signal?.aborted) throw cancelled();
    }
    if (typeof reply.text !== 'string') throw new LLMError(`${label} sent an unexpected reply.`, 'bad-reply');
    // A JSON reply cut off by the token limit cannot parse; say so instead of returning half an object.
    if (opts.json && reply.cut) {
      console.error(`Motikord: could not reach ${label}`, res.status, 'length');
      throw new LLMError(`${label} cut the reply off.`, 'bad-reply');
    }
    return opts.json && provider === 'anthropic' ? extractJson(reply.text) : reply.text;
  }
}

/** "Check model": one tiny request to `model` with `key`. Resolves the time it took in ms; throws LLMError. */
export async function checkModel(provider: Provider, model: string, key: string, fetchFn?: FetchLike, now: () => number = () => performance.now()): Promise<number> {
  if (notForText(model)) throw new LLMError(`${model} can't write text.`, 'not-for-text');
  const start = now();
  await chat([{ role: 'user', content: 'Reply with OK.' }], { ai: 'cloud', provider, model, key, maxTokens: 16, temperature: 0, fetch: fetchFn });
  return now() - start;
}

async function chatLocal(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const lm = opts.languageModel ?? (globalThis as { LanguageModel?: LanguageModelLike }).LanguageModel;
  const availability = lm ? await lm.availability().catch(() => 'unavailable' as const) : 'unavailable';
  // Never start a model download from here.
  if (!lm || availability !== 'available') throw new LLMError('Built-in AI is not available.', 'local-unavailable');
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') throw new LLMError('The last message must be from the user.', 'bad-reply');
  let session: Awaited<ReturnType<LanguageModelLike['create']>>;
  try {
    session = await lm.create({ initialPrompts: messages.slice(0, -1), signal: opts.signal });
  } catch (e) {
    if (isAbort(e) || opts.signal?.aborted) throw new LLMError('Cancelled.', 'cancelled');
    throw new LLMError('Built-in AI is not available.', 'local-unavailable');
  }
  try {
    if (opts.json) {
      try { return await session.prompt(last.content, { signal: opts.signal, responseConstraint: { type: 'object' } }); } catch (e) {
        if (isAbort(e) || opts.signal?.aborted) throw e;
        // This Chrome does not take responseConstraint; ask again without it.
      }
    }
    return await session.prompt(last.content, { signal: opts.signal });
  } catch (e) {
    if (isAbort(e) || opts.signal?.aborted) throw new LLMError('Cancelled.', 'cancelled');
    throw new LLMError('Built-in AI could not answer.', 'bad-reply');
  } finally {
    session.destroy?.();
  }
}
