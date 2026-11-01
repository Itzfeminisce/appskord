import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { saveKeys } from './penv';
import { chat, LLMError, pickProvider } from './llm';

const reply = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
const msgs = [{ role: 'user' as const, content: 'hi' }];

beforeEach(async () => {
  fakeBrowser.reset();
  await saveKeys({ GROQ_API_KEY: 'gsk_test' });
});

describe('chat', () => {
  it('posts an OpenAI-style request with the stored Groq key', async () => {
    const f = vi.fn(async () => reply('hello'));
    expect(await chat(msgs, { json: true, maxTokens: 300 }, f)).toBe('hello');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ temperature: 0.2, max_tokens: 300, response_format: { type: 'json_object' }, messages: msgs });
  });

  it('uses injected keys and the requested provider', async () => {
    const f = vi.fn(async () => reply('ok'));
    await chat(msgs, { keys: { OPENROUTER_API_KEY: 'sk-or-test' }, provider: 'openrouter' }, f);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(init.body as string).max_tokens).toBeUndefined();
  });

  it('maps failures to codes', async () => {
    const code = async (f: () => Promise<Response>) => chat(msgs, {}, f).catch((e: LLMError) => e.code);
    expect(await code(async () => reply('x', 401))).toBe('auth');
    expect(await code(async () => reply('x', 429))).toBe('rate-limited');
    expect(await code(async () => reply('x', 500))).toBe('server');
    expect(await code(async () => reply(42))).toBe('bad-reply');
    expect(await code(async () => { throw new Error('down'); })).toBe('offline');
    expect(await chat(msgs, { keys: {} }, async () => reply('x')).catch((e: LLMError) => e.code)).toBe('no-key');
  });
});

describe('chat errors and retired models', () => {
  it('keeps Klipkord\'s sentences', async () => {
    const message = async (f: () => Promise<Response>, keys?: Record<string, string>) => chat(msgs, { keys }, f).catch((e: LLMError) => e.message);
    expect(await message(async () => reply('x', 401))).toBe('The AI service did not accept the key.');
    expect(await message(async () => reply('x', 429))).toBe('The AI service is busy.');
    expect(await message(async () => reply('x', 500))).toBe('The AI service returned an error (500).');
    expect(await message(async () => reply(42))).toBe('The AI service sent an unexpected reply.');
    expect(await message(async () => { throw new Error('down'); })).toBe('Could not reach the AI service.');
    expect(await message(async () => reply('x'), {})).toBe('No cloud key is loaded.');
  });

  it('re-picks a listed Groq model once when the default is retired, and keeps it', async () => {
    const gone = () => new Response(JSON.stringify({ error: { code: 'model_not_found' } }), { status: 404 });
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }));
      return JSON.parse(String(init?.body)).model === 'llama-3.3-70b-versatile' ? gone() : reply('healed');
    });
    expect(await chat(msgs, {}, f)).toBe('healed');
    expect(await chat(msgs, {}, f)).toBe('healed');
    expect(f.mock.calls.filter(([u]) => u.endsWith('/models'))).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(4);
  });
});

describe('pickProvider', () => {
  it('takes the first provider with a key, or the requested one', () => {
    expect(pickProvider({ OPENAI_API_KEY: 'sk-test', GROQ_API_KEY: 'gsk_test' })?.id).toBe('groq');
    expect(pickProvider({ OPENAI_API_KEY: 'sk-test' })?.id).toBe('openai');
    expect(pickProvider({ OPENAI_API_KEY: 'sk-test' }, 'groq')).toBeUndefined();
  });
});
