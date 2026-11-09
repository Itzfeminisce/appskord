import { describe, expect, it, vi } from 'vitest';
import { buildCaptionRequest, CAPTION_MODELS, cuesFromResponse, srtTime, toSrt, transcribeCues } from './captions';
import { buildSpeechRequest, makeVoiceover, TTS_API } from './speech';
import { VoiceError } from './transcribe';

const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('captions', () => {
  it('asks Groq and OpenAI for timestamped text with the key in the header only', () => {
    for (const [p, key] of [['groq', 'gsk_test'], ['openai', 'sk-test']] as const) {
      const { url, init } = buildCaptionRequest(p, key, audio, 'en-GB');
      const form = init.body as FormData;
      expect(url).toContain(p === 'groq' ? 'api.groq.com' : 'api.openai.com');
      expect(form.get('model')).toBe(CAPTION_MODELS[p]);
      expect(form.get('response_format')).toBe('verbose_json');
      expect(form.get('language')).toBe('en');
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${key}`);
      expect([...form.keys()].sort()).toEqual(['file', 'language', 'model', 'response_format', 'timestamp_granularities[]']);
    }
  });
  it('turns segments into cues and finds no speech in an empty answer', async () => {
    const f = vi.fn(async () => json({ segments: [{ start: 0.2, end: 2.5, text: ' Morning  shift. ' }, { start: 3, end: 3, text: ' ' }, { start: 4, end: 4.1, text: 'Hi' }] }));
    const cues = await transcribeCues('groq', 'gsk_test', audio, { fetch: f as unknown as typeof fetch });
    expect(cues).toEqual([{ startMs: 200, endMs: 2500, text: 'Morning shift.' }, { startMs: 4000, endMs: 4300, text: 'Hi' }]);
    expect(cuesFromResponse({ text: '' })).toEqual([]);
  });
  it('maps failures to codes without the key or body', async () => {
    const down = vi.fn(async () => json({ error: 'sk-test' }, 401));
    await expect(transcribeCues('openai', 'sk-test', audio, { fetch: down as unknown as typeof fetch })).rejects.toMatchObject({ code: 'key', status: 401 });
    const off = vi.fn(async () => { throw new TypeError('x'); });
    await expect(transcribeCues('groq', 'gsk_test', audio, { fetch: off as unknown as typeof fetch })).rejects.toBeInstanceOf(VoiceError);
  });
  it('writes .srt', () => {
    expect(srtTime(3_661_005)).toBe('01:01:01,005');
    expect(toSrt([{ startMs: 0, endMs: 1500, text: 'A' }, { startMs: 2000, endMs: 3000, text: 'B' }])).toBe('1\n00:00:00,000 --> 00:00:01,500\nA\n\n2\n00:00:02,000 --> 00:00:03,000\nB\n');
  });
});

describe('voiceover', () => {
  it('sends only the script, model and voice', () => {
    const { url, init } = buildSpeechRequest('sk-test', 'Hello there.', 'deep');
    expect(url).toBe(TTS_API.url);
    expect(JSON.parse(init.body as string)).toEqual({ model: TTS_API.model, voice: 'onyx', input: 'Hello there.', response_format: 'mp3' });
  });
  it('needs a key, returns audio, and reports failures as codes', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([9, 9]), { status: 200 }));
    await expect(makeVoiceover(undefined, 'Hi.', 'warm', { fetch: f as unknown as typeof fetch })).rejects.toMatchObject({ code: 'key' });
    expect(f).not.toHaveBeenCalled();
    expect((await makeVoiceover('sk-test', 'Hi.', 'warm', { fetch: f as unknown as typeof fetch })).size).toBe(2);
    const busy = vi.fn(async () => new Response('', { status: 429 }));
    await expect(makeVoiceover('sk-test', 'Hi.', 'warm', { fetch: busy as unknown as typeof fetch })).rejects.toMatchObject({ code: 'busy' });
  });
});
