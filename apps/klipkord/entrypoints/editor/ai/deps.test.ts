import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '@/lib/llm';
import { callWith, header, setAiDeps, setup, shortModel, speechSetup } from './deps';

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

  it('uses the Notes and Ask pick with its key, and never another provider that has one', async () => {
    const keys = { GROQ_API_KEY: 'gsk_fake', ANTHROPIC_API_KEY: 'sk-ant-fake' };
    setAiDeps({ ...base, keys: async () => keys, notes: async () => ({ provider: 'anthropic', model: 'claude-sonnet-5-5' }) });
    const s = await setup();
    expect(s?.provider).toMatchObject({ id: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(header(s!.provider)).toBe('Anthropic · Claude Sonnet 5.5');
    setAiDeps({ ...base, keys: async () => keys, notes: async () => ({ provider: 'openai', model: 'gpt-6.1-sol' }) });
    expect(await setup()).toBeNull();
  });

  it('a local pick uses only engines on this computer, never a cloud key', async () => {
    const keys = { GROQ_API_KEY: 'gsk_fake' };
    const fetchFn = vi.fn(async (u: string, _i?: RequestInit) => (u.endsWith('/api/tags') ? new Response(JSON.stringify({ models: [{ name: 'qwen3' }] })) : new Response(JSON.stringify({ message: { content: '{"ok":1}' } }))));
    setAiDeps({ ...base, fetch: fetchFn, keys: async () => keys, notes: async () => ({ provider: 'builtin', model: 'builtin' }), globalObject: {} });
    const s = await setup();
    expect(s?.provider).toEqual({ id: 'ollama', model: 'qwen3' });
    expect(header(s!.provider)).toBe('Ollama · qwen3 · on this computer');
    expect(await callWith(s!)([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }], { maxTokens: 10 })).toBe('{"ok":1}');
    expect(fetchFn.mock.calls.every(([u]) => u.startsWith('http://localhost:11434'))).toBe(true);
    setAiDeps({ ...base, fetch: async () => { throw new TypeError('offline'); }, keys: async () => keys, notes: async () => ({ provider: 'ollama', model: '' }), globalObject: {} });
    expect(await setup()).toBeNull();
  });

  it('the mic uses the Transcripts pick: a cloud provider with a key, or Whisper here once downloaded, else none', async () => {
    const keys = { OPENAI_API_KEY: 'sk-fake', GROQ_API_KEY: 'gsk_fake' };
    const notes = async () => ({ provider: 'builtin' as const, model: 'builtin' });
    setAiDeps({ ...base, keys: async () => keys, notes, transcripts: async () => ({ provider: 'openai', model: 'gpt-transcribe' }) });
    expect(await speechSetup()).toEqual({ provider: 'openai', model: 'gpt-transcribe', key: 'sk-fake' });
    setAiDeps({ ...base, keys: async () => keys, notes, transcripts: async () => ({ provider: 'local', model: 'whisper' }) });
    expect(await speechSetup()).toBeNull();
    setAiDeps({ ...base, keys: async () => keys, notes, transcripts: async () => ({ provider: 'local', model: 'whisper' }), whisperReady: async () => false });
    expect(await speechSetup()).toBeNull();
    setAiDeps({ ...base, keys: async () => keys, notes, transcripts: async () => ({ provider: 'local', model: 'whisper' }), whisperReady: async () => true });
    expect(await speechSetup()).toEqual({ provider: 'local', model: 'onnx-community/whisper-tiny' });
    setAiDeps({ ...base, keys: async () => ({ OPENAI_API_KEY: 'sk-fake' }), notes, transcripts: async () => ({ provider: 'groq', model: 'whisper-large-v3-turbo' }) });
    expect(await speechSetup()).toBeNull();
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
