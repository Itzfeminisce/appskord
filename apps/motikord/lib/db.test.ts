import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Clip, ExportJob, Recipe } from './types';
import { closeDB, deleteClip, getBrandKit, getClip, listClips, listExportJobs, markInterruptedJobs, putBrandKit, putClip, putExportJob, updateClip } from './db';

const clip = (id: string, updatedAt: number): Clip => ({ id, recipe: { version: 1, id, name: id, type: 'promo', aspect: '9:16', scenes: [], assets: {} } satisfies Recipe, history: [], createdAt: 1, updatedAt });
const job = (id: string, status: ExportJob['status']): ExportJob =>
  ({ id, clipId: 'c', kinds: ['mp4'], aspects: ['9:16'], quality: '1080p', credits: true, startedAt: 1, status });

describe('db', () => {
  afterEach(async () => {
    await closeDB();
    indexedDB.deleteDatabase('motikord');
  });

  it('stores, updates, lists newest first and deletes clips', async () => {
    await putClip(clip('a', 1));
    await putClip(clip('b', 2));
    expect((await listClips()).map((c) => c.id)).toEqual(['b', 'a']);
    await updateClip('a', () => ({ updatedAt: 3 }));
    expect((await listClips()).map((c) => c.id)).toEqual(['a', 'b']);
    expect(await updateClip('gone', () => ({ updatedAt: 1 }))).toBeUndefined();
    await deleteClip('a');
    expect(await getClip('a')).toBeUndefined();
  });

  it('keeps one brand kit', async () => {
    await putBrandKit({ colours: [{ hex: '#BE185D', role: 'primary' }], useForNewClips: true });
    expect((await getBrandKit())?.useForNewClips).toBe(true);
  });

  it('marks running export jobs interrupted at start-up', async () => {
    await putExportJob(job('j1', 'running'));
    await putExportJob(job('j2', 'done'));
    expect(await markInterruptedJobs()).toBe(1);
    expect((await listExportJobs('interrupted')).map((j) => j.id)).toEqual(['j1']);
  });
});
