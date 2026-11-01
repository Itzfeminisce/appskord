import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, chatModels, checkModel, extractJson, FALLBACK_MODEL, listModels, recommendedModel, type FetchLike, type LLMError } from './llm';
import { SUGGESTED_MODELS } from './providers';
import { updateSettings } from './settings';

beforeEach(() => { fakeBrowser.reset(); });

const m = [{ role: 'system' as const, content: 'Be brief.' }, { role: 'user' as const, content: 'hi' }];
const code = async (p: Promise<unknown>) => p.then(() => 'resolved', (e: LLMError) => e.code);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const openaiOk = (content: string) => json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
const anthropicOk = (text: string, stop = 'end_turn') => json({ content: [{ type: 'text', text }], stop_reason: stop });

/** Answers model lists from `lists` and chat calls from `replies` in turn; records every call. */
function fake(lists: Record<string, unknown>, ...replies: Response[]) {
  const calls: { url: string; init?: RequestInit; body?: Record<string, unknown> }[] = [];
  const fetch: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const list = Object.entries(lists).find(([u]) => url === u);
    if (list) return json({ data: list[1] });
    return replies.shift()!;
  });
  return { fetch, calls, chats: () => calls.filter((c) => c.init?.method === 'POST') };
}
const OPENAI_MODELS = 'https://api.openai.com/v1/models';
const ANTHROPIC_MODELS = 'https://api.anthropic.com/v1/models?limit=1000';
const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';

describe('model lists', () => {
  it('keeps only chat models', () => {
    const data = ['gpt-4.1', 'text-embedding-3-large', 'whisper-1', 'tts-1', 'gpt-image-1', 'omni-moderation-latest', 'dall-e-3', 'gpt-4o-realtime-preview', 'o3-pro', 'gpt-4o'].map((id) => ({ id }));
    expect(chatModels('openai', data)).toEqual(['gpt-4.1', 'gpt-4o']);
    expect(chatModels('groq', [{ id: 'llama-3.3-70b-versatile' }, { id: 'llama-guard-4-12b' }, { id: 'whisper-large-v3' }, { id: 'old', active: false }])).toEqual(['llama-3.3-70b-versatile']);
    expect(chatModels('openrouter', [{ id: 'a/text', architecture: { output_modalities: ['text'] } }, { id: 'b/pic', architecture: { output_modalities: ['image', 'text'] } }])).toEqual(['a/text']);
    expect(chatModels('anthropic', [{ id: 'claude-sonnet-4-5' }, { id: 'claude-haiku-4-5' }, { id: 'x' }])).toEqual(['claude-sonnet-4-5', 'claude-haiku-4-5']);
  });

  it('recommends a strong default per provider', () => {
    expect(recommendedModel('groq', ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'])).toBe('llama-3.3-70b-versatile');
    expect(recommendedModel('openai', ['gpt-4.1', 'gpt-4.1-mini', 'gpt-5', 'gpt-5-mini', 'gpt-4o', 'o3'])).toBe('gpt-5');
    expect(recommendedModel('anthropic', ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-3-7-sonnet-latest'])).toBe('claude-sonnet-4-5');
    expect(recommendedModel('openrouter', ['openai/gpt-4o', 'anthropic/claude-sonnet-4', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-3.7-sonnet'])).toBe('anthropic/claude-sonnet-4.5');
    expect(recommendedModel('openrouter', ['meta/llama', 'openai/gpt-4.1', 'openai/gpt-5'])).toBe('openai/gpt-5');
    expect(recommendedModel('anthropic', [])).toBe('claude-sonnet-4-5');
  });

  it('lists recommended first, with each provider’s headers', async () => {
    const { fetch, calls } = fake({ [ANTHROPIC_MODELS]: [{ id: 'claude-haiku-4-5' }, { id: 'claude-sonnet-4-5' }] });
    expect(await listModels('anthropic', 'sk-ant-test', fetch)).toEqual({ models: ['claude-sonnet-4-5', 'claude-haiku-4-5'], recommended: 'claude-sonnet-4-5' });
    expect(calls[0]!.init?.headers).toMatchObject({ 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    expect(calls[0]!.init?.credentials).toBe('omit');
  });

  it('maps list failures', async () => {
    expect(await code(listModels('openai', 'sk-test', async () => new Response('{}', { status: 401 })))).toBe('auth');
    expect(await code(listModels('openai', 'sk-test', async () => new Response('{}', { status: 500 })))).toBe('server');
    expect(await code(listModels('openai', 'sk-test', async () => { throw new TypeError('Failed to fetch'); }))).toBe('offline');
  });

  // X's bug: a working OpenAI key without the models scope made Settings say "Couldn't load OpenAI's models".
  it('says no-list, not auth, when a key that can chat may not list models', async () => {
    const scope = (status: number) => async () => json({ error: { message: 'You have insufficient permissions for this operation. Missing scopes: api.model.read.', type: 'invalid_request_error' } }, status);
    expect(await code(listModels('openai', 'sk-proj-test', scope(401)))).toBe('no-list');
    expect(await code(listModels('openai', 'sk-proj-test', scope(403)))).toBe('no-list');
    expect(await code(listModels('openai', 'sk-test', async () => json({ error: { message: 'Incorrect API key provided.', code: 'invalid_api_key' } }, 401)))).toBe('auth');
  });

  it('still chats on the fallback model when the list is not allowed', async () => {
    await updateSettings({ provider: 'openai' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetch: FetchLike = vi.fn(async (url: string) => url === OPENAI_MODELS
      ? json({ error: { message: 'Missing scopes: api.model.read.' } }, 401) : openaiOk('ok'));
    expect((await chat(m, { ai: 'cloud', key: 'sk-proj-test', fetch })).text).toBe('ok');
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('keeps a built-in suggested list per provider, and falls back to its first model', () => {
    for (const [p, s] of Object.entries(SUGGESTED_MODELS)) {
      expect(s.models.length).toBeGreaterThanOrEqual(2);
      expect(s.models.length).toBeLessThanOrEqual(3);
      expect(s.models).toContain(s.faster);
      expect(FALLBACK_MODEL[p as keyof typeof FALLBACK_MODEL]).toBe(s.models[0]);
    }
    expect(SUGGESTED_MODELS.openai.models).toEqual(['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o']);
  });
});

describe('Check model', () => {
  it('sends one tiny request to that model with the key and times it', async () => {
    const { fetch, calls } = fake({}, openaiOk('OK'));
    let t = 1000;
    expect(await checkModel('openai', 'gpt-4o-2024-11-20', 'sk-test', fetch, () => (t += 1400) - 1400)).toBe(1400);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0]!.body).toMatchObject({ model: 'gpt-4o-2024-11-20', max_completion_tokens: 16 });
    expect(calls[0]!.init?.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
  });

  it('reports a missing model, a model that can’t write and a refused key', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gone = json({ error: { message: 'The model `gpt-4o-maxi` does not exist or you do not have access to it.', code: 'model_not_found' } }, 404);
    expect(await code(checkModel('openai', 'gpt-4o-maxi', 'sk-test', fake({}, gone).fetch))).toBe('model-not-found');
    const none = fake({});
    expect(await code(checkModel('openai', 'whisper-1', 'sk-test', none.fetch))).toBe('not-for-text');
    expect(none.calls).toHaveLength(0);
    expect(await code(checkModel('groq', 'llama-3.3-70b-versatile', 'gsk_test', fake({}, json({ error: { message: 'Invalid API Key' } }, 401)).fetch))).toBe('auth');
    err.mockRestore();
  });
});

describe('OpenAI-compatible providers', () => {
  it('sends OpenAI the recommended model with max_completion_tokens and no temperature for a reasoning model', async () => {
    const { fetch, chats } = fake({ [OPENAI_MODELS]: [{ id: 'gpt-5' }, { id: 'gpt-4.1' }] }, openaiOk('{"a":1}'));
    const reply = await chat(m, { ai: 'cloud', provider: 'openai', key: 'sk-test', fetch, json: true, maxTokens: 1000 });
    expect(reply).toEqual({ text: '{"a":1}', by: 'openai' });
    const c = chats()[0]!;
    expect(c.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(c.init?.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
    expect(c.body).toMatchObject({ model: 'gpt-5', max_completion_tokens: 5000, response_format: { type: 'json_object' }, reasoning_effort: 'low' });
    expect(c.body).not.toHaveProperty('temperature');
    expect(c.body).not.toHaveProperty('max_tokens');
  });

  it('uses the person’s pick on OpenRouter and drops a parameter the model refuses', async () => {
    await updateSettings({ ai: 'cloud', provider: 'openrouter', models: { openrouter: 'meta/llama-big' } });
    const refused = json({ error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", param: 'temperature' } }, 400);
    const { fetch, chats } = fake({}, refused, openaiOk('ok'));
    expect(await chat(m, { key: 'sk-or-test', fetch })).toEqual({ text: 'ok', by: 'openrouter' });
    expect(chats().map((c) => c.url)).toEqual(['https://openrouter.ai/api/v1/chat/completions', 'https://openrouter.ai/api/v1/chat/completions']);
    expect(chats()[0]!.body).toMatchObject({ model: 'meta/llama-big', temperature: 0.2 });
    expect(chats()[1]!.body).not.toHaveProperty('temperature');
  });

  it('says model-not-found when the person’s pick is gone, without switching model', async () => {
    await updateSettings({ provider: 'openrouter', models: { openrouter: 'gone/model' } });
    const gone = json({ error: { message: 'gone/model is not a valid model ID', code: 404 } }, 404);
    const { fetch, chats } = fake({ [OPENROUTER_MODELS]: [{ id: 'anthropic/claude-sonnet-4.5' }] }, gone, openaiOk('ok'));
    expect(await code(chat(m, { ai: 'cloud', key: 'sk-or-test', fetch }))).toBe('model-not-found');
    expect(chats()).toHaveLength(1);
  });

  it('re-picks once from the list when there is no pick and the guess is gone', async () => {
    await updateSettings({ provider: 'openai' });
    const gone = json({ error: { message: 'The model `gpt-9` does not exist', code: 'model_not_found' } }, 404);
    const { fetch, chats } = fake({ [OPENAI_MODELS]: [{ id: 'gpt-4.1' }] }, gone, openaiOk('ok'));
    expect((await chat(m, { ai: 'cloud', key: 'sk-test', fetch })).text).toBe('ok');
    expect(chats()[1]!.body!.model).toBe('gpt-4.1');
  });

  it('says not-for-text for a model that is not a chat model', async () => {
    const notChat = json({ error: { message: 'This is not a chat model and thus not supported in the v1/chat/completions endpoint.' } }, 404);
    expect(await code(chat(m, { ai: 'cloud', provider: 'openai', model: 'gpt-x-audio', key: 'sk-test', fetch: fake({}, notChat).fetch }))).toBe('not-for-text');
  });

  it('says who has no key', async () => {
    await updateSettings({ provider: 'openai' });
    expect(await code(chat(m, { ai: 'cloud', fetch: fake({}).fetch }))).toBe('no-key');
  });
});

describe('Anthropic', () => {
  const run = (fetch: FetchLike, extra = {}) => chat(m, { ai: 'cloud', provider: 'anthropic', model: 'claude-sonnet-4-5', key: 'sk-ant-test', fetch, ...extra });

  it('posts to the Messages API with the system prompt as `system` and pulls out the JSON', async () => {
    const { fetch, chats } = fake({}, anthropicOk('Here it is:\n```json\n{"type":"quote"}\n```'));
    expect(await run(fetch, { json: true, maxTokens: 900 })).toEqual({ text: '{"type":"quote"}', by: 'anthropic' });
    const c = chats()[0]!;
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    expect(c.init?.headers).toMatchObject({ 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    expect(c.init?.headers).not.toHaveProperty('Authorization');
    expect(c.body).toMatchObject({ model: 'claude-sonnet-4-5', max_tokens: 900, messages: [{ role: 'user', content: 'hi' }] });
    expect(String(c.body!.system)).toMatch(/^Be brief\.\n\nReply with one JSON object only/);
    expect(c.body).not.toHaveProperty('response_format');
  });

  it('maps Anthropic failures', async () => {
    const err = (status: number, type: string) => async () => json({ type: 'error', error: { type, message: 'x' } }, status);
    expect(await code(run(err(401, 'authentication_error')))).toBe('auth');
    expect(await code(run(err(403, 'permission_error')))).toBe('auth');
    expect(await code(run(err(429, 'rate_limit_error')))).toBe('rate-limited');
    expect(await code(run(err(529, 'overloaded_error')))).toBe('server');
    expect(await code(run(err(500, 'api_error')))).toBe('server');
    expect(await code(run(err(400, 'invalid_request_error')))).toBe('bad-reply');
    expect(await code(run(async () => anthropicOk('{"a":', 'max_tokens'), { json: true }))).toBe('bad-reply');
  });

  it('says model-not-found for a retired model the person picked', async () => {
    const gone = json({ type: 'error', error: { type: 'not_found_error', message: 'model: claude-old' } }, 404);
    const { fetch } = fake({ [ANTHROPIC_MODELS]: [{ id: 'claude-sonnet-4-5' }] }, gone);
    expect(await code(run(fetch, { model: 'claude-old' }))).toBe('model-not-found');
  });

  it('extracts an object from prose', () => {
    expect(extractJson('Sure! {"a":{"b":1}} Done.')).toBe('{"a":{"b":1}}');
    expect(extractJson('no object')).toBe('no object');
  });
});
