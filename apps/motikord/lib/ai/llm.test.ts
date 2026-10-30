import { describe, expect, it, vi } from 'vitest';
import { chat, GROQ_MODEL, GROQ_URL, LLMError, type FetchLike, type LanguageModelLike } from '../llm';

const KEY = 'gsk_test';
const ok = (content: string): FetchLike => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));
const status = (code: number, headers: Record<string, string> = {}): FetchLike => async () => new Response('{}', { status: code, headers });
const code = async (p: Promise<unknown>) => p.then(() => 'resolved', (e: LLMError) => e.code);

describe('chat with Groq', () => {
  it('posts the model, JSON mode and the key, and returns the text', async () => {
    const fetch = ok('{"type":"quote"}');
    const reply = await chat([{ role: 'user', content: 'hi' }], { ai: 'cloud', key: KEY, fetch, json: true });
    expect(reply).toEqual({ text: '{"type":"quote"}', by: 'groq' });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(GROQ_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body);
    expect(body.model).toBe(GROQ_MODEL);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('maps failures to codes', async () => {
    const m = [{ role: 'user' as const, content: 'x' }];
    expect(await code(chat(m, { ai: 'cloud', key: '', fetch: ok('x') }))).toBe('no-key');
    expect(await code(chat(m, { ai: 'cloud', key: KEY, fetch: async () => { throw new TypeError('Failed to fetch'); } }))).toBe('offline');
    expect(await code(chat(m, { ai: 'cloud', key: KEY, fetch: async () => { throw new DOMException('stop', 'AbortError'); } }))).toBe('cancelled');
    expect(await code(chat(m, { ai: 'cloud', key: KEY, fetch: status(401) }))).toBe('auth');
    expect(await code(chat(m, { ai: 'cloud', key: KEY, fetch: status(503) }))).toBe('server');
    expect(await code(chat(m, { ai: 'cloud', key: KEY, fetch: async () => new Response('{"choices":[]}') }))).toBe('bad-reply');
    const busy = await chat(m, { ai: 'cloud', key: KEY, fetch: status(429, { 'retry-after': '20' }) }).catch((e: LLMError) => e);
    expect(busy).toMatchObject({ code: 'rate-limited', retryAfterMs: 20000 });
  });
});

describe('chat with built-in AI', () => {
  it('uses LanguageModel with earlier messages as initial prompts', async () => {
    const prompt = vi.fn(async () => '{"type":"logo"}');
    const create = vi.fn(async () => ({ prompt, destroy: () => {} }));
    const lm: LanguageModelLike = { availability: async () => 'available', create };
    const reply = await chat([{ role: 'system', content: 'sys' }, { role: 'user', content: 'u' }], { ai: 'local', languageModel: lm, fetch: ok('never') });
    expect(reply).toEqual({ text: '{"type":"logo"}', by: 'builtin' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ initialPrompts: [{ role: 'system', content: 'sys' }] }));
    expect(prompt).toHaveBeenCalledWith('u', expect.anything());
  });

  it('reports when the machine has no built-in AI', async () => {
    const lm: LanguageModelLike = { availability: async () => 'unavailable', create: async () => { throw new Error('no'); } };
    expect(await code(chat([{ role: 'user', content: 'u' }], { ai: 'local', languageModel: lm }))).toBe('local-unavailable');
  });

  it('treats a model that still has to download as local-unavailable and never creates a session', async () => {
    for (const a of ['downloadable', 'downloading'] as const) {
      const create = vi.fn();
      const lm: LanguageModelLike = { availability: async () => a, create };
      expect(await code(chat([{ role: 'user', content: 'u' }], { ai: 'local', languageModel: lm }))).toBe('local-unavailable');
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('reports a create() failure as local-unavailable', async () => {
    const lm: LanguageModelLike = { availability: async () => 'available', create: async () => { throw new Error('no'); } };
    expect(await code(chat([{ role: 'user', content: 'u' }], { ai: 'local', languageModel: lm }))).toBe('local-unavailable');
  });

  it('passes responseConstraint when json is asked for', async () => {
    const prompt = vi.fn(async () => '{}');
    const lm: LanguageModelLike = { availability: async () => 'available', create: async () => ({ prompt }) };
    await chat([{ role: 'user', content: 'u' }], { ai: 'local', languageModel: lm, json: true });
    expect(prompt).toHaveBeenCalledWith('u', expect.objectContaining({ responseConstraint: expect.anything() }));
  });
});

describe('cancel stays cancel', () => {
  it('maps an abort while reading the Groq body to cancelled', async () => {
    const ac = new AbortController();
    const fetch: FetchLike = async () => ({
      ok: true, status: 200, headers: new Headers(),
      json: async () => { ac.abort(); throw new DOMException('aborted', 'AbortError'); },
    } as unknown as Response);
    expect(await code(chat([{ role: 'user', content: 'u' }], { ai: 'cloud', key: KEY, fetch, signal: ac.signal }))).toBe('cancelled');
  });
});
