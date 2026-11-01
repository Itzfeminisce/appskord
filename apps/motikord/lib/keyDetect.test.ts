import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkKey, createKeyWatcher, detectKey, looksComplete, serviceLabel, verifyKey } from './keyDetect';

describe('detectKey', () => {
  it('recognises Groq and Pexels keys', () => {
    expect(detectKey('gsk_test')).toBe('GROQ_API_KEY');
    expect(detectKey('  gsk_test  ')).toBe('GROQ_API_KEY');
    expect(detectKey('pexels_test')).toBe('PEXELS_API_KEY');
    expect(detectKey('a'.repeat(56), 'pexels')).toBe('PEXELS_API_KEY');
  });
  it('never takes the bare Pexels shape from the main field', () => {
    expect(detectKey('a'.repeat(56))).toBeNull();
    expect(detectKey('a'.repeat(56), 'main')).toBeNull();
  });
  it('does not recognise anything else', () => {
    expect(detectKey('')).toBeNull();
    expect(detectKey('not-a-key')).toBeNull();
    expect(detectKey('pk-test')).toBeNull();
  });
  it('tells the four providers apart, longest prefix first', () => {
    expect(detectKey('gsk_test')).toBe('GROQ_API_KEY');
    expect(detectKey('sk-test')).toBe('OPENAI_API_KEY');
    expect(detectKey('sk-proj-test')).toBe('OPENAI_API_KEY');
    expect(detectKey('sk-ant-test')).toBe('ANTHROPIC_API_KEY');
    expect(detectKey(' sk-or-test ')).toBe('OPENROUTER_API_KEY');
    expect(serviceLabel('ANTHROPIC_API_KEY')).toBe('Anthropic');
    expect(serviceLabel('OPENROUTER_API_KEY')).toBe('OpenRouter');
  });
  it('waits for a whole key of each shape', () => {
    expect(looksComplete('OPENAI_API_KEY', 'sk-test')).toBe(false);
    expect(looksComplete('OPENAI_API_KEY', `sk-test${'0'.repeat(24)}`)).toBe(true);
    expect(looksComplete('ANTHROPIC_API_KEY', `sk-ant-test${'0'.repeat(24)}`)).toBe(true);
    expect(looksComplete('OPENROUTER_API_KEY', `sk-or-test${'0'.repeat(24)}`)).toBe(true);
  });
  it('labels services', () => {
    expect(serviceLabel('GROQ_API_KEY')).toBe('Groq');
    expect(serviceLabel('PEXELS_API_KEY')).toBe('Pexels');
  });
});

describe('checkKey', () => {
  const reply = (status: number) => vi.fn(async () => new Response('{}', { status }));
  it('is ready on 200 and sends the key only as a header', async () => {
    const f = reply(200);
    expect(await checkKey('GROQ_API_KEY', 'gsk_test', f)).toBe('ready');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('gsk_test');
    expect(init.headers).toEqual({ Authorization: 'Bearer gsk_test' });
  });
  it('checks each provider key against that provider', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    await checkKey('OPENAI_API_KEY', 'sk-test', f as unknown as typeof fetch);
    await checkKey('ANTHROPIC_API_KEY', 'sk-ant-test', f as unknown as typeof fetch);
    await checkKey('OPENROUTER_API_KEY', 'sk-or-test', f as unknown as typeof fetch);
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map((c) => c[0])).toEqual(['https://api.openai.com/v1/models', 'https://api.anthropic.com/v1/models?limit=1000', 'https://openrouter.ai/api/v1/key']);
    expect(calls[0]![1].headers).toEqual({ Authorization: 'Bearer sk-test' });
    expect(calls[1]![1].headers).toMatchObject({ 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    expect(await checkKey('ANTHROPIC_API_KEY', 'sk-ant-test', (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch)).toBe('rejected');
  });
  it('is rejected on 401', async () => {
    expect(await checkKey('GROQ_API_KEY', 'gsk_test', reply(401))).toBe('rejected');
    expect(await checkKey('PEXELS_API_KEY', 'pexels_test', reply(403))).toBe('rejected');
  });
  it('is unreachable on a server error or a network failure', async () => {
    expect(await checkKey('PEXELS_API_KEY', 'pexels_test', reply(500))).toBe('unreachable');
    expect(await checkKey('GROQ_API_KEY', 'gsk_test', vi.fn(async () => { throw new Error('offline'); }))).toBe('unreachable');
  });
});

describe('createKeyWatcher', () => {
  afterEach(() => vi.useRealTimers());
  const key = 'gsk_' + 'x'.repeat(52);

  it('makes at most one fetch while a key is typed character by character', async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    const w = createKeyWatcher((n, k) => void checkKey(n, k, f as unknown as typeof fetch));
    for (let i = 1; i <= key.length; i++) { w.type(key.slice(0, i)); await vi.advanceTimersByTimeAsync(100); }
    expect(f).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('checks at once on paste and cancels a pending typed check', async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const w = createKeyWatcher(run);
    w.type(key);
    w.paste(key);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('does not send a pasted bare Pexels shape from the main field', () => {
    const run = vi.fn();
    createKeyWatcher(run).paste('a'.repeat(56));
    expect(run).not.toHaveBeenCalled();
    createKeyWatcher(run, 'pexels').paste('a'.repeat(56));
    expect(run).toHaveBeenCalledWith('PEXELS_API_KEY', 'a'.repeat(56));
  });
});

describe('verifyKey', () => {
  const granted = async () => 'granted' as const;
  const reply = (status: number) => vi.fn(async () => new Response('{}', { status }));
  const pex = ['https://api.pexels.com/*'];
  it('asks for the host before any fetch and saves only an accepted key', async () => {
    const order: string[] = [];
    const save = vi.fn(async () => { order.push('save'); });
    const f = vi.fn(async () => { order.push('fetch'); return new Response('{}', { status: 200 }); });
    const request = vi.fn(async () => { order.push('request'); return 'granted' as const; });
    expect(await verifyKey('PEXELS_API_KEY', ' pexels_test ', pex, { request, save, fetchImpl: f })).toBe('ready');
    expect(order).toEqual(['request', 'fetch', 'save']);
    expect(save).toHaveBeenCalledWith('PEXELS_API_KEY', 'pexels_test');
  });
  it('is denied without a fetch when host access is refused', async () => {
    const f = reply(200);
    expect(await verifyKey('PEXELS_API_KEY', 'pexels_test', pex, { request: async () => 'denied', save: vi.fn(), fetchImpl: f })).toBe('denied');
    expect(f).not.toHaveBeenCalled();
  });
  it('is rejected on 401 and 403 and saves nothing', async () => {
    for (const code of [401, 403]) {
      const save = vi.fn();
      expect(await verifyKey('PEXELS_API_KEY', 'pexels_test', pex, { request: granted, save, fetchImpl: reply(code) })).toBe('rejected');
      expect(save).not.toHaveBeenCalled();
    }
  });
  it('is unreachable on a network failure and saves nothing', async () => {
    const save = vi.fn();
    const f = vi.fn(async () => { throw new TypeError('offline'); });
    expect(await verifyKey('GROQ_API_KEY', 'gsk_test', ['https://api.groq.com/*'], { request: granted, save, fetchImpl: f as unknown as typeof fetch })).toBe('unreachable');
    expect(save).not.toHaveBeenCalled();
  });
});
