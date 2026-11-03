/** Groq speech-to-text, adapted from Rekord, and what OpenAI's client shares with it. Sends audio only, never video. Never logs or returns the key. */
import { PROVIDERS as LLM_PROVIDERS } from '@appskord/llm';
import { PROVIDERS, type FetchLike } from '@/lib/llm';
import { loadKeys } from '@/lib/penv';
import { getSettings } from '@/lib/settings';
import type { CloudSpeech, TranscriptsProvider } from '@/lib/types';
import { toWav } from './chunker';
import type { Heard } from './merge';

export const GROQ_MODEL = 'whisper-large-v3-turbo';

export type SpeechErrorCode = 'no-key' | 'offline' | 'auth' | 'rate-limited' | 'server' | 'bad-request';

export class SpeechError extends Error {
  constructor(message: string, readonly code: SpeechErrorCode, readonly status?: number) {
    super(message);
    this.name = 'SpeechError';
  }
}

export interface SpeechOptions { key: string; model?: string; language?: string; signal?: AbortSignal }

// Long enough to keep requests few on a re-transcribe; a WAV of this is about 10 MB, under Groq's and OpenAI's file limits.
export const CLOUD_CHUNK_MS = 5 * 60_000;

interface GroqWord { word?: unknown; start?: unknown; end?: unknown }

/** A word list (seconds) as Words in ms; entries without a word or times are dropped. */
export function parseWords(list: unknown): Heard['words'] {
  if (!Array.isArray(list)) return undefined;
  return (list as GroqWord[]).flatMap((w) => {
    if (typeof w?.word !== 'string' || typeof w.start !== 'number' || typeof w.end !== 'number') return [];
    return [{ start: Math.round(w.start * 1000), end: Math.round(w.end * 1000), text: w.word.trim() }];
  });
}

/** The WAV of one 16 kHz chunk with the model and language, as `/audio/transcriptions` takes it. */
export function speechForm(audio: Float32Array, model: string, language?: string): FormData {
  const form = new FormData();
  form.append('file', new Blob([toWav(audio)], { type: 'audio/wav' }), 'chunk.wav');
  form.append('model', model);
  if (language && language !== 'auto') form.append('language', language);
  return form;
}

/** Posts `form` to the provider's `/audio/transcriptions` and reads the text and word times. Throws SpeechError. */
export async function postSpeech(provider: CloudSpeech, form: FormData, opts: SpeechOptions, fetchFn: FetchLike): Promise<Heard> {
  const label = LLM_PROVIDERS[provider].label;
  let res: Response;
  try {
    res = await fetchFn(`${PROVIDERS[provider].baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.key}` },
      body: form,
      signal: opts.signal,
    });
  } catch {
    throw new SpeechError(`Could not reach ${label}.`, 'offline');
  }
  if (res.status === 401 || res.status === 403) throw new SpeechError(`${label} did not accept the key.`, 'auth');
  if (res.status === 429) throw new SpeechError(`${label} is busy.`, 'rate-limited');
  if (res.status >= 500) throw new SpeechError(`${label} returned an error (${res.status}).`, 'server');
  if (!res.ok) throw new SpeechError(`${label} returned an error (${res.status}).`, 'bad-request', res.status);
  let body: { text?: unknown; words?: unknown };
  try {
    body = (await res.json()) as { text?: unknown; words?: unknown };
  } catch {
    throw new SpeechError(`${label} sent an unexpected reply.`, 'server');
  }
  const words = parseWords(body.words);
  return { text: typeof body.text === 'string' ? body.text.trim() : '', ...(words ? { words } : {}) };
}

/** Transcribes one 16 kHz chunk and returns its text and word times. Throws SpeechError. */
export async function transcribeGroq(audio: Float32Array, opts: SpeechOptions, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<Heard> {
  if (!opts.key) throw new SpeechError('No Groq key is loaded.', 'no-key');
  const form = speechForm(audio, opts.model || GROQ_MODEL, opts.language);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  return postSpeech('groq', form, opts, fetchFn);
}

/** Where transcripts run, with the picked provider's key, and the Groq key for "Use Groq for this one". */
export interface TranscriptConfig { provider: TranscriptsProvider; model: string; language: string; key: string | null; groqKey: string | null }

export const LOCAL_CONFIG: TranscriptConfig = { provider: 'local', model: 'whisper', language: 'auto', key: null, groqKey: null };

/** Read where chrome.storage exists (background), for the offscreen document, which has no storage API. */
export async function loadTranscriptConfig(): Promise<TranscriptConfig> {
  const [settings, keys] = await Promise.all([getSettings(), loadKeys()]);
  const { provider, model } = settings.transcripts;
  const key = provider === 'local' ? null : (keys[PROVIDERS[provider].keyName] ?? null);
  return { provider, model, language: settings.language, key, groqKey: keys[PROVIDERS.groq.keyName] ?? null };
}
