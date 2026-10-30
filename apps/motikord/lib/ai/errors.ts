import { LLMError, type LLMErrorCode } from '../llm';

/** State ids from FRAMES.md that AI failures land on; screens show that frame's copy. */
export type AiStateId = 'making-failed' | 'too-long' | 'groq-busy' | 'groq-down' | 'offline' | 'prompt-failed' | 'change-too-long';
export type AiTask = 'make' | 'edit';
export type AiErrorCode = LLMErrorCode | 'invalid-reply' | 'change-too-long';

/** The state a failure shows. Cancelled has none: Stop and Cancel leave the screen as it was. */
export function stateFor(code: AiErrorCode, task: AiTask): AiStateId | undefined {
  switch (code) {
    case 'offline': return 'offline';
    case 'rate-limited': return 'groq-busy';
    // No key, a refused key and a Groq outage all send the user to Settings ("Open Settings" on groq-down).
    case 'no-key': case 'auth': case 'server': return 'groq-down';
    case 'change-too-long': return 'change-too-long';
    case 'cancelled': return undefined;
    case 'bad-reply': case 'invalid-reply': case 'local-unavailable':
      return task === 'make' ? 'making-failed' : 'prompt-failed';
  }
}

/** A typed AI failure. Never carries a key or the prompt text. */
export class AiError extends Error {
  readonly state: AiStateId | undefined;
  constructor(
    readonly code: AiErrorCode,
    readonly task: AiTask,
    readonly detail: { problems?: string[]; totalMs?: number; retryAfterMs?: number } = {},
  ) {
    super(`Motikord AI ${task} failed: ${code}`);
    this.name = 'AiError';
    this.state = stateFor(code, task);
  }
}

/** Wraps anything thrown during an AI step as an AiError for that task. */
export function toAiError(error: unknown, task: AiTask): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof LLMError) return new AiError(error.code, task, { retryAfterMs: error.retryAfterMs });
  if (error instanceof DOMException && error.name === 'AbortError') return new AiError('cancelled', task);
  return new AiError('invalid-reply', task);
}
