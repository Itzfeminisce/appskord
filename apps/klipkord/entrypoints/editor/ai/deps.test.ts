import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '@/lib/llm';
import { callWith, header, setAiDeps, setup, shortModel } from './deps';

describe('Ask AI header', () => {
  it('names the provider from @appskord/llm and the short model, never the id', () => {
    expect(shortModel('gpt-6-luna')).toBe('GPT-6 Luna');
    expect(shortModel('claude-haiku-5-5')).toBe('Claude Haiku 5.5');
    expect(shortModel('openai/gpt-oss-120b')).toBe('GPT-oss');
    expect(header(PROVIDERS.anthropic)).toBe('Anthropic · Claude Haiku 5.5');
  });
});

describe('Ask AI setup', () => {
  const base = { fetch: async () => new Response('{}'), online: () => true, watchOnline: () => () => {} };
  afterEach(() => setAiDeps(null));

  it('uses the Notes and Ask pick when its key is loaded, else the first provider with a key', async () => {
    const keys = { GROQ_API_KEY: 'gsk_fake', ANTHROPIC_API_KEY: 'sk-ant-fake' };
    setAiDeps({ ...base, keys: async () => keys, notes: async () => ({ provider: 'anthropic', model: 'claude-sonnet-5-5' }) });
    const s = await setup();
    expect(s?.provider).toMatchObject({ id: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(header(s!.provider)).toBe('Anthropic · Claude Sonnet 5.5');
    setAiDeps({ ...base, keys: async () => keys, notes: async () => ({ provider: 'openai', model: 'gpt-6.1-sol' }) });
    expect((await setup())?.provider.id).toBe('groq');
    setAiDeps({ ...base, keys: async () => keys, notes: async () => ({ provider: 'builtin', model: 'builtin' }) });
    expect((await setup())?.provider.id).toBe('groq');
  });

  it('calls the picked provider with its model', async () => {
    const fetchFn = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
    setAiDeps({ ...base, fetch: fetchFn, keys: async () => ({ OPENAI_API_KEY: 'sk-fake' }), notes: async () => ({ provider: 'openai', model: 'gpt-6-astra' }) });
    await callWith((await setup())!)([{ role: 'user', content: 'hi' }], { maxTokens: 10 });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(init!.body as string).model).toBe('gpt-6-astra');
  });
});
