import { describe, expect, it } from 'vitest';
import { readResults, type From } from './parsers';

const from: From = { source: 'custom', sourceName: 'Bakery photo library', allLicences: false };

// Recorded shapes, fake data.
const openverse = { result_count: 1, page_count: 1, results: [{ id: 'ov1', title: 'Loaf', creator: 'Ada', url: 'https://example.org/loaf.jpg', foreign_landing_url: 'https://example.org/p/1', license: 'by', license_version: '4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/', thumbnail: 'https://example.org/t.jpg', width: 800, height: 600 }] };
const wordpress = [
  { id: 7, date: '2026-01-01', link: 'https://photos.mybakery.com/bread/', title: { rendered: 'Sourdough &amp; rye' }, media_type: 'image', mime_type: 'image/jpeg', source_url: 'https://photos.mybakery.com/wp-content/uploads/bread.jpg',
    media_details: { width: 1600, height: 1200, sizes: { medium: { source_url: 'https://photos.mybakery.com/wp-content/uploads/bread-300x225.jpg' } } } },
  { id: 8, link: 'https://photos.mybakery.com/jingle/', title: { rendered: 'Jingle' }, media_type: 'file', mime_type: 'audio/mpeg', source_url: 'https://photos.mybakery.com/wp-content/uploads/jingle.mp3', media_details: { length: 12 } },
];
const mediawiki = { batchcomplete: true, query: { pages: [
  { pageid: 11, index: 2, title: 'File:Bread loaf.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/a/bread.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Bread_loaf.jpg', thumburl: 'https://upload.wikimedia.org/thumb/400px-bread.jpg', mime: 'image/jpeg', width: 1000, height: 800,
    extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' }, Artist: { value: '<a href="//x">Bo Baker</a>' }, ObjectName: { value: 'Bread loaf' } } }] },
  { pageid: 12, index: 1, title: 'File:Rye.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/a/rye.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Rye.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'Public domain' } } }] },
  { pageid: 13, index: 3, title: 'File:ND.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/a/nd.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC BY-ND 4.0' } } }] },
] } };
const pexels = { page: 1, photos: [{ id: 5, width: 4000, height: 3000, url: 'https://www.pexels.com/photo/5/', photographer: 'Cy', alt: 'Crust', src: { original: 'https://images.pexels.com/5.jpeg', large2x: 'https://images.pexels.com/5-l.jpeg', medium: 'https://images.pexels.com/5-m.jpeg' } }] };
const pixabay = { total: 1, totalHits: 1, hits: [{ id: 9, pageURL: 'https://pixabay.com/photos/bread-9/', tags: 'bread, food', previewURL: 'https://cdn.pixabay.com/p.jpg', webformatURL: 'https://pixabay.com/get/w.jpg', largeImageURL: 'https://pixabay.com/get/l.jpg', imageWidth: 1920, imageHeight: 1280, user: 'Dee' }] };
const generic = { meta: { total: 2 }, data: { items: [
  { id: 'g1', name: 'Baguette', image: { url: 'https://cdn.example.net/baguette.webp' }, author: { name: 'Eve' }, page: 'https://example.net/g1' },
  { id: 'g2', caption: 'Oven hum', audio_url: 'https://cdn.example.net/oven.mp3', license: 'https://creativecommons.org/publicdomain/zero/1.0/' },
] } };

describe('readResults', () => {
  it('reads an Openverse reply with its licence', () => {
    const r = readResults(openverse, from);
    expect(r).toMatchObject({ kind: 'ok', format: 'openverse' });
    if (r.kind !== 'ok') return;
    expect(r.results[0]).toMatchObject({ id: 'ov1', kind: 'image', licence: 'cc-by', licenceLabel: 'CC BY 4.0', author: 'Ada', sourceName: 'Bakery photo library' });
  });

  it('reads a WordPress media library and never claims a licence', () => {
    const r = readResults(wordpress, from);
    expect(r).toMatchObject({ kind: 'ok', format: 'wordpress' });
    if (r.kind !== 'ok') return;
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({ title: 'Sourdough & rye', kind: 'image', licence: 'unknown', thumbnail: 'https://photos.mybakery.com/wp-content/uploads/bread-300x225.jpg', width: 1600, pageUrl: 'https://photos.mybakery.com/bread/' });
    expect(r.results[1]).toMatchObject({ kind: 'audio', durationMs: 12000, licence: 'unknown' });
  });

  it('reads MediaWiki imageinfo in search order, keeps licences and drops no-derivatives', () => {
    const r = readResults(mediawiki, { ...from, allLicences: true });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.results.map((x) => x.id)).toEqual(['12', '11']);
    expect(r.results[0]).toMatchObject({ licence: 'pdm', title: 'Rye' });
    expect(r.results[1]).toMatchObject({ licence: 'cc-by-sa', licenceLabel: 'CC BY-SA 4.0', author: 'Bo Baker', title: 'Bread loaf' });
    // The free-only filter hides share-alike.
    const free = readResults(mediawiki, from);
    expect(free.kind === 'ok' && free.results.map((x) => x.licence)).toEqual(['pdm']);
  });

  it('reads Pexels-style and Pixabay-style replies as licence unknown', () => {
    const p = readResults(pexels, from);
    expect(p).toMatchObject({ kind: 'ok', format: 'pexels' });
    expect(p.kind === 'ok' && p.results[0]).toMatchObject({ downloadUrl: 'https://images.pexels.com/5-l.jpeg', licence: 'unknown', author: 'Cy' });
    const x = readResults(pixabay, from);
    expect(x).toMatchObject({ kind: 'ok', format: 'pixabay' });
    expect(x.kind === 'ok' && x.results[0]).toMatchObject({ title: 'bread', downloadUrl: 'https://pixabay.com/get/l.jpg', licence: 'unknown', author: 'Dee' });
  });

  it('finds the first list of items with media addresses in any JSON', () => {
    const r = readResults(generic, from);
    expect(r).toMatchObject({ kind: 'ok', format: 'generic' });
    if (r.kind !== 'ok') return;
    expect(r.results[0]).toMatchObject({ id: 'g1', title: 'Baguette', kind: 'image', author: 'Eve', downloadUrl: 'https://cdn.example.net/baguette.webp', licence: 'unknown', pageUrl: 'https://example.net/g1' });
    expect(r.results[1]).toMatchObject({ id: 'g2', kind: 'audio', title: 'Oven hum', licence: 'cc0' });
  });

  it('tells an empty list from an unreadable reply', () => {
    expect(readResults([], from).kind).toBe('empty');
    expect(readResults({ results: [] }, from).kind).toBe('empty');
    expect(readResults({ hello: 'world' }, from).kind).toBe('unreadable');
    expect(readResults('<html>', from).kind).toBe('unreadable');
  });

  it('reads only the stored format for an added source', () => {
    expect(readResults(generic, from, 'wordpress').kind).toBe('unreadable');
  });
});
