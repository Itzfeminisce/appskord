import { IMAGE_TOKENS } from '@appskord/llm';
import type { ChatMessage } from '../../llm';

/** A cautious size for JSON-heavy prompts: 3 characters a token, not 4. */
export const strictTokens = (messages: ChatMessage[]): number =>
  messages.reduce((n, m) => n + Math.ceil(m.content.length / 3) + (m.images?.length ?? 0) * IMAGE_TOKENS, 0);

export const CALL_TIMEOUT_MS = 30_000;
/** The caller's signal plus a 30 s limit on the call. */
export const withTimeout = (signal?: AbortSignal): AbortSignal =>
  AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(CALL_TIMEOUT_MS)]);
