import { describe, expect, it, vi } from 'vitest';
import { checkKey, detectKey, serviceLabel } from './keyDetect';

describe('detectKey', () => {
  it('recognises Groq and Pexels keys', () => {
    expect(detectKey('gsk_test')).toBe('GROQ_API_KEY');
    expect(detectKey('  gsk_test  ')).toBe('GROQ_API_KEY');
    expect(detectKey('pexels_test')).toBe('PEXELS_API_KEY');
    expect(detectKey('a'.repeat(56))).toBe('PEXELS_API_KEY');
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
