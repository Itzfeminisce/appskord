import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDB, getClip, listClips, putClip } from './db';
import {
  cleanName, clipDate, duplicate, duplicateClip, exclusivePaths, filterClips, queue, thumbnailKey, footerText, formatBytes, libraryDeps, measureSpace, mediaPaths, removeClip, sortClips,
  type LibraryDeps,
} from './library';
import type { Asset, Clip, ClipType } from './types';

const asset = (id: string, path = `media/${id}.png`): Asset => ({ id, kind: 'image', name: id, mime: 'image/png', bytes: 1, opfsPath: path });
const clip = (id: string, name: string, type: ClipType, updatedAt: number, assets: Asset[] = [], prompt?: string): Clip => ({
  id, createdAt: 1, updatedAt, history: [],
  recipe: { version: 1, id, name, type, aspect: '9:16', scenes: [], assets: Object.fromEntries(assets.map((a) => [a.id, a])), prompt },
});
const fakes = (): Clip[] => [
  clip('a', 'Sourdough promo', 'promo', 5, [asset('logo'), asset('photo')], 'A promo for my bakery'),
  clip('b', 'Monday quote', 'quote', 9, [asset('logo')], 'Small steps every day'),
  clip('c', 'Q3 sign-ups', 'chart', 7),
];

describe('filterClips', () => {
  it('matches the name and the prompt, ignoring case', () => {
    expect(filterClips(fakes(), 'MONDAY').map((c) => c.id)).toEqual(['b']);
    expect(filterClips(fakes(), 'bakery').map((c) => c.id)).toEqual(['a']);
    expect(filterClips(fakes(), '  ').length).toBe(3);
    expect(filterClips(fakes(), 'croissant')).toEqual([]);
  });
  it('filters by type and combines with the search', () => {
    expect(filterClips(fakes(), '', 'chart').map((c) => c.id)).toEqual(['c']);
    expect(filterClips(fakes(), 'promo', 'quote')).toEqual([]);
    expect(filterClips(fakes(), 'promo', 'promo').map((c) => c.id)).toEqual(['a']);
  });
  it('sorts newest change first without touching the input', () => {
    const input = fakes();
    expect(sortClips(input).map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(input.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('duplicateClip', () => {
  it('gets new ids and the “copy” name, shares assets and starts un-exported', () => {
    const src = { ...fakes()[0]!, exportedAt: 3, exports: [{ file: 'x.mp4', bytes: 1, at: 3 }], thumbnail: new Blob(['x']) };
    const copy = duplicateClip(src, 'new', 100);
    expect(copy.id).toBe('new');
    expect(copy.recipe.id).toBe('new');
    expect(copy.recipe.name).toBe('Sourdough promo copy');
    expect(copy.recipe.assets.logo?.opfsPath).toBe('media/logo.png');
    expect(copy.exportedAt).toBeUndefined();
    expect(copy.exports).toBeUndefined();
    expect(copy.createdAt).toBe(100);
    copy.recipe.name = 'changed';
    expect(src.recipe.name).toBe('Sourdough promo');
  });
});

describe('media safety and space', () => {
  it('lists only the paths no other clip uses', () => {
    const [a, b] = fakes() as [Clip, Clip, Clip];
    expect(exclusivePaths(a, fakes())).toEqual(['media/photo.png']);
    expect(exclusivePaths(b, fakes())).toEqual([]);
    expect(mediaPaths(fakes()).sort()).toEqual(['media/logo.png', 'media/photo.png']);
  });
  it('counts a shared file once and adds the database estimate', async () => {
    const sizes: Record<string, number> = { 'media/logo.png': 100, 'media/photo.png': 50 };
    const deps = { ...libraryDeps, size: async (p: string) => sizes[p] ?? 0, databaseEstimate: async () => 7 };
    expect(await measureSpace(fakes(), deps)).toBe(157);
    expect(await measureSpace(fakes(), { ...deps, databaseEstimate: async () => undefined })).toBeGreaterThan(150);
  });
  it('words sizes, the footer and dates', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(210 * 1024 ** 2)).toBe('210 MB');
    expect(footerText(4, 210 * 1024 ** 2)).toBe('4 clips · 210 MB on this computer, with their media');
    expect(footerText(1, 0)).toContain('1 clip ·');
    const now = new Date(2026, 9, 30, 15).getTime();
    expect(clipDate(new Date(2026, 9, 30, 1).getTime(), now)).toBe('Today');
    expect(clipDate(new Date(2026, 9, 29, 23).getTime(), now)).toBe('Yesterday');
    expect(clipDate(new Date(2026, 9, 24).getTime(), now)).toBe('Oct 24');
  });
  it('ignores empty or unchanged names', () => {
    expect(cleanName('  ', 'a')).toBeUndefined();
    expect(cleanName('a', 'a')).toBeUndefined();
    expect(cleanName('  New   name ', 'a')).toBe('New name');
  });
});

describe('library with storage', () => {
  afterEach(async () => {
    await closeDB();
    indexedDB.deleteDatabase('motikord');
  });
  it('duplicates into the database', async () => {
    for (const c of fakes()) await putClip(c);
    const copy = await duplicate(fakes()[0]!, { ...libraryDeps, id: () => 'copy-1', now: () => 50 });
    expect((await getClip('copy-1'))?.recipe.name).toBe('Sourdough promo copy');
    expect(copy.id).toBe('copy-1');
    expect((await listClips()).length).toBe(4);
  });
  it('deletes the clip and only the media no other clip uses', async () => {
    for (const c of fakes()) await putClip(c);
    const removed: string[] = [];
    const deps: LibraryDeps = { ...libraryDeps, brandPaths: async () => [], removeMedia: async (p) => { removed.push(p); } };
    await removeClip('a', deps);
    expect(await getClip('a')).toBeUndefined();
    expect(removed).toEqual(['media/photo.png']);
    await removeClip('b', deps);
    expect(removed).toEqual(['media/photo.png', 'media/logo.png']);
    await removeClip('missing', deps);
    expect((await listClips()).map((c) => c.id)).toEqual(['c']);
  });
  it('never deletes a file the brand kit uses', async () => {
    for (const c of fakes()) await putClip(c);
    const removed: string[] = [];
    const deps: LibraryDeps = { ...libraryDeps, brandPaths: async () => ['media/photo.png'], removeMedia: async (p) => { removed.push(p); } };
    await removeClip('a', deps);
    expect(removed).toEqual([]);
    expect(exclusivePaths(fakes()[0]!, fakes(), ['media/photo.png'])).toEqual([]);
  });
});

describe('thumbnails', () => {
  it('runs at most two jobs at once', async () => {
    const run = queue(2);
    let now = 0;
    let peak = 0;
    const job = () => run(async () => { peak = Math.max(peak, ++now); await new Promise((r) => setTimeout(r, 5)); now--; });
    await Promise.all([1, 2, 3, 4, 5].map(job));
    expect(peak).toBe(2);
  });
  it('changes the key when the picture changes, not the name', () => {
    const c = fakes()[0]!;
    const renamed = { ...c, recipe: { ...c.recipe, name: 'Other' } };
    const moved = { ...c, recipe: { ...c.recipe, aspect: '1:1' as const } };
    expect(thumbnailKey(renamed)).toBe(thumbnailKey(c));
    expect(thumbnailKey(moved)).not.toBe(thumbnailKey(c));
  });
});
