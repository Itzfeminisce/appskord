import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_RATE } from './chunker';
import { transcribeAll, transcribeCloud } from './full';
import { CLOUD_CHUNK_MS, SpeechError } from './groq';
import { OPENAI_SPEECH_MODEL, transcribeOpenAI } from './openai';

const KEY = 'sk-fake-test';
const audio = new Float32Array(1600).fill(0.1);
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
type Call = [string, RequestInit];
const form = (f: { mock: { calls: unknown[] } }, i = 0) => (f.mock.calls[i] as Call)[1].body as FormData;

describe('transcribeOpenAI', () => {
  it('posts a WAV to OpenAI with the picked model, the key and the language, and reads word times', async () => {
    const words = [{ word: ' Hello', start: 0.1, end: 0.4 }];
    const fetchFn = vi.fn(async () => reply(200, { text: ' Hello. ', words }));
    await expect(transcribeOpenAI(audio, { key: KEY, model: 'gpt-transcribe', language: 'en' }, fetchFn)).resolves.toEqual({
      text: 'Hello.', words: [{ start: 100, end: 400, text: 'Hello' }],
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as Call;
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(form(fetchFn).get('model')).toBe('gpt-transcribe');
    expect(form(fetchFn).get('language')).toBe('en');
    expect(form(fetchFn).get('response_format')).toBe('verbose_json');
    expect((form(fetchFn).get('file') as File).type).toBe('audio/wav');
  });

  it('defaults to gpt-transcribe and leaves language out on auto', async () => {
    const fetchFn = vi.fn(async () => reply(200, { text: 'x' }));
    await transcribeOpenAI(audio, { key: KEY, language: 'auto' }, fetchFn);
    expect(OPENAI_SPEECH_MODEL).toBe('gpt-transcribe');
    expect(form(fetchFn).get('model')).toBe('gpt-transcribe');
    expect(form(fetchFn).has('language')).toBe(false);
  });

  it('asks once more for plain text when the model refuses word times', async () => {
    const fetchFn = vi.fn(async (_u: string, i?: RequestInit) =>
      (i!.body as FormData).get('response_format') === 'verbose_json' ? reply(400, { error: { message: 'response_format' } }) : reply(200, { text: 'Plain.' }));
    await expect(transcribeOpenAI(audio, { key: KEY }, fetchFn)).resolves.toEqual({ text: 'Plain.' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(form(fetchFn, 1).get('response_format')).toBe('json');
    expect(form(fetchFn, 1).has('timestamp_granularities[]')).toBe(false);
  });

  it.each([[401, 'auth'], [429, 'rate-limited'], [503, 'server']])('maps HTTP %i to %s, naming OpenAI and never the key', async (status, code) => {
    const error = await transcribeOpenAI(audio, { key: KEY }, async () => reply(status)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpeechError);
    expect((error as SpeechError).code).toBe(code);
    expect((error as Error).message).toContain('OpenAI');
    expect((error as Error).message).not.toContain(KEY);
  });

  it('a failed fetch is offline; no key never fetches', async () => {
    await expect(transcribeOpenAI(audio, { key: KEY }, async () => { throw new TypeError('net'); })).rejects.toMatchObject({ code: 'offline' });
    const fetchFn = vi.fn();
    await expect(transcribeOpenAI(audio, { key: '' }, fetchFn)).rejects.toMatchObject({ code: 'no-key' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('OpenAI chunk timing', () => {
  it('sends the same 5-minute chunks as Groq and places each one at its time in the track', async () => {
    const ms = 11 * 60_000;
    const voice = new Float32Array(Math.round((ms / 1000) * SAMPLE_RATE)).fill(0.1);
    const sizes: number[] = [];
    const fetchFn = vi.fn(async (_u: string, i?: RequestInit) => {
      sizes.push(((i!.body as FormData).get('file') as File).size);
      return reply(200, { text: `Part ${sizes.length}.` });
    });
    const segs = await transcribeAll(voice, {
      chunkMs: CLOUD_CHUNK_MS,
      transcribe: (a) => transcribeCloud('openai', a, { key: KEY, model: 'gpt-transcribe' }, fetchFn),
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls.every(([u]) => u === 'https://api.openai.com/v1/audio/transcriptions')).toBe(true);
    // A 5-minute 16 kHz 16-bit WAV is about 9.6 MB, under OpenAI's 25 MB limit.
    expect(Math.max(...sizes)).toBeLessThan(25 * 1024 * 1024);
    expect(segs!.map((s) => [s.start, s.end, s.text])).toEqual([[0, CLOUD_CHUNK_MS, 'Part 1.'], [CLOUD_CHUNK_MS, 2 * CLOUD_CHUNK_MS, 'Part 2.'], [2 * CLOUD_CHUNK_MS, ms, 'Part 3.']]);
  });

  it('Groq takes the same path with its own URL', async () => {
    const fetchFn = vi.fn(async () => reply(200, { text: 'x' }));
    await transcribeCloud('groq', audio, { key: 'gsk_fake', model: 'whisper-large-v3' }, fetchFn);
    expect((fetchFn.mock.calls[0] as unknown as Call)[0]).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(form(fetchFn).get('model')).toBe('whisper-large-v3');
  });
});
