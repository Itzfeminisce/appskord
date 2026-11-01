import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { builtin, BUILTINS, trackUse } from './builtins';
import { SourceError } from './errors';

// Fake replies in each API's recorded shape; routes by URL prefix.
function router(routes: [string, unknown, number?][]) {
  return vi.fn(async (url: string) => {
    const hit = routes.find(([p]) => url.startsWith(p));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: hit[2] ?? 200 });
  });
}
const ctx = (fetch: ReturnType<typeof router>, key?: string, allLicences = false) => ({ fetch, key, allLicences });

describe('built-in sources', () => {
  it('Wikimedia Commons: sends the words with a filetype, keeps stated licences, uses a 1920 copy of big photos', async () => {
    const f = router([['https://commons.wikimedia.org/w/api.php', { query: { pages: [
      { pageid: 1, index: 1, title: 'File:A.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/a.jpg', thumburl: 'https://upload.wikimedia.org/thumb/a.jpg/1920px-a.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:A.jpg', mime: 'image/jpeg', width: 5000, height: 4000, extmetadata: { LicenseShortName: { value: 'CC0' } } }] },
      { pageid: 2, index: 2, title: 'File:B.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/b.jpg', mime: 'image/jpeg', extmetadata: {} }] },
    ] } }]]);
    const out = await builtin('wikimedia').search(ctx(f), 'bread', 'image');
    const u = new URL(f.mock.calls[0]![0]);
    expect(u.searchParams.get('gsrsearch')).toBe('bread filetype:bitmap');
    expect(u.searchParams.get('origin')).toBe('*');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'wikimedia', licence: 'cc0', downloadUrl: 'https://upload.wikimedia.org/thumb/a.jpg/1920px-a.jpg', thumbnail: 'https://upload.wikimedia.org/thumb/a.jpg/400px-a.jpg' });
  });

  it('NASA: photos from the preview link, videos from the manifest; licence left as Check you may use it', async () => {
    const item = (id: string, type: string) => ({ href: `http://images-assets.nasa.gov/${type}/${id}/collection.json`, data: [{ nasa_id: id, title: `T ${id}`, media_type: type, center: 'JSC' }], links: [{ href: `https://images-assets.nasa.gov/${type}/${id}/${id}~thumb.jpg`, rel: 'preview', render: 'image' }] });
    const f = router([
      ['https://images-api.nasa.gov/search?q=moon&media_type=image', { collection: { items: [item('i1', 'image')] } }],
      ['https://images-api.nasa.gov/search?q=moon&media_type=video', { collection: { items: [item('v1', 'video')] } }],
      ['https://images-assets.nasa.gov/video/v1/collection.json', ['http://images-assets.nasa.gov/video/v1/v1~orig.mp4', 'http://images-assets.nasa.gov/video/v1/v1~medium.mp4']],
    ]);
    const [img] = await builtin('nasa').search(ctx(f), 'moon', 'image');
    expect(img).toMatchObject({ source: 'nasa', licence: 'unknown', sourceName: 'NASA Image Library', downloadUrl: 'https://images-assets.nasa.gov/image/i1/i1~large.jpg', pageUrl: 'https://images.nasa.gov/details/i1', author: 'JSC' });
    const [vid] = await builtin('nasa').search(ctx(f), 'moon', 'video');
    expect(vid).toMatchObject({ kind: 'video', downloadUrl: 'https://images-assets.nasa.gov/video/v1/v1~medium.mp4' });
  });

  it('Museums (CC0): public-domain works from The Met and the Art Institute, and one museum failing leaves the other', async () => {
    const f = router([
      ['https://collectionapi.metmuseum.org/public/collection/v1/search', { total: 2, objectIDs: [10, 11] }],
      ['https://collectionapi.metmuseum.org/public/collection/v1/objects/10', { objectID: 10, isPublicDomain: true, primaryImage: 'https://images.metmuseum.org/10.jpg', primaryImageSmall: 'https://images.metmuseum.org/10s.jpg', title: 'Still life', artistDisplayName: 'Fay', objectURL: 'https://www.metmuseum.org/art/collection/search/10' }],
      ['https://collectionapi.metmuseum.org/public/collection/v1/objects/11', { objectID: 11, isPublicDomain: false, primaryImage: 'https://images.metmuseum.org/11.jpg' }],
      ['https://api.artic.edu/api/v1/artworks/search', { config: { iiif_url: 'https://www.artic.edu/iiif/2' }, data: [{ id: 20, title: 'Bread', artist_title: 'Gus', image_id: 'abc', is_public_domain: true, thumbnail: { width: 800, height: 600 } }] }],
    ]);
    const out = await builtin('museums').search(ctx(f), 'bread', 'image');
    expect(out.map((r) => r.id)).toEqual(['met-10', 'aic-20']);
    expect(out[1]).toMatchObject({ licence: 'cc0', sourceName: 'Art Institute of Chicago', downloadUrl: 'https://www.artic.edu/iiif/2/abc/full/843,/0/default.jpg' });
    const half = router([['https://api.artic.edu/api/v1/artworks/search', { data: [{ id: 21, image_id: 'x', is_public_domain: true }] }]]);
    expect((await builtin('museums').search(ctx(half), 'bread', 'image')).map((r) => r.id)).toEqual(['aic-21']);
  });

  it('ccMixter: MP3 uploads with CC licences; sampling licences are left out', async () => {
    const f = router([['https://ccmixter.org/api/query', [
      { upload_id: 1, upload_name: 'Loop', user_name: 'hal', file_page_url: 'http://ccmixter.org/files/hal/1', license_url: 'http://creativecommons.org/licenses/by/3.0/', files: [{ download_url: 'http://ccmixter.org/content/hal/loop.mp3', file_format_info: { 'mime_type': 'audio/mpeg' } }] },
      { upload_id: 2, upload_name: 'S', user_name: 'x', license_url: 'http://creativecommons.org/licenses/sampling+/1.0/', files: [{ download_url: 'http://ccmixter.org/content/x/s.mp3', file_format_info: { 'mime_type': 'audio/mpeg' } }] },
    ]]]);
    const out = await builtin('ccmixter').search(ctx(f), 'bread', 'audio');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ licence: 'cc-by', licenceLabel: 'CC BY 3.0', downloadUrl: 'https://ccmixter.org/content/hal/loop.mp3' });
  });

  it('Pixabay: key in the link, Pixabay licence, a bad key reads as rejected', async () => {
    const f = router([['https://pixabay.com/api/?', { total: 1, totalHits: 1, hits: [{ id: 3, pageURL: 'https://pixabay.com/photos/3/', tags: 'bread', webformatURL: 'https://pixabay.com/get/w.jpg', largeImageURL: 'https://pixabay.com/get/l.jpg', user: 'Ida' }] }]]);
    const [r] = await builtin('pixabay').search(ctx(f, 'pixabay_test'), 'bread', 'image');
    expect(new URL(f.mock.calls[0]![0]).searchParams.get('key')).toBe('pixabay_test');
    expect(r).toMatchObject({ source: 'pixabay', licence: 'pixabay', licenceLabel: 'Pixabay Content License' });
    const bad = router([['https://pixabay.com/api/', { error: 'x' }, 400]]);
    await expect(builtin('pixabay').search(ctx(bad, 'pixabay_test'), 'bread', 'image')).rejects.toMatchObject({ reason: 'key' });
  });

  it('Freesound: Token header, HQ preview, licence from its link', async () => {
    const f = router([['https://freesound.org/apiv2/search/text/', { results: [{ id: 4, name: 'Crackle', username: 'jo', license: 'http://creativecommons.org/publicdomain/zero/1.0/', previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/4.mp3' }, duration: 2.5, url: 'https://freesound.org/s/4/' }] }]]);
    const [r] = await builtin('freesound').search(ctx(f, 'freesound_test'), 'fire', 'audio');
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Authorization: 'Token freesound_test' });
    expect(r).toMatchObject({ licence: 'cc0', durationMs: 2500, downloadUrl: 'https://cdn.freesound.org/previews/4.mp3' });
  });

  it('Jamendo: client_id in the link; non-commercial hidden unless all licences', async () => {
    const reply = { headers: { status: 'success' }, results: [{ id: '5', name: 'Song', artist_name: 'Kai', shareurl: 'https://www.jamendo.com/track/5', audiodownload: 'https://prod-1.storage.jamendo.com/5.mp3', license_ccurl: 'http://creativecommons.org/licenses/by-nc-sa/3.0/', duration: 120 }] };
    const f = router([['https://api.jamendo.com/v3.0/tracks/', reply]]);
    expect(await builtin('jamendo').search(ctx(f, 'jamendo_test'), 'bread', 'audio')).toEqual([]);
    expect(new URL(f.mock.calls[0]![0]).searchParams.get('client_id')).toBe('jamendo_test');
    const [r] = await builtin('jamendo').search(ctx(f, 'jamendo_test', true), 'bread', 'audio');
    expect(r).toMatchObject({ licence: 'cc-by-nc', durationMs: 120000 });
  });

  it('Unsplash: Client-ID header, credit link with referral, and the download ping on use', async () => {
    const f = router([
      ['https://api.unsplash.com/search/photos', { results: [{ id: 'u1', alt_description: 'a loaf', width: 4000, height: 3000, urls: { regular: 'https://images.unsplash.com/u1?w=1080', small: 'https://images.unsplash.com/u1?w=400' }, links: { html: 'https://unsplash.com/photos/u1', download_location: 'https://api.unsplash.com/photos/u1/download?ixid=1' }, user: { name: 'Lu' } }] }],
      ['https://api.unsplash.com/photos/u1/download', { url: 'x' }],
    ]);
    const [r] = await builtin('unsplash').search(ctx(f, 'unsplash_test'), 'bread', 'image');
    expect(r).toMatchObject({ licence: 'unsplash', author: 'Lu', pageUrl: 'https://unsplash.com/photos/u1?utm_source=motikord&utm_medium=referral' });
    await trackUse(f, r!, 'unsplash_test');
    const ping = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(ping[0]).toBe('https://api.unsplash.com/photos/u1/download?ixid=1');
    expect(ping[1].headers).toMatchObject({ Authorization: 'Client-ID unsplash_test' });
  });

  it('maps HTTP errors: 429 busy, 5xx down, no answer offline', async () => {
    await expect(builtin('nasa').search(ctx(router([['https://images-api.nasa.gov', {}, 429]])), 'x', 'image')).rejects.toMatchObject({ reason: 'busy', status: 429 });
    await expect(builtin('wikimedia').search(ctx(router([['https://commons', {}, 503]])), 'x', 'image')).rejects.toMatchObject({ reason: 'down', status: 503 });
    const off = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(builtin('ccmixter').search({ fetch: off, allLicences: false }, 'x', 'audio')).rejects.toBeInstanceOf(SourceError);
  });

  it('lists every built-in host as an optional host in the manifest', () => {
    const config = readFileSync('wxt.config.ts', 'utf8');
    for (const b of BUILTINS) for (const o of b.origins) expect(config).toContain(`'${o}'`);
  });
});
