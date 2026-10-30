import { describe, expect, it } from 'vitest';
import { LLMError } from '../llm';
import { AiError, stateFor, toAiError, type AiErrorCode, type AiStateId } from './errors';

describe('stateFor', () => {
  const table: [AiErrorCode, AiStateId | undefined, AiStateId | undefined][] = [
    ['offline', 'offline', 'offline'],
    ['rate-limited', 'groq-busy', 'groq-busy'],
    ['server', 'groq-down', 'groq-down'],
    ['auth', 'groq-down', 'groq-down'],
    ['no-key', 'groq-down', 'groq-down'],
    ['bad-reply', 'making-failed', 'prompt-failed'],
    ['invalid-reply', 'making-failed', 'prompt-failed'],
    ['local-unavailable', 'making-failed', 'prompt-failed'],
    ['change-too-long', 'change-too-long', 'change-too-long'],
    ['cancelled', undefined, undefined],
  ];
  for (const [code, make, edit] of table) {
    it(`maps ${code}`, () => {
      expect(stateFor(code, 'make')).toBe(make);
      expect(stateFor(code, 'edit')).toBe(edit);
    });
  }
});

describe('toAiError', () => {
  it('wraps LLM errors, aborts and anything else', () => {
    expect(toAiError(new LLMError('busy', 'rate-limited', 20000), 'make')).toMatchObject({ state: 'groq-busy', detail: { retryAfterMs: 20000 } });
    expect(toAiError(new DOMException('x', 'AbortError'), 'edit').code).toBe('cancelled');
    expect(toAiError(new Error('boom'), 'edit').state).toBe('prompt-failed');
    const same = new AiError('offline', 'make');
    expect(toAiError(same, 'make')).toBe(same);
  });

  it('never carries the prompt in its message', () => {
    expect(new AiError('invalid-reply', 'make', { problems: ['x'] }).message).toBe('Motikord AI make failed: invalid-reply');
  });
});
