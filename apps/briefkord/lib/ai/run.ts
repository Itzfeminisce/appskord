/** Sends a prompt to the picked model and checks the reply; a reply that does not fit is asked for once more. */
import { chatCloud, LLMError, type CloudProviderId, type ErrorText, type FetchLike } from '@appskord/llm';
import type { Parsed } from './parse';
import type { Prompt } from './prompts';

/** The StatesAI states a call can end in. `cancelled` is Stop. */
export type AiFailure = 'ai-no-key' | 'ai-bad-reply' | 'ai-unreachable' | 'ai-key-refused' | 'cancelled';

export class AiError extends Error {
  constructor(readonly state: AiFailure) {
    super(state);
    this.name = 'AiError';
  }
}

export interface AiCall {
  provider: CloudProviderId;
  model: string;
  key?: string;
  signal?: AbortSignal;
  fetch?: FetchLike;
}

// Only for the shared package's log line; the screens show StatesAI by code.
const errorText: ErrorText = ({ reason, label }) => `${label}: ${reason}`;

const stateFor = (error: unknown): AiFailure => {
  if (!(error instanceof LLMError)) return 'ai-unreachable';
  if (error.code === 'no-key') return 'ai-no-key';
  if (error.code === 'auth') return 'ai-key-refused';
  if (error.code === 'cancelled') return 'cancelled';
  if (error.code === 'bad-reply') return 'ai-bad-reply';
  return 'ai-unreachable';
};

/** The checked reply. Throws AiError. */
export async function askAi<T>(prompt: Prompt, parse: (reply: string) => Parsed<T>, call: AiCall): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: string;
    try {
      reply = await chatCloud(prompt.messages, {
        app: 'Briefkord',
        text: errorText,
        provider: call.provider,
        key: call.key,
        model: call.model,
        modelGone: 'report',
        json: true,
        maxTokens: prompt.maxTokens,
        signal: call.signal,
        fetch: call.fetch,
      });
    } catch (error) {
      if (call.signal?.aborted) throw new AiError('cancelled');
      const state = stateFor(error);
      if (state === 'ai-bad-reply') continue;
      throw new AiError(state);
    }
    if (call.signal?.aborted) throw new AiError('cancelled');
    const parsed = parse(reply);
    if (parsed.ok) return parsed.value;
  }
  throw new AiError('ai-bad-reply');
}
