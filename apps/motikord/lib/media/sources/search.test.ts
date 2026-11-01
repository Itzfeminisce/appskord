import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaResult } from '../openverse';
import { SourceError } from './errors';
import { searchAll, sourceRuns, type SourceRun } from './search';
import { sourcesSummary } from './summary';

const res = (id: string, source: MediaResult['source'] = 'openverse'): MediaResult => ({
  id, source, kind: 'image', title: id, author: 'A', licence: 'cc0', licenceLabel: 'CC0', pageUrl: `https://e.example/${id}`, thumbnail: '', downloadUrl: `https://e.example/${id}.jpg`,
});
const run = (id: string, search: SourceRun['search'], extra: Partial<SourceRun> = {}): SourceRun => ({ id, name: id.toUpperCase(), origins: [`https://${id}.example/*`], kinds: ['image'], custom: false, keySource: false, search, ...extra });
const media = { on: {}, custom: [], allLicences: false };

afterEach(() => vi.restoreAllMocks());

describe('searchAll', () => {
  it('asks every source in parallel; one failing source is skipped and the others still show', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let started = 0;
    const slow = (ids: string[]) => async () => { started++; await new Promise((r) => setTimeout(r, 5)); return ids.map((i) => res(i)); };
    const out = await searchAll([
      run('a', slow(['a1', 'a2'])),
      run('b', async () => { started++; throw new SourceError('down', 503); }),
      run('c', slow(['c1'])),
    ], vi.fn(), 'bread', 'image', false);
    expect(started).toBe(3);
    expect(out.results.map((r) => r.id)).toEqual(['a1', 'c1', 'a2']);
    expect(out.down).toEqual([{ id: 'b', name: 'B', status: 503, custom: false }]);
    expect(out.offline).toBe(false);
  });

  it('sorts problems: 429 busy, 401 on a key source rejected, no answer from all offline', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = await searchAll([
      run('busy', async () => { throw new SourceError('busy', 429); }),
      run('keyed', async () => { throw new SourceError('key', 401); }, { keySource: true }),
      run('own', async () => { throw new SourceError('key', 403); }, { custom: true }),
    ], vi.fn(), 'x', 'image', false);
    expect(out.busy.map((p) => p.id)).toEqual(['busy']);
    expect(out.rejected.map((p) => p.id)).toEqual(['keyed']);
    expect(out.down.map((p) => p.id)).toEqual(['own']);
    const off = await searchAll([run('a', async () => { throw new SourceError('offline'); })], vi.fn(), 'x', 'image', false);
    expect(off.offline).toBe(true);
  });

  it('skips sources without the kind or without their key, and never logs a key', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const music = vi.fn(async () => [res('m')]);
    const keyless = vi.fn(async () => [res('k')]);
    const out = await searchAll([run('m', music, { kinds: ['audio'] }), run('k', keyless, { needsKey: true }), run('f', async () => { throw new SourceError('down', 500); })], vi.fn(), 'x', 'image', false);
    expect(music).not.toHaveBeenCalled();
    expect(keyless).not.toHaveBeenCalled();
    expect(out.results).toEqual([]);
    expect(JSON.stringify(err.mock.calls)).not.toContain('pexels_test');
  });
});

describe('sourceRuns', () => {
  it('defaults: Openverse, Wikimedia Commons and NASA on; Museums and ccMixter off; key sources need their key', () => {
    const ids = sourceRuns(media, {}).map((r) => [r.id, !!r.needsKey]);
    expect(ids).toEqual([['openverse', false], ['wikimedia', false], ['nasa', false], ['pexels', true]]);
    const withKeys = sourceRuns({ ...media, on: { museums: true, ccmixter: true, openverse: false } }, { pexels: 'pexels_test', pixabay: 'pixabay_test' });
    expect(withKeys.map((r) => r.id)).toEqual(['wikimedia', 'nasa', 'museums', 'ccmixter', 'pexels', 'pixabay']);
    expect(withKeys.every((r) => !r.needsKey)).toBe(true);
  });

  it('adds custom sources that are on, with their key', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response('[]'));
    const c = { id: 'c1', name: 'Bakery', url: 'https://p.example.com/m?q={query}', kinds: ['image' as const], format: 'wordpress' as const, on: true, keyAs: 'key' as const };
    const runs = sourceRuns({ ...media, on: { openverse: false, wikimedia: false, nasa: false, pexels: false }, custom: [c, { ...c, id: 'c2', on: false }] }, { 'custom:c1': 'custom_test' });
    expect(runs.map((r) => r.id)).toEqual(['c1']);
    expect(runs[0]!.origins).toEqual(['https://p.example.com/*']);
    await runs[0]!.search(fetchFn, 'rye', 'image', false);
    expect(new URL(fetchFn.mock.calls[0]![0]).searchParams.get('key')).toBe('custom_test');
  });
});

describe('sourcesSummary', () => {
  it('names the sources that are on, then your own', () => {
    const c = { id: 'c1', name: 'B', url: 'https://p.example.com/m?q={query}', kinds: ['image' as const], format: 'wordpress' as const, on: true };
    expect(sourcesSummary({ ...media, custom: [c] }, { pexels: 'pexels_test' })).toEqual({ line: 'Openverse, Wikimedia Commons, NASA, Pexels and 1 of your own', on: 5 });
    expect(sourcesSummary(media, {})).toEqual({ line: 'Openverse, Wikimedia Commons and NASA', on: 3 });
  });
});
