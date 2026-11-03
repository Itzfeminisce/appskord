import { describe, expect, it, vi } from 'vitest';
import { availableEngines, builtinAvailable, engineOrder, ollamaModel } from './engines';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ollamaUp = vi.fn(async (url: string, _init?: RequestInit) => (url.endsWith('/api/tags') ? json({ models: [{ name: 'llama3.2' }] }) : json({ message: { content: '{}' } })));
const down = vi.fn(async () => { throw new TypeError('offline'); });
const builtin = (availability: string) => ({ LanguageModel: { availability: async () => availability } });
const ids = async (o: Parameters<typeof availableEngines>[0]) => (await availableEngines(o)).map((e) => e.id);

describe('engineOrder', () => {
  it('puts the pick first, then built-in, Ollama and the cloud providers', () => {
    expect(engineOrder('builtin')).toEqual(['builtin', 'ollama', 'groq', 'openai', 'anthropic', 'openrouter', 'google', 'xai']);
    expect(engineOrder('openai')).toEqual(['openai', 'builtin', 'ollama', 'groq', 'anthropic', 'openrouter', 'google', 'xai']);
  });
});

describe('availableEngines', () => {
  const base = { settings: { notes: { provider: 'builtin' as const, model: 'builtin' } }, keys: {}, globalObject: {} };

  it('uses built-in AI when Chrome has it', async () => {
    expect(await ids({ ...base, fetchFn: down, globalObject: builtin('available') })).toEqual(['builtin']);
  });
  it('falls back to Ollama when built-in AI is missing and Ollama answers', async () => {
    expect(await ids({ ...base, fetchFn: ollamaUp })).toEqual(['ollama']);
  });
  it('falls back to Groq only with a key', async () => {
    expect(await ids({ ...base, fetchFn: down, keys: { GROQ_API_KEY: 'gsk_test' } })).toEqual(['groq']);
    expect(await ids({ ...base, fetchFn: down })).toEqual([]);
  });
  it('lists every engine that works, in order', async () => {
    expect(await ids({ ...base, fetchFn: ollamaUp, keys: { GROQ_API_KEY: 'gsk_test' }, globalObject: builtin('available') })).toEqual(['builtin', 'ollama', 'groq']);
  });
  it('treats a model that still needs a download as unavailable', async () => {
    expect(await builtinAvailable(builtin('downloadable'))).toBe(false);
    expect(await builtinAvailable({})).toBe(false);
  });
});

describe('engines', () => {
  it('asks Ollama for JSON with the first model it has', async () => {
    expect(await ollamaModel(ollamaUp)).toBe('llama3.2');
    expect(await ollamaModel(async () => json({ models: [] }))).toBeNull();
    const [engine] = await availableEngines({ settings: { notes: { provider: 'ollama', model: '' } }, keys: {}, fetchFn: ollamaUp, globalObject: {} });
    expect(await engine!.complete('s', 'u', { json: true })).toBe('{}');
    const call = ollamaUp.mock.calls.find(([u]) => u.endsWith("/api/chat"))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({ model: 'llama3.2', format: 'json', stream: false });
  });
  it('calls Groq with the key and no key in the result', async () => {
    const f = vi.fn(async (u: string) => (u.includes('11434') ? json({}, 500) : json({ choices: [{ message: { content: 'ok' } }] })));
    const [engine] = await availableEngines({ settings: { notes: { provider: 'groq', model: 'openai/gpt-oss-120b' } }, keys: { GROQ_API_KEY: 'gsk_test' }, fetchFn: f, globalObject: {} });
    expect(await engine!.complete('s', 'u')).toBe('ok');
    expect(f.mock.calls.at(-1)![0]).toBe('https://api.groq.com/openai/v1/chat/completions');
  });
  it('uses the picked Ollama model when Ollama has it', async () => {
    const f = vi.fn(async (url: string, _init?: RequestInit) => (url.endsWith('/api/tags') ? json({ models: [{ name: 'llama3.2' }, { name: 'qwen3' }] }) : json({ message: { content: 'ok' } })));
    const [engine] = await availableEngines({ settings: { notes: { provider: 'ollama', model: 'qwen3' } }, keys: {}, fetchFn: f, globalObject: {} });
    await engine!.complete('s', 'u');
    expect(JSON.parse((f.mock.calls.find(([u]) => u.endsWith('/api/chat'))![1] as RequestInit).body as string).model).toBe('qwen3');
  });
});

describe('each cloud provider', () => {
  const cases = [
    ['groq', 'GROQ_API_KEY', 'gsk_fake', 'openai/gpt-oss-20b', 'https://api.groq.com/openai/v1/chat/completions'],
    ['openai', 'OPENAI_API_KEY', 'sk-fake', 'gpt-6.1-sol', 'https://api.openai.com/v1/chat/completions'],
    ['anthropic', 'ANTHROPIC_API_KEY', 'sk-ant-fake', 'claude-opus-5-5', 'https://api.anthropic.com/v1/chat/completions'],
    ['openrouter', 'OPENROUTER_API_KEY', 'sk-or-fake', 'openai/gpt-oss-120b', 'https://openrouter.ai/api/v1/chat/completions'],
    ['google', 'GEMINI_API_KEY', 'AIza-fake', 'gemini-3.8-flash', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
    ['xai', 'XAI_API_KEY', 'xai-fake', 'grok-4.7', 'https://api.x.ai/v1/chat/completions'],
  ] as const;
  it.each(cases)('%s reaches its URL with its key and the picked model', async (provider, keyName, key, model, url) => {
    const f = vi.fn(async (u: string, _init?: RequestInit) => (u.includes('11434') ? json({}, 500) : json({ choices: [{ message: { content: 'ok' } }] })));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [engine] = await availableEngines({ settings: { notes: { provider, model } }, keys: { [keyName]: key }, fetchFn: f, globalObject: {} });
    expect(engine!.id).toBe(provider);
    expect(await engine!.complete('s', 'u')).toBe('ok');
    const [u, init] = f.mock.calls.at(-1)!;
    expect(u).toBe(url);
    expect(JSON.stringify((init as RequestInit).headers)).toContain(key);
    expect(JSON.parse((init as RequestInit).body as string).model).toBe(model);
    expect(JSON.stringify(log.mock.calls)).not.toContain(key);
    log.mockRestore();
  });

  it('a gone picked model moves to a listed one and is reported for picker-model-gone, without the key in logs', async () => {
    const f = vi.fn(async (u: string, init?: RequestInit) => {
      if (u.endsWith('/models')) return json({ data: [{ id: 'openai/gpt-oss-120b' }] });
      if (u.includes('11434')) return json({}, 500);
      return JSON.parse(String(init?.body)).model === 'llama-3.3-70b-versatile' ? json({ error: { code: 'model_not_found' } }, 404) : json({ choices: [{ message: { content: 'ok' } }] });
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onModelGone = vi.fn();
    const [engine] = await availableEngines({ settings: { notes: { provider: 'groq', model: 'llama-3.3-70b-versatile' } }, keys: { GROQ_API_KEY: 'gsk_fake' }, fetchFn: f, globalObject: {}, onModelGone });
    expect(await engine!.complete('s', 'u')).toBe('ok');
    expect(onModelGone).toHaveBeenCalledWith({ provider: 'groq', model: 'openai/gpt-oss-120b', gone: 'llama-3.3-70b-versatile' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('gsk_fake');
    log.mockRestore();
  });
});
