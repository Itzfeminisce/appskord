import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatCloud, estimateTokens, chatLocal, extractJson, type CloudChat, type LanguageModelLike } from './chat';
import type { ErrorText } from './errors';

const text: ErrorText = (f) => `${f.reason}:${f.label}${f.status ? `:${f.status}` : ''}`;
const msgs = [
  { role: 'system' as const, content: 'be brief' },
  { role: 'user' as const, content: 'hi' },
];
const reply = (content: unknown, status = 200, finish = 'stop') =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { status });
const apiError = (status: number, error: Record<string, unknown>, headers?: Record<string, string>) =>
  new Response(JSON.stringify({ error }), { status, headers });
const base = (over: Partial<CloudChat>): CloudChat => ({
  app: 'Test',
  text,
  provider: 'groq',
  key: 'gsk_test',
  model: 'm',
  ...over,
});
const sent = (f: ReturnType<typeof vi.fn>, i = 0) => {
  const [url, init] = f.mock.calls[i] as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
};

let err: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => err.mockRestore());

describe('chatCloud requests', () => {
  it('Groq and OpenRouter: OpenAI-style body with a Bearer key', async () => {
    const f = vi.fn(async () => reply('hello'));
    expect(await chatCloud(msgs, base({ fetch: f, json: true, maxTokens: 300 }))).toBe('hello');
    expect(sent(f)).toEqual({
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer gsk_test' },
      body: { model: 'm', temperature: 0.2, max_tokens: 300, response_format: { type: 'json_object' }, messages: msgs },
    });
    await chatCloud(msgs, base({ provider: 'openrouter', key: 'sk-or-test', fetch: f }));
    expect(sent(f, 1).url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
  it('xAI and Gemini: OpenAI chat API on their own hosts with a Bearer key', async () => {
    const f = vi.fn(async () => reply('ok'));
    await chatCloud(msgs, base({ provider: 'xai', key: 'xai-test', model: 'grok-4', fetch: f }));
    expect(sent(f).url).toBe('https://api.x.ai/v1/chat/completions');
    expect(sent(f).headers.Authorization).toBe('Bearer xai-test');
    await chatCloud(msgs, base({ provider: 'google', key: 'AIza-test', model: 'gemini-2.5-flash', fetch: f }));
    expect(sent(f, 1).url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(sent(f, 1).headers.Authorization).toBe('Bearer AIza-test');
  });
  it('OpenAI: max_completion_tokens, and reasoning models drop temperature', async () => {
    const f = vi.fn(async () => reply('ok'));
    await chatCloud(msgs, base({ provider: 'openai', key: 'sk-test', model: 'gpt-4.1', maxTokens: 100, fetch: f }));
    expect(sent(f).body).toMatchObject({ max_completion_tokens: 100, temperature: 0.2 });
    await chatCloud(msgs, base({ provider: 'openai', key: 'sk-test', model: 'gpt-5', maxTokens: 100, fetch: f }));
    expect(sent(f, 1).body).toMatchObject({ max_completion_tokens: 4100, reasoning_effort: 'low' });
    expect(sent(f, 1).body.temperature).toBeUndefined();
  });
  it('Anthropic: Messages API with its headers, system apart, JSON pulled out of prose', async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ content: [{ type: 'text', text: 'Sure: {"a":1} done' }], stop_reason: 'end_turn' }),
        ),
    );
    expect(await chatCloud(msgs, base({ provider: 'anthropic', key: 'sk-ant-test', json: true, fetch: f }))).toBe(
      '{"a":1}',
    );
    const s = sent(f);
    expect(s.url).toBe('https://api.anthropic.com/v1/messages');
    expect(s.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(s.body).toMatchObject({
      max_tokens: 4096,
      system: expect.stringContaining('be brief'),
      messages: [{ role: 'user', content: 'hi' }],
    });
  });
  it('Anthropic through its OpenAI-compatible endpoint when asked', async () => {
    const f = vi.fn(async () => reply('ok'));
    await chatCloud(msgs, base({ provider: 'anthropic', key: 'sk-ant-test', openaiCompatible: true, fetch: f }));
    expect(sent(f).url).toBe('https://api.anthropic.com/v1/chat/completions');
    expect(sent(f).headers.Authorization).toBe('Bearer sk-ant-test');
  });
  it('Ollama: base URL override and no key', async () => {
    const f = vi.fn(async () => reply('ok'));
    await chatCloud(msgs, base({ provider: 'ollama', key: undefined, baseUrl: 'http://h:1/v1/', fetch: f }));
    expect(sent(f).url).toBe('http://h:1/v1/chat/completions');
    expect(sent(f).headers.Authorization).toBeUndefined();
  });
});

describe('chatCloud errors', () => {
  const fails = (f: () => Promise<Response>, over: Partial<CloudChat> = {}) =>
    chatCloud(msgs, base({ fetch: f, ...over })).then(
      () => 'none',
      (e: { code: string; message: string; retryAfterMs?: number }) => [e.code, e.message, e.retryAfterMs],
    );

  it("maps each failure to a code and the app's sentence", async () => {
    expect(await fails(async () => reply('x', 401))).toEqual(['auth', 'auth:Groq:401', undefined]);
    expect(await fails(async () => reply('x', 403))).toEqual(['auth', 'auth:Groq:403', undefined]);
    expect(await fails(async () => apiError(429, { type: 'requests' }, { 'retry-after': '7' }))).toEqual([
      'rate-limited',
      'busy:Groq:429',
      7000,
    ]);
    expect(await fails(async () => apiError(400, { code: 'invalid_request_error' }))).toEqual([
      'bad-reply',
      'refused:Groq:400',
      undefined,
    ]);
    expect(await fails(async () => reply('x', 500))).toEqual(['server', 'status:Groq:500', undefined]);
    expect(await fails(async () => reply('x', 529), { provider: 'anthropic', key: 'sk-ant-test' })).toEqual([
      'server',
      'status:Anthropic:529',
      undefined,
    ]);
    expect(await fails(async () => reply(42))).toEqual(['bad-reply', 'unexpected-reply:Groq', undefined]);
    expect(await fails(async () => new Response('not json'))).toEqual([
      'bad-reply',
      'unexpected-reply:Groq',
      undefined,
    ]);
    expect(await fails(async () => reply('{"a":', 200, 'length'), { json: true, failCutOff: true })).toEqual([
      'bad-reply',
      'cut-off:Groq',
      undefined,
    ]);
    expect(
      await fails(async () => {
        throw new TypeError('down');
      }),
    ).toEqual(['offline', 'offline:Groq', undefined]);
    expect(
      await fails(async () => {
        throw new DOMException('x', 'AbortError');
      }),
    ).toEqual(['cancelled', 'cancelled:Groq', undefined]);
    expect(await fails(async () => apiError(400, { message: 'whisper-large-v3 is not a chat model' }))).toEqual([
      'not-for-text',
      'not-for-text:Groq:400',
      undefined,
    ]);
  });
  it('returns a cut-off JSON reply for the app to read unless it opts in', async () => {
    const cut = vi.fn(async () => reply('{"a":', 200, 'length'));
    expect(await chatCloud(msgs, base({ fetch: cut, json: true }))).toBe('{"a":');
  });
  it('reports a 413 as the HTTP error unless the app calls it busy', async () => {
    const big = async () => apiError(413, { message: 'Request too large' });
    expect(await fails(big)).toEqual(['server', 'status:Groq:413', undefined]);
    expect(await fails(big, { tooLarge: 'busy' })).toEqual(['rate-limited', 'busy:Groq:413', undefined]);
    expect(await fails(async () => apiError(429, { type: 'tokens' }))).toEqual([
      'rate-limited',
      'busy:Groq:429',
      undefined,
    ]);
  });
  it('needs a key, and never puts it in a message or a log', async () => {
    const f = vi.fn();
    expect(await fails(f, { key: undefined })).toEqual(['no-key', 'no-key:Groq', undefined]);
    expect(f).not.toHaveBeenCalled();
    const r = await fails(async () => reply('x', 401));
    expect(JSON.stringify(r)).not.toContain('gsk_test');
    expect(JSON.stringify(err.mock.calls)).not.toContain('gsk_test');
    expect(err).toHaveBeenCalledWith('Test: could not reach Groq', 401, '');
  });
});

describe('chatCloud retries', () => {
  const gone = () => apiError(404, { code: 'model_not_found', message: 'The model `m` does not exist' });
  const byModel = (models: Record<string, () => Response>, listed: string[]) =>
    vi.fn(async (url: string, init?: RequestInit) =>
      url.endsWith('/models')
        ? new Response(JSON.stringify({ data: listed.map((id) => ({ id })) }))
        : models[JSON.parse(String(init?.body)).model as string]!(),
    );

  it('reports a gone model the person picked', async () => {
    const f = byModel({ m: gone }, ['openai/gpt-oss-120b']);
    await expect(chatCloud(msgs, base({ fetch: f }))).rejects.toMatchObject({
      code: 'model-not-found',
      message: 'model-not-found:Groq:404',
    });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('re-picks once from the list when asked, and says which', async () => {
    const onRepick = vi.fn();
    const f = byModel({ m: gone, 'qwen/qwen3-32b': () => reply('healed') }, ['whisper-large-v3', 'qwen/qwen3-32b']);
    expect(
      await chatCloud(msgs, base({ fetch: f, modelGone: 'repick', preference: ['qwen/qwen3-32b'], onRepick })),
    ).toBe('healed');
    expect(onRepick).toHaveBeenCalledWith('qwen/qwen3-32b');
    const loop = byModel({ m: gone, x: gone }, ['x']);
    await expect(chatCloud(msgs, base({ fetch: loop, modelGone: 'repick' }))).rejects.toMatchObject({
      code: 'server',
      message: 'no-model:Groq:404',
    });
    expect(loop).toHaveBeenCalledTimes(3);
  });
  it('never re-picks the model that just failed', async () => {
    const f = byModel({ m: gone, other: () => reply('healed') }, ['m', 'other']);
    expect(await chatCloud(msgs, base({ fetch: f, modelGone: 'repick', preference: ['m', 'other'] }))).toBe('healed');
    const only = byModel({ m: gone }, ['m']);
    await expect(chatCloud(msgs, base({ fetch: only, modelGone: 'repick', fallback: 'm' }))).rejects.toMatchObject({
      message: 'no-model:Groq:404',
    });
    expect(only).toHaveBeenCalledTimes(2);
  });
  it('keeps a plain 404 an error without listing models', async () => {
    const f = vi.fn(async () => reply('x', 404));
    await expect(chatCloud(msgs, base({ fetch: f, modelGone: 'repick' }))).rejects.toMatchObject({ code: 'server' });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('asks once more without JSON mode when Groq could not write valid JSON', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(apiError(400, { code: 'json_validate_failed' }))
      .mockResolvedValue(reply('{"a":1}'));
    expect(await chatCloud(msgs, base({ fetch: f, json: true }))).toBe('{"a":1}');
    expect(sent(f, 1).body.response_format).toBeUndefined();
    const twice = vi.fn(async () => apiError(400, { code: 'json_validate_failed' }));
    await expect(chatCloud(msgs, base({ fetch: twice, json: true }))).rejects.toMatchObject({
      code: 'bad-reply',
      message: 'bad-json:Groq:400',
    });
    expect(twice).toHaveBeenCalledTimes(2);
  });
  it('drops a field the model does not take, and halves an oversized token budget once', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(apiError(400, { param: 'temperature', message: 'Unsupported value' }))
      .mockResolvedValue(reply('ok'));
    expect(await chatCloud(msgs, base({ fetch: f }))).toBe('ok');
    expect(sent(f, 1).body.temperature).toBeUndefined();
    const t = vi.fn().mockResolvedValueOnce(apiError(413, {})).mockResolvedValue(reply('ok'));
    expect(await chatCloud(msgs, base({ fetch: t, maxTokens: 4000 }))).toBe('ok');
    expect(sent(t, 1).body.max_tokens).toBe(2000);
  });
  it('uses the recommended model when none is given', async () => {
    const f = byModel({ 'openai/gpt-oss-120b': () => reply('ok') }, ['llama-3.1-8b-instant', 'openai/gpt-oss-120b']);
    expect(await chatCloud(msgs, base({ fetch: f, model: '' }))).toBe('ok');
  });
});

describe('chatLocal', () => {
  const lm = (
    prompt: (input: string, o?: { responseConstraint?: object }) => Promise<string>,
    availability = 'available' as const,
  ): LanguageModelLike => ({
    availability: async () => availability,
    create: async () => ({ prompt }),
  });
  it('answers, and asks again without a response constraint this Chrome does not take', async () => {
    const prompt = vi.fn().mockRejectedValueOnce(new Error('no constraint')).mockResolvedValue('{"a":1}');
    expect(await chatLocal(msgs, { text, json: true, languageModel: lm(prompt) })).toBe('{"a":1}');
    expect(prompt).toHaveBeenCalledTimes(2);
  });
  it('maps failures', async () => {
    const code = (p: Promise<string>) => p.catch((e: { code: string; message: string }) => [e.code, e.message]);
    expect(await code(chatLocal(msgs, { text }))).toEqual(['local-unavailable', 'local-unavailable:Built-in AI']);
    expect(await code(chatLocal([msgs[0]!], { text, languageModel: lm(async () => 'x') }))).toEqual([
      'bad-reply',
      'local-turn:Built-in AI',
    ]);
    expect(
      await code(
        chatLocal(msgs, {
          text,
          languageModel: lm(async () => {
            throw new Error('x');
          }),
        }),
      ),
    ).toEqual(['bad-reply', 'local-failed:Built-in AI']);
  });
});

describe('extractJson', () => {
  it('pulls the object out of prose or a fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('no json')).toBe('no json');
  });
});

describe('images', () => {
  const img = 'data:image/jpeg;base64,AAAA';
  const withImg = [{ role: 'user' as const, content: 'look', images: [img] }];
  it('OpenAI-compatible: text and image_url parts; plain messages unchanged', async () => {
    const f = vi.fn(async () => reply('ok'));
    await chatCloud([...msgs, ...withImg], base({ fetch: f }));
    expect(sent(f).body.messages).toEqual([
      ...msgs,
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image_url', image_url: { url: img } },
        ],
      },
    ]);
  });
  it('Anthropic: image blocks', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })));
    await chatCloud(withImg, base({ provider: 'anthropic', key: 'sk-ant-test', fetch: f }));
    expect(sent(f).body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
          { type: 'text', text: 'look' },
        ],
      },
    ]);
  });
  it('counts 1,000 tokens an image', () => {
    expect(estimateTokens(withImg)).toBe(1001);
  });
});
