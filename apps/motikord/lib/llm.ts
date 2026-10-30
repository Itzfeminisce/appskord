/**
 * Chat client adapted from Rekord's llm.ts: Groq (OpenAI-compatible) or Chrome's built-in LanguageModel.
 * Never logs or returns a key, and never logs a prompt. Errors are LLMError with a `code`.
 */
import type { AiMode } from './types';
import { getKey, getSettings } from './settings';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Same model as Rekord's Groq default.
export const GROQ_MODEL = 'llama-3.3-70b-versatile';

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
  key?: string;             // instead of the session key
  languageModel?: LanguageModelLike;
}

export type LLMErrorCode = 'no-key' | 'offline' | 'auth' | 'rate-limited' | 'server' | 'bad-reply' | 'local-unavailable' | 'cancelled';

export class LLMError extends Error {
  constructor(message: string, readonly code: LLMErrorCode, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'LLMError';
  }
}

export interface ChatReply { text: string; by: 'groq' | 'builtin' }

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** Sends `messages` to the chosen AI and returns the reply text. Throws LLMError. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatReply> {
  const ai = opts.ai ?? (await getSettings()).ai;
  if (ai === 'local') return { text: await chatLocal(messages, opts), by: 'builtin' };
  return { text: await chatGroq(messages, opts), by: 'groq' };
}

async function chatGroq(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const key = opts.key ?? (await getKey('groq'));
  if (!key) throw new LLMError('No Groq key in this session.', 'no-key');
  const fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
  let res: Response;
  try {
    res = await fetchFn(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: opts.temperature ?? 0.2,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        messages,
      }),
      signal: opts.signal,
    });
  } catch (e) {
    if (isAbort(e)) throw new LLMError('Cancelled.', 'cancelled');
    throw new LLMError('Could not reach Groq.', 'offline');
  }
  if (res.status === 401 || res.status === 403) throw new LLMError('Groq did not accept the key.', 'auth');
  if (res.status === 429) {
    const after = Number(res.headers.get('retry-after'));
    throw new LLMError('Groq is busy.', 'rate-limited', Number.isFinite(after) && after > 0 ? after * 1000 : undefined);
  }
  if (!res.ok) throw new LLMError(`Groq returned ${res.status}.`, 'server');
  let content: unknown;
  try {
    content = ((await res.json()) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  } catch (e) {
    if (isAbort(e) || opts.signal?.aborted) throw new LLMError('Cancelled.', 'cancelled');
  }
  if (typeof content !== 'string') throw new LLMError('Groq sent an unexpected reply.', 'bad-reply');
  return content;
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
