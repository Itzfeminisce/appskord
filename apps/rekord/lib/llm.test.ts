import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { saveKeys } from './penv';
import { chat, GROQ_CHAT_PREFERENCE, LLMError, speakerName, transcriptLines } from './llm';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from './settings';
import type { Segment } from './types';

const reply = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
const msgs = [{ role: 'user' as const, content: 'hi' }];
const cut = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'length' }] }));

beforeEach(async () => {
  fakeBrowser.reset();
  await saveKeys({ GROQ_API_KEY: 'gsk_test' });
});

describe('chat', () => {
  it('returns a JSON reply the token limit cut off, for the caller to read', async () => {
    expect(await chat(msgs, { json: true }, async () => cut('{"a":'))).toBe('{"a":');
  });

  it('posts an OpenAI-style request to the summary provider', async () => {
    const f = vi.fn(async () => reply('hello'));
    expect(await chat(msgs, { json: true, maxTokens: 300 }, f)).toBe('hello');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
    expect(JSON.parse(init.body as string)).toEqual({
      model: DEFAULT_SETTINGS.summary.model, temperature: 0.2, max_tokens: 300,
      response_format: { type: 'json_object' }, messages: msgs,
    });
  });

  it('omits optional fields and uses injected config without storage', async () => {
    const f = vi.fn(async () => reply('ok'));
    const settings = { ...DEFAULT_SETTINGS, summary: { provider: 'ollama' as const, model: 'llama3', baseUrl: 'http://h:1/v1/' } };
    await chat(msgs, { config: { settings, keys: {} } }, f);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://h:1/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBeUndefined();
    expect(body.response_format).toBeUndefined();
  });

  it('maps failures to LLMError codes', async () => {
    const code = async (f: () => Promise<Response>) => {
      try { await chat(msgs, {}, f); } catch (e) { return e instanceof LLMError ? e.code : 'other'; }
      return 'none';
    };
    expect(await code(async () => reply('x', 401))).toBe('auth');
    expect(await code(async () => reply('x', 403))).toBe('auth');
    expect(await code(async () => reply('x', 429))).toBe('rate-limited');
    expect(await code(async () => reply('x', 500))).toBe('server');
    expect(await code(async () => reply(42))).toBe('bad-reply');
    expect(await code(async () => new Response('not json'))).toBe('bad-reply');
    expect(await code(async () => { throw new TypeError('x'); })).toBe('offline');
    await saveKeys({});
    const f = vi.fn();
    expect(await code(f)).toBe('no-key');
    expect(f).not.toHaveBeenCalled();
  });

  it('keeps Rekord\'s sentences', async () => {
    const message = async (f: () => Promise<Response>) => chat(msgs, {}, f).catch((e: LLMError) => e.message);
    expect(await message(async () => reply('x', 401))).toBe('The AI service did not accept your key. Check Connect AI in Settings.');
    expect(await message(async () => reply('x', 429))).toBe('The AI service is busy right now. Try again in a minute.');
    expect(await message(async () => reply('x', 400))).toBe('The AI service returned an error (400). Try again.');
    expect(await message(async () => reply('x', 413))).toBe('The AI service returned an error (413). Try again.');
    expect(await message(async () => reply(42))).toBe('The AI service sent an unexpected reply. Try again.');
    expect(await message(async () => { throw new TypeError('x'); })).toBe('Rekord could not reach the AI service. Check your connection and try again.');
    await saveKeys({});
    expect(await message(async () => reply('x'))).toBe('Rekord needs an AI connection for this. Check Connect AI in Settings.');
  });

  it('the default Groq summary model is the first preference', () => {
    expect(DEFAULT_SETTINGS.summary).toEqual({ provider: 'groq', model: GROQ_CHAT_PREFERENCE[0] });
  });

  it('never puts the key in an error message', async () => {
    await updateSettings({ summary: { provider: 'groq', model: 'm' } });
    await expect(chat(msgs, {}, async () => reply('x', 401))).rejects.not.toThrow(/gsk_test/);
  });

  describe('when Groq has retired the model', () => {
    const gone = () => new Response(JSON.stringify({ error: { code: 'model_not_found' } }), { status: 404 });
    const models = (ids: string[]) => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }));
    const groq = (byModel: Record<string, () => Response>, ids: string[]) => vi.fn(async (url: string, init?: RequestInit) =>
      url.endsWith('/models') ? models(ids) : byModel[JSON.parse(String(init?.body)).model as string]!());

    it('picks a listed model, saves it, and retries once', async () => {
      await updateSettings({ summary: { provider: 'groq', model: 'old-model' } });
      const f = groq({ 'old-model': gone, 'qwen/qwen3-32b': () => reply('healed') }, ['whisper-large-v3', 'qwen/qwen3-32b']);
      expect(await chat(msgs, {}, f)).toBe('healed');
      expect((await getSettings()).summary).toEqual({ provider: 'groq', model: 'qwen/qwen3-32b' });
      expect(await chat(msgs, {}, f)).toBe('healed');
      expect(f.mock.calls.filter(([u]) => u.endsWith('/models'))).toHaveLength(1);
    });

    it('does not loop when the picked model also fails, and leaves injected config unsaved', async () => {
      const settings = { ...DEFAULT_SETTINGS, summary: { provider: 'groq' as const, model: 'old-model' } };
      const f = groq({ 'old-model': gone, 'llama-3.1-8b-instant': gone }, ['llama-3.1-8b-instant']);
      await expect(chat(msgs, { config: { settings, keys: { GROQ_API_KEY: 'gsk_test' } } }, f)).rejects.toMatchObject({ code: 'server' });
      expect(f).toHaveBeenCalledTimes(3);
      expect((await getSettings()).summary.model).toBe(DEFAULT_SETTINGS.summary.model);
    });

    it('keeps a plain 404 an error without listing models', async () => {
      await updateSettings({ summary: { provider: 'groq', model: 'm' } });
      const f = vi.fn(async () => reply('x', 404));
      await expect(chat(msgs, {}, f)).rejects.toMatchObject({ code: 'server' });
      expect(f).toHaveBeenCalledTimes(1);
    });
  });
});

describe('transcriptLines', () => {
  const seg = (startMs: number, speaker: Segment['speaker'], text: string, speakerLabel?: string): Segment =>
    ({ id: `${startMs}`, meetingId: 'm', speaker, startMs, endMs: startMs + 1, text, chunkId: 'c', speakerLabel });

  it('formats [mm:ss] Name: text with display names when known', () => {
    const lines = transcriptLines(
      [seg(65000, 'you', ' hello '), seg(70000, 'others', 'hi', 'A'), seg(71000, 'others', 'yo', 'B'), seg(72000, 'others', '  ')],
      { A: { name: 'Dana' }, B: { suggested: 'Sam' } },
    );
    expect(lines).toEqual(['[1:05] You: hello', '[1:10] Dana: hi', '[1:11] Speaker B: yo']);
    expect(transcriptLines([seg(0, 'others', 'x', 'A')])).toEqual(['[0:00] Speaker A: x']);
  });
});

describe('speakerName', () => {
  it('uses the saved name, else Speaker <label>, else Others', () => {
    const base = { id: 's', meetingId: 'm', startMs: 0, endMs: 1, text: 't', chunkId: 'c' };
    const sp = { A: { name: ' Dana ' }, B: {} };
    expect(speakerName({ ...base, speaker: 'others', speakerLabel: 'A' }, sp)).toBe('Dana');
    expect(speakerName({ ...base, speaker: 'others', speakerLabel: 'B' }, sp)).toBe('Speaker B');
    expect(speakerName({ ...base, speaker: 'others' }, sp)).toBe('Others');
    expect(speakerName({ ...base, speaker: 'you', speakerLabel: 'A' }, sp)).toBe('You');
  });
});
