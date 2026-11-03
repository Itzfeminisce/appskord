import { describe, expect, it, vi } from 'vitest';
import type { ErrorText } from './errors';
import { chatModels, listModels, listModelsFor, recommendedFor, recommendedModel, type ModelCache } from './models';

const text: ErrorText = (f) => `${f.reason}:${f.label}${f.status ? `:${f.status}` : ''}`;
const list = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });
const ids = (...names: string[]) => names.map((id) => ({ id }));

describe('chatModels', () => {
  it('Groq: active chat models only, sorted', () => {
    const data = [
      ...ids(
        'whisper-large-v3',
        'playai-tts',
        'meta-llama/llama-prompt-guard-2-86m',
        'groq/compound',
        'distil-whisper-large-v3-en',
        'qwen/qwen3-32b',
      ),
      { id: 'old', active: false },
      { id: 'a-model' },
    ];
    expect(chatModels('groq', data)).toEqual(['a-model', 'qwen/qwen3-32b']);
  });
  it('OpenAI: GPT and o-series chat models, not Responses-only, embeddings or images', () => {
    const data = ids(
      'gpt-6.1-sol',
      'o3',
      'chatgpt-latest',
      'o1-pro',
      'gpt-6-codex',
      'text-embedding-3-small',
      'dall-e-3',
      'gpt-6-realtime-preview',
      'davinci-002',
    );
    expect(chatModels('openai', data)).toEqual(['chatgpt-latest', 'gpt-6.1-sol', 'o3']);
  });
  it('Anthropic: Claude models in the order listed (newest first)', () => {
    expect(chatModels('anthropic', ids('claude-sonnet-5-5', 'claude-haiku-5-5', 'not-claude'))).toEqual([
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ]);
  });
  it('OpenRouter: text-out models only, by architecture', () => {
    const data = [
      { id: 'anthropic/claude-sonnet-5.5', architecture: { output_modalities: ['text'] } },
      { id: 'google/gemini-image', architecture: { output_modalities: ['text', 'image'] } },
      { id: 'x/voice', architecture: { output_modalities: ['audio'] } },
    ];
    expect(chatModels('openrouter', data)).toEqual(['anthropic/claude-sonnet-5.5']);
  });
  it('Ollama and junk: ids only, never throws', () => {
    expect(chatModels('ollama', ids('llama3', 'nomic-embed-text'))).toEqual(['llama3']);
    expect(chatModels('groq', undefined)).toEqual([]);
    expect(chatModels('groq', [{ id: 3 }, null, { id: '' }])).toEqual([]);
  });
});

describe('recommendedModel', () => {
  it('Groq: the first preferred model listed, else the first listed, else the fallback', () => {
    expect(recommendedModel('groq', ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'])).toBe('openai/gpt-oss-120b');
    expect(recommendedModel('groq', ['openai/gpt-oss-20b', 'qwen/qwen3-32b'], { preference: ['qwen/qwen3-32b'] })).toBe(
      'qwen/qwen3-32b',
    );
    expect(recommendedModel('groq', ['new/chat-model'])).toBe('new/chat-model');
    expect(recommendedModel('groq', [], { fallback: 'f' })).toBe('f');
    expect(recommendedModel('groq', [])).toBeUndefined();
  });
  it('OpenAI: gpt-6.1-sol when listed, else the newest plain GPT', () => {
    expect(recommendedModel('openai', ['gpt-6-luna', 'gpt-6.1-sol', 'o3'])).toBe('gpt-6.1-sol');
    expect(recommendedModel('openai', ['gpt-6', 'gpt-7', 'gpt-7-mini', 'o3'])).toBe('gpt-7');
  });
  it('Anthropic: claude-opus-5-5 when listed, else the first Sonnet', () => {
    expect(recommendedModel('anthropic', ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'])).toBe(
      'claude-opus-5-5',
    );
    expect(recommendedModel('anthropic', ['claude-haiku-5-5', 'claude-sonnet-5-5'])).toBe('claude-sonnet-5-5');
  });
  it('Gemini and xAI: the suggested model when listed', () => {
    expect(recommendedModel('google', ['gemini-3.5-flash-lite', 'gemini-3.8-flash'])).toBe('gemini-3.8-flash');
    expect(recommendedModel('xai', ['grok-x', 'grok-4.7'])).toBe('grok-4.7');
  });
  it('OpenRouter: the newest Claude Sonnet, else the newest GPT', () => {
    expect(
      recommendedModel('openrouter', ['anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-5.5', 'openai/gpt-6']),
    ).toBe('anthropic/claude-sonnet-5.5');
    expect(recommendedModel('openrouter', ['openai/gpt-6', 'openai/gpt-7'])).toBe('openai/gpt-7');
  });
  it('Ollama: the first listed', () => {
    expect(recommendedModel('ollama', ['llama3', 'qwen'])).toBe('llama3');
  });
});

describe('listModels', () => {
  it('asks each provider on its own URL with its own headers, recommended first', async () => {
    const f = vi.fn(async () => list(ids('openai/gpt-oss-20b', 'openai/gpt-oss-120b')));
    expect(await listModels({ provider: 'groq', key: 'gsk_test', text, fetch: f })).toEqual({
      models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
      recommended: 'openai/gpt-oss-120b',
    });
    await listModels({ provider: 'anthropic', key: 'sk-ant-test', text, fetch: f });
    await listModels({ provider: 'openrouter', key: 'sk-or-test', text, fetch: f });
    await listModels({ provider: 'openai', key: 'sk-test', text, fetch: f });
    await listModels({ provider: 'ollama', key: '', baseUrl: 'http://h:1/v1/', text, fetch: f });
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map((c) => c[0])).toEqual([
      'https://api.groq.com/openai/v1/models',
      'https://api.anthropic.com/v1/models?limit=1000',
      'https://openrouter.ai/api/v1/models',
      'https://api.openai.com/v1/models',
      'http://h:1/v1/models',
    ]);
    expect(calls[0]![1].headers).toEqual({ Authorization: 'Bearer gsk_test' });
    expect(calls[1]![1].headers).toMatchObject({ 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01' });
  });
  it("maps failures to codes with the app's sentence, never the key", async () => {
    const fails = async (f: () => Promise<Response>) =>
      listModels({ provider: 'openai', key: 'sk-test', text, fetch: f }).catch(
        (e: { code: string; message: string }) => [e.code, e.message],
      );
    expect(
      await fails(async () => {
        throw new TypeError('down');
      }),
    ).toEqual(['offline', 'offline:OpenAI']);
    expect(await fails(async () => new Response('{}', { status: 401 }))).toEqual(['auth', 'auth:OpenAI:401']);
    const scope = {
      error: { message: 'You have insufficient permissions for this operation. Missing scopes: api.model.read' },
    };
    expect(await fails(async () => new Response(JSON.stringify(scope), { status: 403 }))).toEqual([
      'no-list',
      'no-list:OpenAI:403',
    ]);
    expect(await fails(async () => new Response('{}', { status: 500 }))).toEqual(['server', 'status:OpenAI:500']);
    expect(await fails(async () => new Response('not json'))).toEqual(['server', 'unexpected-list:OpenAI']);
    const aborted = AbortSignal.abort();
    const res = await listModels({
      provider: 'groq',
      key: 'gsk_test',
      text,
      signal: aborted,
      fetch: async () => {
        throw new DOMException('x', 'AbortError');
      },
    }).catch((e: { code: string }) => e.code);
    expect(res).toBe('cancelled');
  });
});

describe('recommendedFor', () => {
  const memory = (): ModelCache & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return {
      map,
      get: async (p) => map.get(p),
      set: async (p, m) => void map.set(p, m),
      remove: async (p) => void map.delete(p),
    };
  };
  it('caches a listed pick, and gives the fallback without caching a failed list', async () => {
    const cache = memory();
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValue(list(ids('openai/gpt-oss-20b')));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const opts = { provider: 'groq' as const, key: 'gsk_test', text, fetch: f, cache, app: 'Test', fallback: 'fb' };
    expect(await recommendedFor({ ...opts, fresh: false })).toBe('fb');
    expect(err).toHaveBeenCalledWith('Test: could not list Groq models', 'status:Groq:500');
    expect(await recommendedFor({ ...opts, fresh: false })).toBe('openai/gpt-oss-20b');
    expect(await recommendedFor({ ...opts, fresh: false })).toBe('openai/gpt-oss-20b');
    expect(f).toHaveBeenCalledTimes(2);
    expect(cache.map.get('groq')).toBe('openai/gpt-oss-20b');
    err.mockRestore();
  });
});

import { canSeeImages } from './models';
describe('canSeeImages', () => {
  it('knows vision models', () => {
    for (const m of [
      'llama-4-scout',
      'gpt-6-luna',
      'gpt-6.1-sol',
      'claude-sonnet-5-5',
      'gemini-3.8',
      'grok-4.7',
      'pixtral-12b',
      'qwen2.5-vl-7b',
      'x-vision',
    ])
      expect(canSeeImages('groq', m)).toBe(true);
    for (const m of ['llama-3.3-70b', 'gpt-3.5-turbo', 'openai/gpt-oss-120b'])
      expect(canSeeImages('groq', m)).toBe(false);
  });
});

describe('Gemini and xAI lists', () => {
  const ok = (data: unknown) => vi.fn(async () => list(data));
  it('Gemini: drops the models/ prefix, keeps gemini chat models, requests the right URL and key', async () => {
    const f = ok(
      ids(
        'models/gemini-4-argon',
        'models/gemini-3.8-flash',
        'models/text-embedding-004',
        'models/gemini-3.5-flash-lite',
      ),
    );
    const r = await listModelsFor('google', 'chat', { key: 'AIza-test', fetch: f });
    expect(r.models).toEqual([
      { id: 'gemini-3.8-flash', tag: 'Recommended' },
      { id: 'gemini-3.5-flash-lite', tag: 'Fastest' },
      { id: 'gemini-4-argon', tag: 'Sees images' },
    ]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models');
    expect(init.headers).toEqual({ Authorization: 'Bearer AIza-test' });
  });
  it('xAI: grok-4.7 recommended, no Fastest tag; no speech kind', async () => {
    const f = ok(ids('grok-4.7'));
    const r = await listModelsFor('xai', 'chat', { key: 'xai-test', fetch: f });
    expect(r.models).toEqual([{ id: 'grok-4.7', tag: 'Recommended' }]);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://api.x.ai/v1/models');
    expect(await listModelsFor('xai', 'speech', { key: 'xai-test', fetch: f })).toEqual({
      models: [],
      source: 'suggested',
    });
    expect(await listModelsFor('google', 'speech', { key: 'AIza-test', fetch: f })).toEqual({
      models: [],
      source: 'suggested',
    });
  });
  it('suggested lists without a key', async () => {
    expect((await listModelsFor('google', 'chat')).models.map((m) => m.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-4-argon',
      'gemini-3.5-flash-lite',
    ]);
    expect((await listModelsFor('xai', 'chat')).models).toEqual([{ id: 'grok-4.7', tag: 'Recommended' }]);
  });
});

describe('listModelsFor', () => {
  const ok = (data: unknown) => vi.fn(async () => list(data));
  it('Groq chat: live, filtered, recommended first, tags', async () => {
    const f = ok(ids('whisper-large-v3', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b'));
    const r = await listModelsFor('groq', 'chat', {
      key: 'gsk_test',
      fetch: f,
    });
    expect(r.source).toBe('live');
    expect(r.models[0]).toEqual({
      id: 'openai/gpt-oss-120b',
      tag: 'Recommended',
    });
    expect(r.models).toContainEqual({
      id: 'openai/gpt-oss-20b',
      tag: 'Fastest',
    });
    expect(r.models).toContainEqual({
      id: 'meta-llama/llama-4-scout-17b',
      tag: 'Sees images',
    });
    expect(r.models.map((m) => m.id)).not.toContain('whisper-large-v3');
  });
  it('Groq speech: whisper only', async () => {
    const f = ok(ids('whisper-large-v3-turbo', 'openai/gpt-oss-120b', 'whisper-large-v3'));
    const r = await listModelsFor('groq', 'speech', {
      key: 'gsk_test',
      fetch: f,
    });
    expect(r.models.map((m) => m.id)).toEqual(['whisper-large-v3-turbo', 'whisper-large-v3']);
    expect(r.models[0]?.tag).toBe('Recommended');
  });
  it('OpenAI speech: gpt-transcribe only; chat marks -luna Fastest', async () => {
    const data = ids('whisper-1', 'gpt-transcribe', 'gpt-4o-transcribe', 'gpt-6.1-sol', 'gpt-6-luna', 'tts-1');
    const s = await listModelsFor('openai', 'speech', {
      key: 'sk-test',
      fetch: ok(data),
    });
    expect(s.models.map((m) => m.id).sort()).toEqual(['gpt-transcribe']);
    const c = await listModelsFor('openai', 'chat', {
      key: 'sk-test',
      fetch: ok(data),
    });
    expect(c.models).toContainEqual({ id: 'gpt-6-luna', tag: 'Fastest' });
  });
  it('Anthropic and OpenRouter have no speech list', async () => {
    const f = vi.fn();
    for (const p of ['anthropic', 'openrouter'] as const)
      expect(await listModelsFor(p, 'speech', { key: 'sk-test', fetch: f })).toEqual({
        models: [],
        source: 'suggested',
      });
    expect(f).not.toHaveBeenCalled();
  });
  it('no key: suggested without fetching; first is Recommended', async () => {
    const f = vi.fn();
    const r = await listModelsFor('openai', 'chat', { fetch: f });
    expect(f).not.toHaveBeenCalled();
    expect(r.source).toBe('suggested');
    expect(r.models[0]).toEqual({ id: 'gpt-6.1-sol', tag: 'Recommended' });
  });
  it('failures fall back to suggested with a coded error and no key in the message', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [async () => new Response('{}', { status: 401 }), 'auth'],
      [async () => new Response('{}', { status: 429 }), 'rate-limited'],
      [async () => new Response('{}', { status: 500 }), 'server'],
      [async () => Promise.reject(new TypeError('failed gsk_test')), 'offline'],
    ];
    for (const [fn, code] of cases) {
      const r = await listModelsFor('groq', 'chat', {
        key: 'gsk_test',
        fetch: vi.fn(fn),
      });
      expect(r.source).toBe('suggested');
      expect(r.error?.code).toBe(code);
      expect(r.error?.message).not.toContain('gsk_test');
      expect(r.models.length).toBeGreaterThan(0);
    }
  });
});
