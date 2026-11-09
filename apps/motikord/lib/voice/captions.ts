import type { SpeechProvider } from './path';
import { SPEECH_APIS, VoiceError, voiceErrorForStatus } from './transcribe';

/** Timestamped captions need `verbose_json`, which on OpenAI only whisper-1 returns; Groq's turbo model does it too. Checked 2026-11-09. */
export const CAPTION_MODELS: Record<SpeechProvider, string> = { groq: 'whisper-large-v3-turbo', openai: 'whisper-1' };

export interface CaptionCue { startMs: number; endMs: number; text: string }

export function buildCaptionRequest(provider: SpeechProvider, key: string, audio: Blob, lang?: string): { url: string; init: RequestInit } {
  const body = new FormData();
  body.append('file', audio, 'narration.webm');
  body.append('model', CAPTION_MODELS[provider]);
  body.append('response_format', 'verbose_json');
  body.append('timestamp_granularities[]', 'segment');
  if (lang) body.append('language', lang.split('-')[0]!.toLowerCase());
  return { url: SPEECH_APIS[provider].url, init: { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body } };
}

/** Segments from a verbose_json answer, empty ones dropped, a cue never shorter than 300 ms. */
export function cuesFromResponse(json: unknown): CaptionCue[] {
  const segments = (json as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segments)) return [];
  const cues: CaptionCue[] = [];
  for (const s of segments as { start?: unknown; end?: unknown; text?: unknown }[]) {
    const text = typeof s.text === 'string' ? s.text.replace(/\s+/g, ' ').trim() : '';
    if (!text || typeof s.start !== 'number' || typeof s.end !== 'number') continue;
    const startMs = Math.max(0, Math.round(s.start * 1000));
    const endMs = Math.max(startMs + 300, Math.round(s.end * 1000));
    cues.push({ startMs, endMs, text });
  }
  return cues;
}

/** Only the narration audio is sent. An empty list means no speech was found. */
export async function transcribeCues(
  provider: SpeechProvider, key: string, audio: Blob,
  { lang, fetch: f = fetch, signal }: { lang?: string; fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<CaptionCue[]> {
  const { url, init } = buildCaptionRequest(provider, key, audio, lang);
  let res: Response;
  try {
    res = await f(url, { ...init, signal });
  } catch (error) {
    if (signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw new VoiceError('cancelled');
    throw new VoiceError('offline');
  }
  if (!res.ok) throw new VoiceError(voiceErrorForStatus(res.status), res.status);
  const json = await res.json().catch(() => null);
  if (!json) throw new VoiceError('failed', res.status);
  return cuesFromResponse(json);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export function srtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor(t / 60_000) % 60)}:${pad(Math.floor(t / 1000) % 60)},${pad(t % 1000, 3)}`;
}

export function toSrt(cues: readonly CaptionCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${c.text}\n`).join('\n');
}
