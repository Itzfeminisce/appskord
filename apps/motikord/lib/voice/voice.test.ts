import { describe, expect, it, vi } from 'vitest';
import { chromeSiteSettingsUrl, formatTimer, insertWords, joinResults, micProblem, nextStep } from './listen';
import { chooseVoicePath } from './path';
import { buildTranscriptionRequest, isoLanguage, transcribe, VoiceError, voiceErrorForStatus } from './transcribe';

const audio = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('chooseVoicePath', () => {
  const base = { ai: 'cloud' as const, provider: 'groq' as const, hasKey: true };
  it('prefers on-device speech, downloading the language when needed', () => {
    expect(chooseVoicePath({ ...base, local: 'available' })).toEqual({ kind: 'local', download: false });
    expect(chooseVoicePath({ ...base, local: 'downloadable' })).toEqual({ kind: 'local', download: true });
    expect(chooseVoicePath({ ...base, local: 'downloading' })).toEqual({ kind: 'local', download: true });
  });
  it('falls back to Groq or OpenAI only with a key', () => {
    expect(chooseVoicePath({ ...base, local: 'unavailable' })).toEqual({ kind: 'cloud', provider: 'groq' });
    expect(chooseVoicePath({ ...base, provider: 'openai', local: 'unavailable' })).toEqual({ kind: 'cloud', provider: 'openai' });
    expect(chooseVoicePath({ ...base, hasKey: false, local: 'unavailable' })).toEqual({ kind: 'unavailable' });
  });
  it('is unavailable for providers without speech-to-text and for built-in AI', () => {
    expect(chooseVoicePath({ ...base, provider: 'anthropic', local: 'unavailable' })).toEqual({ kind: 'unavailable' });
    expect(chooseVoicePath({ ...base, provider: 'openrouter', local: 'unavailable' })).toEqual({ kind: 'unavailable' });
    expect(chooseVoicePath({ ...base, ai: 'local', local: 'unavailable' })).toEqual({ kind: 'unavailable' });
  });
});

describe('transcription request', () => {
  it('builds the Groq request', async () => {
    const { url, init } = buildTranscriptionRequest('groq', 'gsk_test', audio(), 'en-GB');
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('language')).toBe('en');
    expect((form.get('file') as File).name).toBe('prompt.webm');
  });
  it('builds the OpenAI request', () => {
    const { url, init } = buildTranscriptionRequest('openai', 'sk-test', audio(), 'fr');
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init.body as FormData).get('model')).toBe('gpt-4o-mini-transcribe');
    expect(isoLanguage('pt-BR')).toBe('pt');
  });
  it('returns the trimmed text through the injected fetch', async () => {
    const f = vi.fn(async () => ok({ text: '  A promo for sourdough  ' }));
    await expect(transcribe('groq', 'gsk_test', audio(), { lang: 'en-US', fetch: f as unknown as typeof fetch })).resolves.toBe('A promo for sourdough');
    expect(f).toHaveBeenCalledOnce();
  });
  it('maps failures to codes and never carries the key', async () => {
    expect(voiceErrorForStatus(401)).toBe('key');
    expect(voiceErrorForStatus(429)).toBe('busy');
    expect(voiceErrorForStatus(503)).toBe('down');
    expect(voiceErrorForStatus(400)).toBe('failed');
    const f = async () => new Response('{"error":"bad key gsk_test"}', { status: 401 });
    const error = await transcribe('groq', 'gsk_test', audio(), { lang: 'en', fetch: f as typeof fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VoiceError);
    expect((error as VoiceError).code).toBe('key');
    expect(String((error as Error).message)).not.toContain('gsk_test');
    const offline = async () => { throw new TypeError('Failed to fetch'); };
    await expect(transcribe('openai', 'sk-test', audio(), { lang: 'en', fetch: offline as typeof fetch })).rejects.toMatchObject({ code: 'offline' });
    const ac = new AbortController(); ac.abort();
    const aborted = async () => { throw new DOMException('aborted', 'AbortError'); };
    await expect(transcribe('openai', 'sk-test', audio(), { lang: 'en', fetch: aborted as typeof fetch, signal: ac.signal })).rejects.toMatchObject({ code: 'cancelled' });
    const odd = async () => ok({ nope: 1 });
    await expect(transcribe('groq', 'gsk_test', audio(), { lang: 'en', fetch: odd as typeof fetch })).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('listening rules', () => {
  it('stops after a 3-second pause, after 8 silent seconds, or at the cap', () => {
    expect(nextStep({ elapsedMs: 5000, heard: false, sinceSoundMs: 5000 })).toBe('continue');
    expect(nextStep({ elapsedMs: 8000, heard: false, sinceSoundMs: 8000 })).toBe('not-heard');
    expect(nextStep({ elapsedMs: 9000, heard: true, sinceSoundMs: 2000 })).toBe('continue');
    expect(nextStep({ elapsedMs: 9000, heard: true, sinceSoundMs: 3000 })).toBe('finish');
    expect(nextStep({ elapsedMs: 120_000, heard: true, sinceSoundMs: 0 })).toBe('finish');
  });
  it('formats the timer', () => {
    expect(formatTimer(7_400)).toBe('0:07');
    expect(formatTimer(65_000)).toBe('1:05');
  });
  it('adds words at the cursor without replacing typed text', () => {
    expect(insertWords('', 0, 'a promo')).toEqual({ text: 'a promo', cursor: 7 });
    expect(insertWords('A promo.', 8, 'Warm and friendly')).toEqual({ text: 'A promo. Warm and friendly', cursor: 26 });
    expect(insertWords('A promo for bread', 8, 'sourdough')).toEqual({ text: 'A promo sourdough for bread', cursor: 17 });
    expect(insertWords('typed', 5, '   ')).toEqual({ text: 'typed', cursor: 5 });
  });
  it('splits settled and still-heard words', () => {
    expect(joinResults([{ transcript: 'A promo ', isFinal: true }, { transcript: ' ending with', isFinal: false }])).toEqual({ settled: 'A promo', interim: 'ending with' });
  });
  it('maps microphone failures to their cards', () => {
    expect(micProblem('NotAllowedError')).toBe('voice-mic-blocked');
    expect(micProblem('not-allowed')).toBe('voice-mic-blocked');
    expect(micProblem('NotFoundError')).toBe('voice-no-mic');
    expect(micProblem('audio-capture')).toBe('voice-no-mic');
    expect(chromeSiteSettingsUrl('abc')).toBe('chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2Fabc');
  });
});
