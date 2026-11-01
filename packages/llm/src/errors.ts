/** AI failures: a code callers branch on, and a sentence each app writes for itself. Never carries a key or a prompt. */

export type LLMErrorCode =
  | 'no-key'
  | 'offline'
  | 'auth'
  | 'rate-limited'
  | 'server'
  | 'bad-reply'
  | 'local-unavailable'
  | 'cancelled'
  | 'model-not-found'
  | 'not-for-text'
  | 'no-list';

/** What went wrong, finer than the code, so each app can keep its own sentence for it. */
export type FailureReason =
  | 'no-key' // no key loaded for the provider
  | 'offline' // the request never got an answer
  | 'cancelled' // the caller's signal aborted
  | 'auth' // 401 or 403
  | 'busy' // 429, or a request over the tokens-per-minute limit
  | 'not-for-text' // the model can't write text
  | 'model-not-found' // the model the person picked is gone
  | 'no-model' // the model is gone and none listed works in its place
  | 'bad-json' // JSON mode failed twice
  | 'refused' // 400 or 422
  | 'status' // any other HTTP error
  | 'unexpected-reply' // a 2xx without the reply text
  | 'cut-off' // a JSON reply cut off by the token limit
  | 'no-list' // the key may chat but may not list models
  | 'unexpected-list' // a 2xx model list that does not parse
  | 'local-unavailable' // Chrome's built-in AI is not ready
  | 'local-turn' // the last message is not the user's
  | 'local-failed'; // Chrome's built-in AI could not answer

export const CODE_FOR: Record<FailureReason, LLMErrorCode> = {
  'no-key': 'no-key',
  offline: 'offline',
  cancelled: 'cancelled',
  auth: 'auth',
  busy: 'rate-limited',
  'not-for-text': 'not-for-text',
  'model-not-found': 'model-not-found',
  'no-model': 'server',
  'bad-json': 'bad-reply',
  refused: 'bad-reply',
  status: 'server',
  'unexpected-reply': 'bad-reply',
  'cut-off': 'bad-reply',
  'no-list': 'no-list',
  'unexpected-list': 'server',
  'local-unavailable': 'local-unavailable',
  'local-turn': 'bad-reply',
  'local-failed': 'bad-reply',
};

export interface Failure {
  reason: FailureReason;
  /** The provider's display name ("Groq"). */
  label: string;
  model?: string;
  /** The HTTP status, when the provider answered with an error. */
  status?: number;
  /** The provider's error code or type, for the app's log line; never shown. */
  detail?: string;
}

/** The app's sentence for a failure. */
export type ErrorText = (failure: Failure) => string;

export class LLMError extends Error {
  constructor(
    message: string,
    readonly code: LLMErrorCode,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export function fail(text: ErrorText, failure: Failure, retryAfterMs?: number): LLMError {
  return new LLMError(text(failure), CODE_FOR[failure.reason], retryAfterMs);
}

/** The parts of a provider's error body Groq, OpenAI, OpenRouter and Anthropic agree on. */
export interface ApiError {
  status: number;
  code?: string;
  type?: string;
  message?: string;
  param?: string;
}

export async function readError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: unknown; type?: unknown; message?: unknown; param?: unknown } } | undefined;
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* not JSON */
  }
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const e = body?.error;
  return { status: res.status, code: str(e?.code), type: str(e?.type), message: str(e?.message), param: str(e?.param) };
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
