/**
 * Rekord's provider choice from its keys and the plain-words errors for a failed connect. The keys themselves,
 * Penv Cloud and the key check live in `@appskord/penv` (see `./penv`). Never log or show a value.
 */
import { checkKeys, checkRequest, DEEPGRAM_KEY, type KeyResults, loadKeys, loadKeyStatus, PenvError, saveKeyStatus } from './penv';
import { getSettings, PROVIDERS } from './settings';
import type { ProviderId, Settings, TranscriptionProvider } from './types';

/** Key names the chosen providers need (transcription first), without duplicates. */
export function requiredKeyNames(s: Pick<Settings, 'transcription' | 'summary'>): string[] {
  const names = [transcriptionKeyName(s.transcription.provider), PROVIDERS[s.summary.provider].keyName];
  return [...new Set(names.filter((n): n is string => !!n && !OPTIONAL_KEYS.includes(n)))];
}

/** Keys loaded when present but never required to connect. */
const OPTIONAL_KEYS = ['DEEPGRAM_API_KEY', 'NOTION_TOKEN'];

/** The key name a transcription provider uses. */
export function transcriptionKeyName(id: TranscriptionProvider): string | undefined {
  return id === 'deepgram' ? 'DEEPGRAM_API_KEY' : PROVIDERS[id].keyName;
}

/**
 * Keys that unlock extra features but are never required to connect (e.g. DEEPGRAM_API_KEY for speaker names).
 * penv keeps every key it sends; offer these as optional fields when pasting.
 */
export function optionalKeyNames(s: Pick<Settings, 'diarization'>): string[] {
  return [...new Set([s.diarization.keyName, ...OPTIONAL_KEYS])];
}

/** Plain-words message for a failed connect. Never includes a token or key. */
export function connectErrorMessage(err: unknown): string {
  if (err instanceof PenvError) {
    switch (err.code) {
      case 'unauthorized':
        return 'penv didn’t accept that token. Check it’s a read-only machine token for this environment.';
      case 'not-found':
        return 'penv couldn’t find that environment. Check the org, project and environment names.';
      case 'write-only':
        return 'That penv environment is write-only, so its keys can’t be read. Pick an environment that allows reading.';
      default:
        return 'penv had a problem sending your keys. Try again in a moment.';
    }
  }
  if (err instanceof VerifyError) return err.message;
  return 'Couldn’t reach the service. Check your connection and try again.';
}

export class VerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifyError';
  }
}

/** Cheap check that the transcription key works: `GET {baseUrl}/models`. Throws VerifyError. */
export async function verifyTranscriptionKey(
  settings: Pick<Settings, 'transcription'>,
  keys: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const name = transcriptionKeyName(settings.transcription.provider);
  const key = name ? keys[name] : undefined;
  if (!name || !key) throw new VerifyError(`No ${name ?? 'API'} key was found. Add it, then try again.`);
  const req = checkRequest(name, key);
  let response: Response;
  try {
    if (!req) throw new Error('unknown key');
    response = await fetchImpl(req.url, { headers: req.headers });
  } catch {
    throw new VerifyError('Couldn’t reach the transcription service. Check your connection and try again.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new VerifyError(`The transcription service rejected ${name}. Check the key and try again.`);
  }
  if (!response.ok) {
    throw new VerifyError('The transcription service didn’t answer properly. Try again in a moment.');
  }
}

/** Batch (non-streaming) transcription providers, in fallback order. */
export const TRANSCRIPTION_ORDER: Extract<TranscriptionProvider, ProviderId>[] = ['groq', 'openai'];
export const SUMMARY_ORDER: ProviderId[] = ['groq', 'openai', 'openrouter', 'anthropic'];
const TRANSCRIPTION_MODEL: Record<TranscriptionProvider, string> = {
  groq: 'whisper-large-v3-turbo',
  openai: 'whisper-1',
  deepgram: 'nova-3',
};
const SUMMARY_MODEL: Record<ProviderId, string> = {
  groq: 'openai/gpt-oss-120b',
  openrouter: 'openai/gpt-oss-120b',
  ollama: 'llama3.2',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-haiku-4-5',
  google: 'gemini-2.5-flash',
  xai: 'grok-3-mini',
};
/** True when the provider can be used with these results (Ollama needs no key). */
export function providerWorks(id: ProviderId, results: KeyResults): boolean {
  const name = PROVIDERS[id].keyName;
  return !name || results[name] === 'ok';
}

export function transcriptionFor(
  id: Settings['transcription']['provider'],
  current: Settings['transcription'],
): Settings['transcription'] {
  return id === current.provider ? current : { provider: id, model: TRANSCRIPTION_MODEL[id] };
}

export function summaryFor(id: ProviderId, current: Settings['summary']): Settings['summary'] {
  return id === current.provider ? current : { provider: id, model: SUMMARY_MODEL[id] };
}

/**
 * Picks providers whose keys work: the current one if its key is ok, else the first ok in order.
 * Keeps the current one when nothing works. Speaker names stay on only if the Deepgram key is ok.
 * Returns full nested objects (updateSettings replaces them whole).
 */
export function pickProviders(
  results: KeyResults,
  settings: Pick<Settings, 'transcription' | 'summary' | 'features'>,
): Pick<Settings, 'transcription' | 'summary' | 'features'> {
  const current = transcriptionKeyName(settings.transcription.provider);
  const t = !current || results[current] === 'ok'
    ? settings.transcription.provider
    : TRANSCRIPTION_ORDER.find((id) => providerWorks(id, results)) ?? settings.transcription.provider;
  const s = providerWorks(settings.summary.provider, results)
    ? settings.summary.provider
    : SUMMARY_ORDER.find((id) => providerWorks(id, results)) ?? settings.summary.provider;
  return {
    transcription: transcriptionFor(t, settings.transcription),
    summary: summaryFor(s, settings.summary),
    features: { ...settings.features, speakerNames: settings.features.speakerNames && results[DEEPGRAM_KEY] === 'ok' },
  };
}

/**
 * True when the chosen transcription key was rejected. Only re-checks (one cheap call) when the last check
 * rejected it, so a key fixed in Settings since then clears the warning.
 */
export async function transcriptionKeyRejected(
  settings?: Pick<Settings, 'transcription'>,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const s = settings ?? (await getSettings());
  const name = transcriptionKeyName(s.transcription.provider);
  const status = await loadKeyStatus();
  if (!name || status[name] !== 'rejected') return false;
  const key = (await loadKeys())[name];
  if (!key) return false;
  const now = (await checkKeys({ [name]: key }, fetchImpl))[name] ?? 'unreachable';
  await saveKeyStatus({ ...(await loadKeyStatus()), [name]: now });
  return now === 'rejected';
}
