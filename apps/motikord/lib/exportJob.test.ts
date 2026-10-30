import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDB, getExportJob, listExportJobs, putExportJob } from './db';
import { clearSession, cancelExport, classify, findInterrupted, getSession, newJob, runExport, type RunDeps, type StoredJob } from './exportJob';
import type { Asset, Recipe } from './types';

const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
class FakeDir {
  files = new Map<string, Blob>();
  dirs = new Map<string, FakeDir>();
  constructor(public name: string, public full = false) {}
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) { if (!o?.create) throw notFound(); d = new FakeDir(name, this.full); this.dirs.set(name, d); }
    return d;
  }
  async getFileHandle(name: string) {
    return { createWritable: async () => { const parts: BlobPart[] = []; return new WritableStream({ write: (c) => { if (this.full) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); parts.push(c); }, close: () => { this.files.set(name, new Blob(parts)); } }); } };
  }
  async removeEntry(name: string) { this.dirs.delete(name); this.files.delete(name); }
}

const ccby: Asset = { id: 'a', kind: 'image', name: 'Loaf', mime: 'image/jpeg', bytes: 1, opfsPath: 'media/a.jpg', credit: { title: 'Loaf', author: 'Ada', source: 'openverse', url: 'https://x.test/a', licence: 'cc-by' } };
const recipe: Recipe = {
  version: 1, id: 'c1', name: 'Sourdough promo', type: 'promo', aspect: '9:16', assets: { a: ccby },
  scenes: [{ id: 's', durationMs: 1000, background: '#fff', layout: 'center', layers: [{ id: 'l', name: 'l', type: 'image', assetId: 'a', fit: 'cover', startMs: 0, endMs: 1000, opacity: 1, box: { x: 0, y: 0, w: 1, h: 1 } }] }],
};

function deps(root: FakeDir, opts: { hang?: boolean } = {}) {
  const badges: (number | null)[] = [];
  const jobs: StoredJob[] = [];
  const exported: string[] = [];
  let t = 0;
  const d: RunDeps = {
    root: root as unknown as FileSystemDirectoryHandle,
    now: () => (t += 100),
    badge: (p) => badges.push(p === null ? null : Math.floor(p)),
    mix: async () => undefined,
    saveJob: async (j) => { jobs.push(j); await putExportJob(j); },
    markExported: async (_id, files) => { exported.push(...files.map((f) => f.file)); },
    objectUrl: () => 'blob:fake',
    render: (_r, item, _a, hooks) => {
      let reject: (e: unknown) => void = () => undefined;
      const done = new Promise<Blob>((res, rej) => {
        reject = rej;
        hooks.encoder(true);
        hooks.progress(Math.floor(item.frames / 2), item.frames, 500);
        if (!opts.hang) { hooks.progress(item.frames, item.frames, 1000); res(new Blob(['x'.repeat(10)], { type: 'video/mp4' })); }
      });
      return { done, cancel: () => reject(Object.assign(new Error('c'), { name: 'Cancelled' })) };
    },
  };
  return { d, badges, jobs, exported };
}

describe('export job', () => {
  afterEach(async () => { clearSession(); await closeDB(); indexedDB.deleteDatabase('motikord'); });

  it('renders sizes one after another into a sub-folder, writes credits.txt, then removes the job', async () => {
    const root = new FakeDir('Motikord clips');
    root.dirs.set('Sourdough promo', new FakeDir('Sourdough promo'));
    const { d, badges, jobs, exported } = deps(root);
    const s = await runExport(recipe, 'c1', { kinds: ['mp4'], aspects: ['9:16', '1:1'], quality: '720p', credits: true }, d, 'job1');
    expect(s.phase).toBe('done');
    const dir = root.dirs.get('Sourdough promo (2)')!;
    expect([...dir.files.keys()]).toEqual(['sourdough-promo-9x16.mp4', 'sourdough-promo-1x1.mp4', 'credits.txt']);
    expect(await dir.files.get('credits.txt')!.text()).toContain('“Loaf” by Ada');
    expect(s.saved.map((f) => f.size)).toEqual([10, 10, expect.any(Number)]);
    expect(exported).toEqual(['Sourdough promo (2)/sourdough-promo-9x16.mp4', 'Sourdough promo (2)/sourdough-promo-1x1.mp4']);
    expect(jobs[0]).toMatchObject({ id: 'job1', status: 'running', clipId: 'c1', credits: true });
    expect(await getExportJob('job1')).toBeUndefined();
    expect(badges[0]).toBe(0);
    expect(badges).toContain(25);
    expect(badges.at(-1)).toBeNull();
    expect(s.playUrl).toBe('blob:fake');
  });

  it('Cancel removes partial files and the job and ends cancelled', async () => {
    const root = new FakeDir('Motikord clips');
    const { d, badges } = deps(root, { hang: true });
    const run = runExport(recipe, 'c1', { kinds: ['webm'], aspects: ['9:16'], quality: '1080p', credits: false }, d, 'job2');
    for (let k = 0; k < 200 && !(getSession()?.percent ?? 0); k++) await new Promise((r) => setTimeout(r, 5));
    expect(getSession()?.percent).toBeGreaterThan(0);
    cancelExport();
    const s = await run;
    expect(s.phase).toBe('cancelled');
    expect(root.dirs.size).toBe(0);
    expect(await getExportJob('job2')).toBeUndefined();
    expect(badges.at(-1)).toBeNull();
  });

  it('maps a full disk to disk-full and leaves nothing behind', async () => {
    const root = new FakeDir('Motikord clips', true);
    const { d } = deps(root);
    const s = await runExport(recipe, 'c1', { kinds: ['gif'], aspects: ['9:16'], quality: '720p', credits: false }, d);
    expect(s.phase).toBe('disk-full');
    expect(root.dirs.size).toBe(0);
    expect(classify(Object.assign(new Error('x'), { name: 'EncodingError' }))).toBe('failed');
    expect(classify(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toBe('access-lost');
  });

  it('keeps a finished export when the job row cannot be removed', async () => {
    const root = new FakeDir('Motikord clips');
    const { d, badges } = deps(root);
    d.removeJob = async () => { throw new Error('db closed'); };
    const s = await runExport(recipe, 'c1', { kinds: ['mp4'], aspects: ['9:16'], quality: '720p', credits: true }, d, 'job5');
    expect(s.phase).toBe('done');
    expect([...root.dirs.get('Sourdough promo')!.files.keys()]).toEqual(['sourdough-promo-9x16.mp4', 'credits.txt']);
    expect(badges.at(-1)).toBeNull();
  });

  it('Cancel while credits.txt is written still cancels and removes the files', async () => {
    const root = new FakeDir('Motikord clips');
    const orig = FakeDir.prototype.getFileHandle;
    FakeDir.prototype.getFileHandle = async function (this: FakeDir, name: string) {
      if (name === 'credits.txt') cancelExport();
      return orig.call(this, name);
    };
    try {
      const { d } = deps(root);
      const s = await runExport(recipe, 'c1', { kinds: ['mp4'], aspects: ['9:16'], quality: '720p', credits: true }, d, 'job6');
      expect(s.phase).toBe('cancelled');
      expect(root.dirs.size).toBe(0);
      expect(await getExportJob('job6')).toBeUndefined();
    } finally { FakeDir.prototype.getFileHandle = orig; }
  });

  it('finds jobs cut off at start-up and leaves a live export alone', async () => {
    const dead = { ...newJob('c1', { kinds: ['mp4'], aspects: ['9:16'], quality: '1080p', credits: false }, 1000, 'dead'), percent: 46, beatAt: 1000 };
    const live = { ...newJob('c2', { kinds: ['mp4'], aspects: ['9:16'], quality: '1080p', credits: false }, 1000, 'live'), beatAt: 99_000 };
    await putExportJob(dead);
    await putExportJob(live);
    let cleared = 0;
    const found = await findInterrupted(100_000, undefined, () => { cleared++; });
    expect(found.map((j) => [j.id, j.status, j.percent])).toEqual([['dead', 'interrupted', 46]]);
    expect((await listExportJobs('running')).map((j) => j.id)).toEqual(['live']);
    // The live export still owns the badge.
    expect(cleared).toBe(0);
    await findInterrupted(200_000, undefined, () => { cleared++; });
    expect(cleared).toBe(1);
  });
});
