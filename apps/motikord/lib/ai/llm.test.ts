import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, GROQ_MODEL_PREFERENCE, GROQ_MODELS_URL, GROQ_URL, LLMError, type FetchLike, type LanguageModelLike } from '../llm';

// The model is chosen once per session; a cached id keeps these tests to their own requests.
beforeEach(() => fakeBrowser.storage.session.set({ groqModel: 'openai/gpt-oss-120b' }));

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
    expect(body.model).toBe('openai/gpt-oss-120b'); // the cached choice
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

const groqErr = (st: number, error: Record<string, string>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error }), { status: st, headers });
/** Answers with each response in turn and records the request bodies. */
function seq(...responses: Response[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetch: FetchLike = vi.fn(async (u: string, init?: RequestInit) => { if (u === GROQ_MODELS_URL) return new Response('{"data":[]}', { status: 200 }); bodies.push(JSON.parse(String(init?.body))); return responses.shift()!; });
  return { fetch, bodies };
}
const okRes = (content: string, finish = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { status: 200 });

describe('Groq error bodies', () => {
  const m = [{ role: 'user' as const, content: 'JSON please' }];
  const run = (fetch: FetchLike, maxTokens = 3000) => chat(m, { ai: 'cloud', key: KEY, fetch, json: true, maxTokens });

  it('retries json_validate_failed once without JSON mode and returns that text', async () => {
    const { fetch, bodies } = seq(groqErr(400, { message: 'Failed to generate JSON', type: 'invalid_request_error', code: 'json_validate_failed' }), okRes('Here: {"a":1}'));
    expect((await run(fetch)).text).toBe('Here: {"a":1}');
    expect(bodies[0]!.response_format).toEqual({ type: 'json_object' });
    expect(bodies[1]!.response_format).toBeUndefined();
  });

  it('maps a second json_validate_failed, a cut-off reply and other 400s to bad-reply', async () => {
    const jv = () => groqErr(400, { message: 'x', type: 'invalid_request_error', code: 'json_validate_failed' });
    expect(await code(run(seq(jv(), jv()).fetch))).toBe('bad-reply');
    expect(await code(run(seq(okRes('{"a":', 'length')).fetch))).toBe('bad-reply');
    expect(await code(run(seq(groqErr(400, { message: 'bad field', type: 'invalid_request_error' })).fetch))).toBe('bad-reply');
  });

  it('shrinks max_tokens once on a request too large for the TPM limit, then says busy', async () => {
    const big = () => groqErr(413, { message: 'Request too large for model on tokens per minute (TPM): Limit 12000', type: 'tokens', code: 'rate_limit_exceeded' });
    const shrinkOk = seq(big(), okRes('{"a":1}'));
    expect((await run(shrinkOk.fetch)).text).toBe('{"a":1}');
    expect(shrinkOk.bodies.map((b) => b.max_tokens)).toEqual([3000, 1500]);
    expect(await code(run(seq(big(), big()).fetch))).toBe('rate-limited');
    const tpm = seq(groqErr(429, { message: 'Rate limit reached on tokens per minute (TPM)', type: 'tokens', code: 'rate_limit_exceeded' }), okRes('{}'));
    expect((await run(tpm.fetch)).text).toBe('{}');
    expect(tpm.bodies[1]!.max_tokens).toBe(1500);
  });

  it('keeps auth for 401/403 only, server for 5xx, and logs status and code but never the key or prompt', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await code(run(seq(groqErr(401, { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' })).fetch))).toBe('auth');
    expect(await code(run(seq(groqErr(403, { message: 'denied', type: 'permissions_error' })).fetch))).toBe('auth');
    expect(await code(run(seq(groqErr(500, { message: 'oops', type: 'internal_server_error' })).fetch))).toBe('server');
    expect(await code(run(seq(new Response('<html>', { status: 502 })).fetch))).toBe('server');
    expect(spy).toHaveBeenCalledWith('Motikord: could not reach Groq', 401, 'invalid_api_key');
    expect(spy).toHaveBeenCalledWith('Motikord: could not reach Groq', 500, 'internal_server_error');
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('JSON please');
    spy.mockRestore();
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

describe('choosing a Groq model', () => {
  beforeEach(() => fakeBrowser.reset());
  const m = [{ role: 'user' as const, content: 'x' }];
  const list = (...ids: string[]) => new Response(JSON.stringify({ data: ids.map((id) => ({ id, active: true })) }), { status: 200 });
  const notFound = () => new Response(JSON.stringify({ error: { message: 'gone', type: 'invalid_request_error', code: 'model_not_found' } }), { status: 404 });
  /** Routes /models to `models()` and chat calls to `chats` in turn; records the model of each chat call. */
  function route(models: () => Response | Promise<Response>, ...chats: Response[]) {
    const used: string[] = [];
    let modelCalls = 0;
    const fetch: FetchLike = async (u, init) => {
      if (u === GROQ_MODELS_URL) { modelCalls++; expect(init?.credentials).toBe('omit'); return models(); }
      used.push(JSON.parse(String(init?.body)).model);
      return chats.shift()!;
    };
    return { fetch, used, calls: () => modelCalls };
  }
  const go = (fetch: FetchLike) => chat(m, { ai: 'cloud', key: KEY, fetch, json: true });

  it('takes the best preferred id the list has, skipping non-chat models', async () => {
    const r = route(() => list('whisper-large-v3', 'llama-guard-4', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'), okRes('{}'));
    await go(r.fetch);
    expect(r.used).toEqual(['llama-3.3-70b-versatile']);
  });

  it('takes the first usable id when no preferred one is listed', async () => {
    const r = route(() => list('canopylabs/orpheus-v1', 'groq/compound', 'brand/new-chat'), okRes('{}'));
    await go(r.fetch);
    expect(r.used).toEqual(['brand/new-chat']);
  });

  it('asks /models once and then uses the cached id', async () => {
    const r = route(() => list('openai/gpt-oss-20b'), okRes('{}'), okRes('{}'));
    await go(r.fetch);
    await go(r.fetch);
    expect(r.calls()).toBe(1);
    expect(r.used).toEqual(['openai/gpt-oss-20b', 'openai/gpt-oss-20b']);
    expect(await fakeBrowser.storage.session.get('groqModel')).toEqual({ groqModel: 'openai/gpt-oss-20b' });
  });

  it('on 404 model_not_found clears the cache, picks again and retries once', async () => {
    await fakeBrowser.storage.session.set({ groqModel: 'llama-3.3-70b-versatile' });
    const r = route(() => list('openai/gpt-oss-120b'), notFound(), okRes('{"a":1}'));
    expect((await go(r.fetch)).text).toBe('{"a":1}');
    expect(r.used).toEqual(['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']);
    expect((await fakeBrowser.storage.session.get('groqModel')).groqModel).toBe('openai/gpt-oss-120b');
  });

  it('retries on model_decommissioned but only once', async () => {
    const gone = () => new Response(JSON.stringify({ error: { message: 'x', code: 'model_decommissioned' } }), { status: 400 });
    const r = route(() => list('openai/gpt-oss-120b'), gone(), gone());
    expect(await code(go(r.fetch))).toBe('server');
    expect(r.used).toHaveLength(2);
  });

  it('falls back to the first preferred id when /models fails, without caching it', async () => {
    for (const models of [() => new Response('{}', { status: 500 }), () => { throw new TypeError('Failed to fetch'); }]) {
      const r = route(models, okRes('{}'));
      await go(r.fetch);
      expect(r.used).toEqual([GROQ_MODEL_PREFERENCE[0]]);
    }
    expect(await fakeBrowser.storage.session.get('groqModel')).toEqual({});
  });
});
