import { describe, expect, it, vi } from 'vitest';
import { MediaSearchError, openverseUrl, searchOpenverse } from './openverse';

const item = (id: string, license: string, extra = {}) => ({
  id, title: `Title ${id}`, creator: 'Ada', url: `https://live.staticflickr.com/${id}.jpg`, foreign_landing_url: `https://www.flickr.com/photos/${id}`,
  license, license_version: '4.0', license_url: `https://creativecommons.org/licenses/${license}/4.0/`, thumbnail: `https://api.openverse.org/v1/images/${id}/thumb/`,
  width: 2400, height: 1600, filetype: 'jpg', ...extra,
});
const reply = (results: unknown[]) => vi.fn(async () => new Response(JSON.stringify({ results })));

describe('searchOpenverse', () => {
  it('sends only the words and the licence filter', () => {
    const url = new URL(openverseUrl('sourdough bread', 'image', false));
    expect(url.origin + url.pathname).toBe('https://api.openverse.org/v1/images/');
    expect(url.searchParams.get('q')).toBe('sourdough bread');
    expect(url.searchParams.get('license_type')).toBe('commercial,modification');
    expect(new URL(openverseUrl('x', 'audio', true)).searchParams.has('license_type')).toBe(false);
  });
  it('maps a result with its credit fields', async () => {
    const [r] = await searchOpenverse(reply([item('a1', 'by')]), 'bread', 'image', false);
    expect(r).toMatchObject({
      id: 'a1', source: 'openverse', kind: 'image', title: 'Title a1', author: 'Ada', licence: 'cc-by', licenceLabel: 'CC BY 4.0',
      pageUrl: 'https://www.flickr.com/photos/a1', downloadUrl: 'https://live.staticflickr.com/a1.jpg', mime: 'image/jpeg', width: 2400,
    });
  });
  it('hides CC BY-SA and NC unless all licences are on', async () => {
    const results = [item('a', 'by'), item('b', 'by-sa'), item('c', 'by-nc'), item('d', 'cc0'), item('e', 'by-nd')];
    const ids = async (all: boolean) => (await searchOpenverse(reply(results), 'q', 'image', all)).map((r) => r.id);
    expect(await ids(false)).toEqual(['a', 'd']);
    expect(await ids(true)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('maps audio length and skips results without a file', async () => {
    const out = await searchOpenverse(reply([item('t', 'cc0', { duration: 102000, filetype: 'mp3' }), item('u', 'cc0', { url: null })]), 'q', 'audio', false);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'audio', durationMs: 102000, mime: 'audio/mp3' });
  });
  it('tells offline from a failed answer', async () => {
    await expect(searchOpenverse(vi.fn(async () => { throw new TypeError('x'); }), 'q', 'image', false)).rejects.toMatchObject({ reason: 'offline' });
    await expect(searchOpenverse(vi.fn(async () => new Response('', { status: 500 })), 'q', 'image', false)).rejects.toBeInstanceOf(MediaSearchError);
  });
});
