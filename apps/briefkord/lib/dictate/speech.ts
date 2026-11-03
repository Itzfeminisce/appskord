/** Speech to text with the user's own Groq or OpenAI key: one request with the audio between the two presses. */
import { listModelsFor, PROVIDERS, SUGGESTED, type ProviderKeyName } from '@appskord/llm';
import type { DictateFailure } from './machine';

export type SpeechProvider = 'groq' | 'openai';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const URLS: Record<SpeechProvider, string> = {
  groq: 'https://api.groq.com/openai/v1/audio/transcriptions',
  openai: 'https://api.openai.com/v1/audio/transcriptions',
};

/** Groq when its key is loaded, else OpenAI, else none. Takes key names, never values. */
export function speechProvider(keyNames: readonly string[]): SpeechProvider | undefined {
  const has = (p: SpeechProvider) => keyNames.includes(PROVIDERS[p].keyName as ProviderKeyName);
  return has('groq') ? 'groq' : has('openai') ? 'openai' : undefined;
}

const picked = new Map<SpeechProvider, string>();

/** The provider's speech model from its live /models list, preferring the suggested ids; the suggested one when the list fails. */
export async function speechModel(provider: SpeechProvider, key: string, fetchFn?: FetchLike): Promise<string> {
  const known = picked.get(provider);
  if (known) return known;
  const list = await listModelsFor(provider, 'speech', { key, ...(fetchFn ? { fetch: fetchFn } : {}) });
  const id = list.models[0]?.id ?? SUGGESTED[provider].speech![0]!;
  if (list.source === 'live') picked.set(provider, id);
  return id;
}

/** Carries a code and status only: never the key, the audio or the reply. */
export class SpeechError extends Error {
  constructor(
    readonly why: DictateFailure,
    readonly status?: number,
  ) {
    super(`Speech to text failed: ${why}${status ? ` (${status})` : ''}`);
    this.name = 'SpeechError';
  }
}

export function failureFor(status: number): DictateFailure {
  if (status === 401 || status === 403) return 'key';
  if (status === 429 || status >= 500) return 'busy';
  return 'failed';
}

export async function transcribe(
  provider: SpeechProvider,
  key: string,
  model: string,
  audio: Blob,
  { fetch: fetchFn = (u, i) => fetch(u, i), signal }: { fetch?: FetchLike; signal?: AbortSignal } = {},
): Promise<string> {
  const body = new FormData();
  body.append('file', audio, audio.type.includes('ogg') ? 'speech.ogg' : 'speech.webm');
  body.append('model', model);
  body.append('response_format', 'json');
  let res: Response;
  try {
    res = await fetchFn(URLS[provider], { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, credentials: 'omit', signal });
  } catch {
    throw new SpeechError('busy');
  }
  if (!res.ok) throw new SpeechError(failureFor(res.status), res.status);
  const json = (await res.json().catch(() => null)) as { text?: unknown } | null;
  if (!json || typeof json.text !== 'string') throw new SpeechError('failed', res.status);
  return json.text.trim();
}
