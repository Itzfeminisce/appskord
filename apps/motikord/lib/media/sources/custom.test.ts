import { describe, expect, it, vi } from 'vitest';
import { buildRequest, linkHostPath, mainKind, normaliseLink, searchCustom, testSource } from './custom';

const KEY = 'custom_test_key';
const json = (body: unknown, status = 200) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

describe('custom source links', () => {
  it('keeps {query}, or adds ?q= / &q= when it is missing', () => {
    expect(normaliseLink('https://a.example.com/s?term={query}')).toBe('https://a.example.com/s?term={query}');
    expect(normaliseLink('https://a.example.com/wp-json/wp/v2/media')).toBe('https://a.example.com/wp-json/wp/v2/media?q={query}');
    expect(normaliseLink('https://a.example.com/api?per_page=10')).toBe('https://a.example.com/api?per_page=10&q={query}');
    expect(normaliseLink('http://a.example.com/s?q={query}')).toBeUndefined();
    expect(normaliseLink('bread')).toBeUndefined();
    expect(linkHostPath('https://photos.mybakery.com/wp-json/wp/v2/media?search={query}')).toBe('photos.mybakery.com/wp-json/wp/v2/media');
  });

  it('puts the words in place of {query}, encoded', () => {
    expect(buildRequest('https://a.example.com/s?q={query}', 'rye & spelt').url).toBe('https://a.example.com/s?q=rye%20%26%20spelt');
  });

  it('sends the key where the user chose', () => {
    const link = 'https://a.example.com/s?q={query}';
    expect(buildRequest(link, 'x', KEY, { keyAs: 'bearer' }).headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(buildRequest(link, 'x', KEY, { keyAs: 'authorization' }).headers.Authorization).toBe(KEY);
    for (const p of ['key', 'api_key', 'client_id'] as const) {
      const r = buildRequest(link, 'x', KEY, { keyAs: p });
      expect(new URL(r.url).searchParams.get(p)).toBe(KEY);
      expect(r.headers.Authorization).toBeUndefined();
    }
    const h = buildRequest(link, 'x', KEY, { keyAs: 'header', keyHeader: 'X-Api-Key' });
    expect(h.headers['X-Api-Key']).toBe(KEY);
    expect(h.url).not.toContain(KEY);
    expect(buildRequest(link, 'x', undefined, { keyAs: 'key' }).url).toBe('https://a.example.com/s?q=x');
  });
});

describe('testSource', () => {
  const wp = [{ id: 1, link: 'https://p.example.com/1', title: { rendered: 'Loaf' }, media_type: 'image', mime_type: 'image/jpeg', source_url: 'https://p.example.com/1.jpg' }];

  it('passes with results, the format read and whether licences are listed', async () => {
    const fetchFn = json(wp);
    const r = await testSource(fetchFn, 'Bakery', 'https://p.example.com/wp-json/wp/v2/media?search={query}', undefined, {});
    expect(r).toMatchObject({ kind: 'ok', format: 'wordpress', licenceKnown: false });
    expect(fetchFn.mock.calls[0]![0]).toBe('https://p.example.com/wp-json/wp/v2/media?search=bread');
    expect(r.kind === 'ok' && mainKind(r.results)).toEqual({ kind: 'image', n: 1 });
  });

  it('reports each way a test can fail', async () => {
    expect(await testSource(json({}), 'x', 'ftp://p.example.com', undefined, {})).toEqual({ kind: 'not-a-link' });
    expect(await testSource(json({}, 401), 'x', 'https://p.example.com/s?q={query}', undefined, {})).toEqual({ kind: 'needs-key', status: 401 });
    expect(await testSource(json({}, 503), 'x', 'https://p.example.com/s?q={query}', undefined, {})).toEqual({ kind: 'down', status: 503 });
    expect(await testSource(json([]), 'x', 'https://p.example.com/s?q={query}', undefined, {})).toMatchObject({ kind: 'no-results' });
    expect(await testSource(json({ ok: true }), 'x', 'https://p.example.com/s?q={query}', undefined, {})).toEqual({ kind: 'unreadable' });
    expect(await testSource(vi.fn(async () => { throw new TypeError('Failed to fetch'); }), 'x', 'https://p.example.com/s?q={query}', undefined, {})).toEqual({ kind: 'down' });
  });

  it('searches an added source with its key and format', async () => {
    const fetchFn = json(wp);
    const src = { id: 'c1', name: 'Bakery', url: 'https://p.example.com/m?search={query}', kinds: ['image' as const], format: 'wordpress' as const, on: true, keyAs: 'api_key' as const };
    const [r] = await searchCustom(fetchFn, src, KEY, 'rye', false);
    expect(new URL(fetchFn.mock.calls[0]![0]).searchParams.get('api_key')).toBe(KEY);
    expect(r).toMatchObject({ id: 'c1:1', source: 'custom', sourceName: 'Bakery', licence: 'unknown' });
  });
});
