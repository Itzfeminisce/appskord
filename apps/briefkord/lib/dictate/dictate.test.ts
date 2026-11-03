import { describe, expect, it, vi } from 'vitest';
import { insertWords } from './insert';
import { barHeights, clock, dictate, IDLE, pressAction, type DictatePhase } from './machine';
import { SpeechError, speechModel, speechProvider, transcribe } from './speech';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('dictate machine', () => {
  it('press starts, press again stops, then writes', () => {
    let p: DictatePhase = IDLE;
    expect(pressAction(p)).toBe('start');
    p = dictate(p, { type: 'ask' });
    expect(pressAction(p)).toBe('none');
    p = dictate(p, { type: 'listen', at: 5 });
    expect(p).toEqual({ kind: 'listening', since: 5 });
    expect(pressAction(p)).toBe('stop');
    p = dictate(p, { type: 'stop' });
    expect(p.kind).toBe('writing');
    expect(pressAction(p)).toBe('none');
    expect(dictate(p, { type: 'reset' })).toEqual(IDLE);
  });

  it('a press after an error tries again', () => {
    expect(pressAction(dictate(IDLE, { type: 'no-key' }))).toBe('start');
    expect(pressAction(dictate(IDLE, { type: 'blocked' }))).toBe('start');
    expect(pressAction(dictate(IDLE, { type: 'fail', why: 'key', provider: 'groq' }))).toBe('start');
  });

  it('ignores stray events', () => {
    expect(dictate(IDLE, { type: 'stop' })).toEqual(IDLE);
    const writing: DictatePhase = { kind: 'writing' };
    expect(dictate(writing, { type: 'listen', at: 1 })).toBe(writing);
  });

  it('shows the timer and bar heights', () => {
    expect(clock(7000)).toBe('0:07');
    expect(clock(75_500)).toBe('1:15');
    expect(barHeights(new Uint8Array(18).fill(0), 9)).toEqual(Array(9).fill(4));
    expect(barHeights(new Uint8Array(18).fill(255), 9)).toEqual(Array(9).fill(18));
  });
});

describe('insertWords', () => {
  it('adds a space after a sentence and tints only the words', () => {
    const v = 'Cart, then address, then payment.';
    const r = insertWords(v, v.length, v.length, ' If the card is saved go to confirm. ')!;
    expect(r.value).toBe('Cart, then address, then payment. If the card is saved go to confirm.');
    expect(r.value.slice(r.from, r.to)).toBe('If the card is saved go to confirm.');
    expect(r.text).toBe(' If the card is saved go to confirm.');
  });

  it('inserts at the cursor and replaces a selection', () => {
    expect(insertWords('ab cd', 3, 3, 'xy')!.value).toBe('ab xy cd');
    expect(insertWords('ab old cd', 3, 6, 'new')!.value).toBe('ab new cd');
    expect(insertWords('', 0, 0, 'hello')!.value).toBe('hello');
    expect(insertWords('Hi', 2, 2, 'there')!.value).toBe('Hi there');
    expect(insertWords('(x', 1, 1, 'y')!.value).toBe('(y x');
  });

  it('puts nothing in for silence', () => {
    expect(insertWords('ab', 2, 2, '   ')).toBeUndefined();
  });
});

describe('speech', () => {
  it('picks Groq when its key is loaded, else OpenAI', () => {
    expect(speechProvider(['OPENAI_API_KEY', 'GROQ_API_KEY'])).toBe('groq');
    expect(speechProvider(['OPENAI_API_KEY'])).toBe('openai');
    expect(speechProvider(['ANTHROPIC_API_KEY'])).toBeUndefined();
  });

  it('takes the model from the live list, preferring the suggested id', async () => {
    const f = vi.fn(async () => json({ data: [{ id: 'whisper-large-v3' }, { id: 'whisper-large-v3-turbo' }, { id: 'llama' }] }));
    expect(await speechModel('groq', 'gsk_test', f)).toBe('whisper-large-v3-turbo');
  });

  it('falls back to the suggested model when the list fails', async () => {
    const f = vi.fn(async () => json({}, 401));
    expect(await speechModel('openai', 'sk-test', f)).toBe('gpt-transcribe');
  });

  it('sends the audio once and returns the words', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json({ text: ' hello there ' }));
    const text = await transcribe('openai', 'sk-test', 'gpt-transcribe', new Blob(['x'], { type: 'audio/webm' }), { fetch: f });
    expect(text).toBe('hello there');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init!.body as FormData).get('model')).toBe('gpt-transcribe');
  });

  it('maps failures without the key', async () => {
    const run = (f: () => Promise<Response>) => transcribe('groq', 'gsk_test', 'm', new Blob(['x']), { fetch: f }).catch((e: unknown) => e);
    const refused = (await run(async () => json({}, 401))) as SpeechError;
    expect(refused.why).toBe('key');
    expect(refused.message).not.toContain('gsk_test');
    expect(((await run(async () => json({}, 429))) as SpeechError).why).toBe('busy');
    expect(((await run(async () => Promise.reject(new TypeError('x')))) as SpeechError).why).toBe('busy');
    expect(((await run(async () => json({ nope: 1 }))) as SpeechError).why).toBe('failed');
  });
});
