/**
 * Chat calls: a cloud provider (Groq, OpenAI, OpenRouter, Ollama: OpenAI-compatible; Anthropic: Messages API) or Chrome's built-in
 * LanguageModel. Never logs or returns a key, and never logs a prompt. Errors are LLMError with the app's own sentence.
 */
import { fail, isAbort, readError, type ApiError, type ErrorText } from './errors';
import { recommendedFor, type FetchLike, type ModelCache, type PickOptions } from './models';
import { apiOf, authHeaders, chatUrl, PROVIDERS, type Endpoint, type ProviderId } from './providers';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** JPEG data URLs sent with the message (cloud providers only). */
  images?: string[];
}

export const IMAGE_TOKENS = 1000;

/** Rough token count: 4 characters a token, plus 1,000 for each image. */
export const estimateTokens = (messages: ChatMessage[]): number =>
  messages.reduce((n, m) => n + Math.ceil(m.content.length / 4) + (m.images?.length ?? 0) * IMAGE_TOKENS, 0);

const dataUrl = (url: string) => url.match(/^data:([^;,]+);base64,(.*)$/s);
function anthropicContent(m: ChatMessage): unknown {
  if (!m.images?.length) return m.content;
  const imgs = m.images.map((url) => {
    const d = dataUrl(url);
    return d
      ? { type: 'image', source: { type: 'base64', media_type: d[1], data: d[2] } }
      : { type: 'image', source: { type: 'url', url } };
  });
  return m.content.trim() ? [...imgs, { type: 'text', text: m.content }] : imgs;
}
const openaiMessage = (m: ChatMessage): unknown =>
  m.images?.length
    ? {
        role: m.role,
        content: [
          { type: 'text', text: m.content },
          ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      }
    : (({ images: _images, ...rest }) => rest)(m);

export interface CloudChat extends Endpoint, PickOptions {
  /** Log prefix: `<App>: could not reach <provider>`. */
  app: string;
  text: ErrorText;
  key?: string; // required unless the provider has no key name (Ollama)
  /** The model to use; empty means the recommended one from /models. */
  model?: string;
  /**
   * When the model is gone: 'report' throws model-not-found, 'repick' picks a listed one once and retries.
   * Default: 'report' for a model the person picked, 'repick' when none was given.
   */
  modelGone?: 'report' | 'repick';
  /** Told the model a repick moved to, so the app can remember it. */
  onRepick?: (model: string) => void | Promise<void>;
  cache?: ModelCache;
  json?: boolean; // ask for a JSON object reply
  /** A JSON reply cut off by the token limit throws cut-off; otherwise the cut text is returned for the app to read. */
  failCutOff?: boolean;
  /** A 413 that halving the token budget did not fix: 'busy', or 'status' (the HTTP error, the default). */
  tooLarge?: 'busy' | 'status';
  maxTokens?: number;
  temperature?: number; // default 0.2
  signal?: AbortSignal;
  fetch?: FetchLike;
}

// A refused prompt-plus-max_tokens over the tokens-per-minute limit (413, or 429 of type "tokens").
const tooManyTokens = (e: ApiError) =>
  e.status === 413 ||
  (e.status === 429 && (e.type === 'tokens' || /tokens per minute|request too large|\bTPM\b/i.test(e.message ?? '')));
const MIN_TOKENS = 800;
const modelGone = (e: ApiError) =>
  e.code === 'model_not_found' ||
  e.code === 'model_decommissioned' ||
  (e.status === 404 && (e.type === 'not_found_error' || /model/i.test(e.message ?? ''))) ||
  (e.status === 400 &&
    /model\b.*(does not exist|not found|decommissioned|not a valid model|invalid model)/i.test(e.message ?? ''));
const notChat = (e: ApiError) =>
  /not a chat model|not supported in the v1\/chat|does not support chat/i.test(e.message ?? '');
const DROPPABLE = ['temperature', 'reasoning_effort', 'response_format'];
/** The request field a 400 says the model doesn't take, if it can be left out. */
function unsupportedParam(e: ApiError): string | undefined {
  if (e.status !== 400) return undefined;
  const named =
    e.param ??
    /unsupported (?:parameter|value): '(\w+)'/i.exec(e.message ?? '')?.[1] ??
    DROPPABLE.find(
      (p) =>
        new RegExp(`\\b${p}\\b`).test(e.message ?? '') &&
        /not supported|unsupported|does not support/i.test(e.message ?? ''),
    );
  return named && DROPPABLE.includes(named) ? named : undefined;
}

function retryAfter(res: Response): number | undefined {
  const after = Number(res.headers.get('retry-after'));
  return Number.isFinite(after) && after > 0 ? after * 1000 : undefined;
}

// OpenAI reasoning models: no temperature, a reasoning budget on top of the reply.
const reasoning = (provider: ProviderId, model: string) =>
  provider === 'openai' && /^(o\d|gpt-[5-9])/.test(model) && !/chat/.test(model);
const REASONING_TOKENS = 4000;
const ANTHROPIC_MAX_TOKENS = 4096;
const JSON_ONLY = 'Reply with one JSON object only, with no text before or after it.';

interface Req {
  model: string;
  json: boolean;
  maxTokens?: number;
  dropped: Set<string>;
}

function requestBody(c: CloudChat, messages: ChatMessage[], r: Req): Record<string, unknown> {
  const temperature = r.dropped.has('temperature') ? {} : { temperature: c.temperature ?? 0.2 };
  if (apiOf(c) === 'anthropic') {
    const system = [
      ...messages.filter((m) => m.role === 'system').map((m) => m.content),
      ...(r.json ? [JSON_ONLY] : []),
    ].join('\n\n');
    return {
      model: r.model,
      max_tokens: r.maxTokens ?? ANTHROPIC_MAX_TOKENS,
      ...temperature,
      ...(system ? { system } : {}),
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: anthropicContent(m) })),
    };
  }
  const think = reasoning(c.provider, r.model);
  const tokens = r.maxTokens
    ? c.provider === 'openai'
      ? { max_completion_tokens: think ? r.maxTokens + REASONING_TOKENS : r.maxTokens }
      : { max_tokens: r.maxTokens }
    : {};
  return {
    model: r.model,
    ...(think ? {} : temperature),
    ...(think && !r.dropped.has('reasoning_effort') ? { reasoning_effort: 'low' } : {}),
    ...tokens,
    ...(r.json && !r.dropped.has('response_format') ? { response_format: { type: 'json_object' } } : {}),
    messages: messages.map(openaiMessage),
  };
}

/** The reply text and whether the token limit cut it off. */
function readReply(api: 'openai' | 'anthropic', body: unknown): { text?: string; cut: boolean } {
  if (api === 'anthropic') {
    const b = body as { content?: { type?: unknown; text?: unknown }[]; stop_reason?: unknown } | undefined;
    if (!Array.isArray(b?.content)) return { cut: false };
    const text = b.content
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('');
    return { text, cut: b.stop_reason === 'max_tokens' };
  }
  const choice = (body as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] } | undefined)
    ?.choices?.[0];
  const content = choice?.message?.content;
  return { text: typeof content === 'string' ? content : undefined, cut: choice?.finish_reason === 'length' };
}

/** The JSON object in a reply that may wrap it in prose or a code fence. */
export function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/**
 * Sends `messages` to a cloud provider and returns the reply text. Throws LLMError.
 * Retries once each: a gone model (repick), JSON mode that failed, a field the model doesn't take, and a reply over the token limit.
 */
export async function chatCloud(messages: ChatMessage[], c: CloudChat): Promise<string> {
  const { provider, text, signal } = c;
  const label = PROVIDERS[provider].label;
  const api = apiOf(c);
  const key = c.key ?? '';
  if (PROVIDERS[provider].keyName && !key) throw fail(text, { reason: 'no-key', label });
  const fetchFn = c.fetch ?? ((u, i) => fetch(u, i));
  const listing = { ...c, key, fetch: fetchFn };
  const chosen = c.model || undefined;
  const policy = c.modelGone ?? (chosen ? 'report' : 'repick');
  const first = chosen ?? (await recommendedFor({ ...listing, fresh: false }));
  const r: Req = { model: first ?? '', json: !!c.json, maxTokens: c.maxTokens, dropped: new Set() };
  let shrunk = false;
  let unjsoned = false;
  let repicked = false;
  for (;;) {
    if (signal?.aborted) throw fail(text, { reason: 'cancelled', label, model: r.model });
    let res: Response;
    try {
      res = await fetchFn(chatUrl(c), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? authHeaders(provider, key, c.openaiCompatible) : {}) },
        body: JSON.stringify(requestBody(c, messages, r)),
        credentials: 'omit',
        signal,
      });
    } catch (e) {
      if (isAbort(e)) throw fail(text, { reason: 'cancelled', label, model: r.model });
      throw fail(text, { reason: 'offline', label, model: r.model });
    }
    if (!res.ok) {
      const err = await readError(res);
      if (signal?.aborted) throw fail(text, { reason: 'cancelled', label, model: r.model });
      const detail = err.code ?? err.type;
      const at = { label, model: r.model, status: err.status, detail };
      console.error(`${c.app}: could not reach ${label}`, err.status, detail ?? '');
      if (err.status === 401 || err.status === 403) throw fail(text, { reason: 'auth', ...at });
      if (notChat(err)) throw fail(text, { reason: 'not-for-text', ...at });
      if (modelGone(err)) {
        // The person's model is not there: say so, so they can change it. Otherwise a listed one is picked once.
        if (policy === 'report') throw fail(text, { reason: 'model-not-found', ...at });
        if (!repicked) {
          repicked = true;
          const next = await recommendedFor({ ...listing, fresh: true, exclude: r.model });
          if (next) {
            if (next !== r.model) await Promise.resolve(c.onRepick?.(next)).catch(() => undefined);
            r.model = next;
            continue;
          }
        }
        throw fail(text, { reason: 'no-model', ...at });
      }
      // JSON mode failed (bad or cut-off JSON): ask once more without it; callers pull the object out of the text.
      if (err.code === 'json_validate_failed') {
        if (r.json && !unjsoned) {
          r.json = false;
          unjsoned = true;
          continue;
        }
        throw fail(text, { reason: 'bad-json', ...at });
      }
      const param = unsupportedParam(err);
      if (param && !r.dropped.has(param)) {
        r.dropped.add(param);
        continue;
      }
      if (tooManyTokens(err)) {
        if (!shrunk && r.maxTokens && r.maxTokens > MIN_TOKENS) {
          r.maxTokens = Math.max(MIN_TOKENS, Math.floor(r.maxTokens / 2));
          shrunk = true;
          continue;
        }
        if (err.status === 413 && c.tooLarge !== 'busy') throw fail(text, { reason: 'status', ...at });
        throw fail(text, { reason: 'busy', ...at }, retryAfter(res));
      }
      if (err.status === 429) throw fail(text, { reason: 'busy', ...at }, retryAfter(res));
      if (err.status === 400 || err.status === 422) throw fail(text, { reason: 'refused', ...at });
      // 529 is Anthropic's "overloaded"; like any 5xx it is a server error.
      throw fail(text, { reason: 'status', ...at });
    }
    let reply: { text?: string; cut: boolean } = { cut: false };
    try {
      reply = readReply(api, await res.json());
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw fail(text, { reason: 'cancelled', label, model: r.model });
    }
    if (typeof reply.text !== 'string') throw fail(text, { reason: 'unexpected-reply', label, model: r.model });
    // A JSON reply cut off by the token limit cannot parse; say so instead of returning half an object.
    if (c.json && c.failCutOff && reply.cut) {
      console.error(`${c.app}: could not reach ${label}`, res.status, 'length');
      throw fail(text, { reason: 'cut-off', label, model: r.model });
    }
    return c.json && api === 'anthropic' ? extractJson(reply.text) : reply.text;
  }
}

/** The slice of Chrome's built-in AI (`LanguageModel`) the apps use. */
export interface LanguageModelLike {
  availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts: { initialPrompts?: ChatMessage[]; temperature?: number; topK?: number; signal?: AbortSignal }): Promise<{
    prompt(input: string, opts?: { signal?: AbortSignal; responseConstraint?: object }): Promise<string>;
    destroy?(): void;
  }>;
}

export interface LocalChat {
  text: ErrorText;
  json?: boolean;
  signal?: AbortSignal;
  languageModel?: LanguageModelLike;
}

const LOCAL = 'Built-in AI';

/** Sends `messages` to Chrome's built-in AI. Never starts a model download. Throws LLMError. */
export async function chatLocal(messages: ChatMessage[], opts: LocalChat): Promise<string> {
  const { text, signal } = opts;
  const lm = opts.languageModel ?? (globalThis as { LanguageModel?: LanguageModelLike }).LanguageModel;
  const availability = lm ? await lm.availability().catch(() => 'unavailable' as const) : 'unavailable';
  if (!lm || availability !== 'available') throw fail(text, { reason: 'local-unavailable', label: LOCAL });
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') throw fail(text, { reason: 'local-turn', label: LOCAL });
  let session: Awaited<ReturnType<LanguageModelLike['create']>>;
  try {
    session = await lm.create({ initialPrompts: messages.slice(0, -1), signal });
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw fail(text, { reason: 'cancelled', label: LOCAL });
    throw fail(text, { reason: 'local-unavailable', label: LOCAL });
  }
  try {
    if (opts.json) {
      try {
        return await session.prompt(last.content, { signal, responseConstraint: { type: 'object' } });
      } catch (e) {
        if (isAbort(e) || signal?.aborted) throw e;
        // This Chrome does not take responseConstraint; ask again without it.
      }
    }
    return await session.prompt(last.content, { signal });
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw fail(text, { reason: 'cancelled', label: LOCAL });
    throw fail(text, { reason: 'local-failed', label: LOCAL });
  } finally {
    session.destroy?.();
  }
}
