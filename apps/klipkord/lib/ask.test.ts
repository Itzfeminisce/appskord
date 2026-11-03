import { describe, expect, it, vi } from 'vitest';
import { askRecording, buildAskPrompt, ENGINE_FOOTER, NOTES_FOOTER, checkTimes, parseTimes, stripUnsupported } from './ask';
import type { Segment } from './types';

const transcript: Segment[] = [
  { start: 221_000, end: 226_000, text: 'It freezes in Safari.' },
  { start: 235_000, end: 240_000, text: 'Chrome works fine.' },
];
const json = (body: unknown) => new Response(JSON.stringify(body));
const down = async (): Promise<Response> => { throw new TypeError('offline'); };
const ollama = (content: string) => vi.fn(async (url: string) => (url.endsWith('/api/tags') ? json({ models: [{ name: 'llama3.2' }] }) : json({ message: { content } })));
type Deps = Parameters<typeof askRecording>[3];
const deps = (fetchFn: Deps['fetchFn'], keys: Record<string, string> = {}): Deps => ({ settings: { notes: { provider: 'ollama', model: '' } }, keys, fetchFn, globalObject: {} });

describe('time check', () => {
  it('parses unique m:ss and h:mm:ss times', () => {
    expect(parseTimes('At [03:41] and [03:41], later [1:02:03], bad [03:75].')).toEqual([221_000, 3_723_000]);
  });
  it('drops invented times and keeps the lines behind real ones', () => {
    const r = checkTimes([221_000, 600_000], transcript);
    expect(r.times).toEqual([221_000]);
    expect(r.sources).toEqual([transcript[0]]);
  });
  it('strips unsupported citations from the text', () => {
    expect(stripUnsupported('Safari [03:41]. Firefox [10:00].', [221_000])).toBe('Safari [03:41]. Firefox.');
  });
});

describe('buildAskPrompt', () => {
  it('puts timed lines and the question in the user message and the rules in system', () => {
    const p = buildAskPrompt('Checkout', transcript, ' Which browsers? ');
    expect(p.system).toContain('using only the transcript');
    expect(p.user).toContain('[03:41] It freezes in Safari.');
    expect(p.user).toContain('Question: Which browsers?');
  });
  it('shortens an over-long transcript in the middle', () => {
    expect(buildAskPrompt('t', transcript, 'q', 40).user).toContain('middle of the transcript omitted');
  });
});

describe('askRecording', () => {
  it('answers through Ollama with checked times', async () => {
    const r = await askRecording('t', transcript, 'q', deps(ollama('Safari froze [03:41]; Chrome did not [03:55]; maybe [09:00].')));
    expect(r).toMatchObject({ kind: 'answer', answer: { times: [221_000, 235_000], engine: 'ollama' } });
    if (r.kind === 'answer') expect(r.answer.text).not.toContain('09:00');
  });
  it('answers through Groq with an injected fetch', async () => {
    const fetchFn = vi.fn(async () => json({ choices: [{ message: { content: 'Safari [03:41]' } }] }));
    const r = await askRecording('t', transcript, 'q', { ...deps(fetchFn, { GROQ_API_KEY: 'gsk_test' }), settings: { notes: { provider: 'groq', model: 'openai/gpt-oss-120b' } } });
    expect(r).toMatchObject({ kind: 'answer', answer: { engine: 'groq' } });
  });
  it('answers through the picked provider and names it in the footer', async () => {
    const fetchFn = vi.fn(async (_u: string, _i?: RequestInit) => json({ choices: [{ message: { content: 'Safari [03:41]' } }] }));
    const r = await askRecording('t', transcript, 'q', { ...deps(fetchFn, { ANTHROPIC_API_KEY: 'sk-ant-fake' }), settings: { notes: { provider: 'anthropic', model: 'claude-sonnet-5-5' } } });
    expect(r).toMatchObject({ kind: 'answer', answer: { engine: 'anthropic' } });
    const call = fetchFn.mock.calls.find(([u]) => u.startsWith('https://api.anthropic.com/'))!;
    expect(JSON.parse(call[1]!.body as string).model).toBe('claude-sonnet-5-5');
    expect(ENGINE_FOOTER.anthropic).toBe('Answered by Anthropic. Only the transcript text was sent.');
    expect(ENGINE_FOOTER.groq).toBe('Answered by Groq. Only the transcript text was sent.');
  });
  it('gives every notes engine its footer', () => {
    expect(Object.keys(NOTES_FOOTER).sort()).toEqual(Object.keys(ENGINE_FOOTER).sort());
    expect(NOTES_FOOTER.openai).toBe('Written by OpenAI. Only the transcript text was sent.');
    expect(NOTES_FOOTER.ollama).toBe('Written on this computer by Ollama.');
  });
  it('answers through built-in AI', async () => {
    const prompt = vi.fn(async () => 'Safari [03:41]');
    const globalObject = { LanguageModel: { availability: async () => 'available', create: async () => ({ prompt, destroy() {} }) } };
    const r = await askRecording('t', transcript, 'q', { ...deps(down), settings: { notes: { provider: 'builtin', model: 'builtin' } }, globalObject });
    expect(r).toMatchObject({ kind: 'answer', answer: { engine: 'builtin' } });
  });
  it('says not set up when no engine is ready', async () => {
    expect(await askRecording('t', transcript, 'q', deps(down))).toEqual({ kind: 'not-set-up' });
  });
  it('says no answer for NO_ANSWER or only invented times', async () => {
    expect(await askRecording('t', transcript, 'q', deps(ollama('NO_ANSWER')))).toEqual({ kind: 'no-answer' });
    expect(await askRecording('t', transcript, 'q', deps(ollama('It was Safari [09:00].')))).toEqual({ kind: 'no-answer' });
  });
});
