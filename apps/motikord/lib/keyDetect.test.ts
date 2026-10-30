import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkKey, createKeyWatcher, detectKey, serviceLabel } from './keyDetect';

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
    expect(detectKey('sk-test')).toBeNull();
    expect(detectKey('not-a-key')).toBeNull();
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
