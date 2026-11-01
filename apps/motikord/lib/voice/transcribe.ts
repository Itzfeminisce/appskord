import type { SpeechProvider } from './path';

/** Speech-to-text endpoints and models (OpenAI-compatible /audio/transcriptions). */
export const SPEECH_APIS: Record<SpeechProvider, { url: string; model: string }> = {
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' },
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-4o-mini-transcribe' },
};

export type VoiceErrorCode = 'key' | 'busy' | 'down' | 'offline' | 'cancelled' | 'failed';

/** Carries only a code and the HTTP status: never the key, the audio or the response body. */
export class VoiceError extends Error {
  constructor(readonly code: VoiceErrorCode, readonly status?: number) {
    super(`Voice transcription failed: ${code}${status ? ` (${status})` : ''}`);
    this.name = 'VoiceError';
  }
}

export function voiceErrorForStatus(status: number): VoiceErrorCode {
  if (status === 401 || status === 403) return 'key';
  if (status === 429) return 'busy';
  if (status >= 500) return 'down';
  return 'failed';
}

/** "en-GB" → "en": the transcription APIs take ISO-639-1. */
export const isoLanguage = (lang: string) => lang.split('-')[0]!.toLowerCase();

export function buildTranscriptionRequest(provider: SpeechProvider, key: string, audio: Blob, lang: string): { url: string; init: RequestInit } {
  const api = SPEECH_APIS[provider];
  const body = new FormData();
  body.append('file', audio, 'prompt.webm');
  body.append('model', api.model);
  body.append('language', isoLanguage(lang));
  body.append('response_format', 'json');
  return { url: api.url, init: { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body } };
}

export async function transcribe(
  provider: SpeechProvider, key: string, audio: Blob,
  { lang, fetch: f = fetch, signal }: { lang: string; fetch?: typeof fetch; signal?: AbortSignal },
): Promise<string> {
  const { url, init } = buildTranscriptionRequest(provider, key, audio, lang);
  let res: Response;
  try {
    res = await f(url, { ...init, signal });
  } catch (error) {
    if (signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw new VoiceError('cancelled');
    throw new VoiceError('offline');
  }
  if (!res.ok) throw new VoiceError(voiceErrorForStatus(res.status), res.status);
  const json = (await res.json().catch(() => null)) as { text?: unknown } | null;
  if (!json || typeof json.text !== 'string') throw new VoiceError('failed', res.status);
  return json.text.trim();
}
