import { VoiceError, voiceErrorForStatus, timedOut, withTimeout } from './transcribe';

/** OpenAI's speech endpoint and model, checked against the docs on 2026-11-09. */
export const TTS_API = { url: 'https://api.openai.com/v1/audio/speech', model: 'gpt-4o-mini-tts' } as const;

/** The four voices the panel offers, each a built-in OpenAI voice. */
export const VOICES = [
  { id: 'warm', name: 'Warm', openai: 'coral' },
  { id: 'bright', name: 'Bright', openai: 'nova' },
  { id: 'calm', name: 'Calm', openai: 'sage' },
  { id: 'deep', name: 'Deep', openai: 'onyx' },
] as const;
export type VoiceId = (typeof VOICES)[number]['id'];

/** Conservative cap; the voice request is one call per script. */
export const MAX_SCRIPT = 4_000;

export function buildSpeechRequest(key: string, script: string, voice: VoiceId): { url: string; init: RequestInit } {
  const v = VOICES.find((x) => x.id === voice) ?? VOICES[0];
  return {
    url: TTS_API.url,
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: TTS_API.model, voice: v.openai, input: script.slice(0, MAX_SCRIPT), response_format: 'mp3' }),
    },
  };
}

/** Only the script is sent. No key means `key`; the caller shows voiceover-no-key before any request. */
export async function makeVoiceover(
  key: string | undefined, script: string, voice: VoiceId,
  { fetch: f = fetch, signal, timeoutMs }: { fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Blob> {
  if (!key) throw new VoiceError('key');
  const { url, init } = buildSpeechRequest(key, script, voice);
  let res: Response;
  try {
    res = await f(url, { ...init, signal: withTimeout(signal, timeoutMs) });
  } catch (error) {
    if (signal?.aborted) throw new VoiceError('cancelled');
    throw new VoiceError(timedOut(error) ? 'failed' : 'offline');
  }
  if (!res.ok) throw new VoiceError(voiceErrorForStatus(res.status), res.status);
  const audio = await res.blob().catch(() => null);
  if (!audio || !audio.size) throw new VoiceError('failed', res.status);
  return audio;
}
