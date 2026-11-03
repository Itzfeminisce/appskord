import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, putMeeting, putSegment } from '../db';
import { listLedger, putItem, vectorsForMeeting } from '../memory/store';
import type { MemoryItem } from '../memory/types';
import type { Meeting, Segment } from '../types';
import { embedMeeting, ensureModel, modelState, removeModel, search } from './index';
import { IDLE_MS, setWorkerFactory, type WorkerLike } from './model';
import type { FromWorker, ToWorker } from './protocol';
import { cosine, dequantize, quantize } from './quantize';
import { fuse, itemsByWindows, rankWindows } from './search';
import { buildIndex, rankIndex, timeSyntheticSearch } from './vectorIndex';
import { windowsOf } from './windows';

vi.mock('../hosts', async (orig) => ({ ...(await orig<typeof import('../hosts')>()), requestHosts: vi.fn(async () => true) }));

const fakeVector = (seed: number) => Float32Array.from({ length: 384 }, (_, i) => Math.sin(seed * (i + 1)) * (i % 7 === 0 ? 3 : 0.5));

describe('quantize', () => {
  it('round trips 384 numbers within half a step', () => {
    const x = fakeVector(1.3);
    const q = quantize(x);
    expect(q.v).toBeInstanceOf(Int8Array);
    expect(q.v).toHaveLength(384);
    const back = dequantize(q);
    for (let i = 0; i < x.length; i++) expect(Math.abs(back[i]! - x[i]!)).toBeLessThanOrEqual(q.scale / 2 + 1e-6);
    expect(cosine(x, back)).toBeGreaterThan(0.999);
  });

  it('keeps an all-zero vector finite', () => {
    const q = quantize(new Float32Array(4));
    expect(q.scale).toBe(1);
    expect(cosine(q.v, q.v)).toBe(0);
  });
});

describe('cosine on int8', () => {
  it('matches float cosine and ignores the scale', () => {
    const a = fakeVector(0.7);
    const b = fakeVector(2.1);
    const qa = quantize(a);
    const qb = quantize(Float32Array.from(b, (n) => n * 40));
    expect(cosine(qa.v, qb.v)).toBeCloseTo(cosine(a, b), 2);
    expect(cosine(qa.v, qa.v)).toBeCloseTo(1, 5);
    expect(cosine(Int8Array.from([1, 0]), Int8Array.from([0, 5]))).toBe(0);
    expect(cosine(Int8Array.from([3, 4]), Int8Array.from([-3, -4]))).toBeCloseTo(-1, 5);
  });

  it('ranks windows best first and drops weak ones', () => {
    const row = (id: string, v: number[]) => ({ id, meetingId: id, atMs: 0, endMs: 1, text: id, ...quantize(v) });
    const hits = rankWindows([1, 0, 0], [row('far', [0, 1, 0]), row('near', [0.9, 0.3, 0]), row('same', [1, 0, 0])]);
    expect(hits.map((h) => h.row.id)).toEqual(['same', 'near']);
  });
});

describe('vector index', () => {
  const rows = [0.7, 2.1, 0.71, 5].map((seed, i) => ({ id: `r${i}`, meetingId: i < 2 ? 'a' : 'b', atMs: i, endMs: i + 1, text: 't', ...quantize(fakeVector(seed)) }));

  it('ranks like rankWindows, keeps only meetings in scope and caps the hits', () => {
    const index = buildIndex(rows);
    const q = fakeVector(0.7);
    const strip = (h: { row: { id: string }; score: number }) => [h.row.id, h.score.toFixed(5)];
    expect(rankIndex(index, q, undefined, -1).map(strip)).toEqual(rankWindows(q, rows, -1).map(strip));
    expect(rankIndex(index, q, new Set(['b']), -1).every((h) => h.row.meetingId === 'b')).toBe(true);
    expect(rankIndex(index, q, undefined, -1, 2)).toHaveLength(2);
  });

  it('searches 500 meetings x 120 windows quickly', { timeout: 20_000 }, () => {
    const { searchMs, rows: n } = timeSyntheticSearch();
    expect(n).toBe(60_000);
    console.info(`Rekord recall: synthetic search ${searchMs.toFixed(1)} ms`);
    expect(searchMs).toBeLessThan(2_000);
  });

  it('matches items to windows of their own meeting only', () => {
    const item = (id: string, meetingId: string, atMs: number) => ({ id, quote: { meetingId, atMs } }) as MemoryItem;
    const hits = [{ row: { id: 'w', meetingId: 'a', atMs: 0, endMs: 10 }, score: 1 }];
    expect(itemsByWindows([item('x', 'a', 5), item('y', 'b', 5), item('z', 'a', 20)], hits)).toEqual(['x']);
  });
});

describe('fuse', () => {
  it('orders by reciprocal rank across lists', () => {
    expect(fuse([['a', 'b', 'c'], ['c', 'a']]).map((h) => h.id)).toEqual(['a', 'c', 'b']);
    expect(fuse([['x', 'y'], []]).map((h) => h.id)).toEqual(['x', 'y']);
    expect(fuse([['b'], ['a']]).map((h) => h.id)).toEqual(['b', 'a']);
  });
});

describe('windowsOf', () => {
  it('groups segments into about 30 s windows and skips interim text', () => {
    const seg = (startMs: number, text: string, interim?: boolean) => ({ startMs, endMs: startMs + 5000, text, interim });
    const w = windowsOf([seg(31_000, 'c'), seg(0, 'a'), seg(10_000, 'b'), seg(12_000, 'x', true), seg(65_000, 'd')]);
    expect(w).toEqual([
      { atMs: 0, endMs: 15_000, text: 'a b' },
      { atMs: 31_000, endMs: 36_000, text: 'c' },
      { atMs: 65_000, endMs: 70_000, text: 'd' },
    ]);
  });
});

// Fake model: words about money share one direction, hiring another.
const TOPICS = [/money|budget|spend|cost/i, /hir|engineer/i];
const embedText = (t: string) => Float32Array.from({ length: 384 }, (_, i) => (i < TOPICS.length ? (TOPICS[i]!.test(t) ? 1 : 0) : i === 383 ? 0.05 : 0));

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  static made = 0;
  constructor() { FakeWorker.made++; }
  postMessage(m: ToWorker) {
    const reply = (data: FromWorker) => queueMicrotask(() => this.onmessage?.({ data } as MessageEvent<FromWorker>));
    if (m.type === 'load') {
      reply({ id: m.id, type: 'progress', loaded: 11, total: 22 });
      reply({ id: m.id, type: 'loaded' });
    } else reply({ id: m.id, type: 'embedded', vectors: m.texts.map(embedText) });
  }
  terminate() {}
}

const meeting = (id: string, title: string): Meeting => ({ id, title, startedAt: 1_000, endedAt: 2_000, status: 'done', language: 'en' });
const segment = (meetingId: string, startMs: number, text: string): Segment =>
  ({ id: `${meetingId}-${startMs}`, meetingId, speaker: 'others', startMs, endMs: startMs + 4_000, text, chunkId: 'c' });

let cached = false;
const fakeCaches = {
  has: async () => cached,
  open: async () => ({ keys: async () => (cached ? [{ url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx' }] : []) }),
  delete: async () => { cached = false; return true; },
};

describe('recall search', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    cached = false;
    FakeWorker.made = 0;
    vi.stubGlobal('caches', fakeCaches);
    setWorkerFactory(() => new FakeWorker());
    await putMeeting(meeting('m-sync', 'Weekly sync'));
    await putMeeting(meeting('m-hire', 'Hiring plan'));
    await putSegment(segment('m-sync', 0, 'We went over the Q4 budget line by line.'));
    await putSegment(segment('m-sync', 40_000, 'Next week we review the roadmap.'));
    await putSegment(segment('m-hire', 0, 'We need two more engineers by March.'));
    await putItem({
      id: 'i-spend', kind: 'decision', status: 'open', text: 'Freeze Q4 spend', meetingId: 'm-sync', personIds: [], history: [],
      quote: { speaker: 'Sam', text: 'Let us freeze the budget for Q4.', meetingId: 'm-sync', atMs: 2_000 }, createdAt: 1, updatedAt: 1,
    } as MemoryItem);
  });
  afterEach(() => {
    setWorkerFactory(undefined);
    vi.unstubAllGlobals();
  });

  it('falls back to keywords without a model and never starts the worker', async () => {
    expect(await modelState()).toBe('none');
    expect(await embedMeeting('m-sync')).toBe(0);
    const r = await search('budget');
    expect(r.mode).toBe('keyword');
    expect(r.items.map((h) => h.item.id)).toEqual(['i-spend']);
    expect(r.meetings.map((h) => h.meeting.title)).toEqual(['Weekly sync']);
    expect((await search('money')).meetings).toEqual([]);
    expect(FakeWorker.made).toBe(0);
  });

  it('downloads once with progress, records one ledger entry, then finds meetings by meaning', async () => {
    const progress = vi.fn();
    expect(await ensureModel(progress)).toBe(true);
    expect(progress).toHaveBeenCalledWith({ loaded: 11, total: 22 });
    cached = true;
    expect(await modelState()).toBe('ready');
    expect(await ensureModel()).toBe(true);
    expect((await listLedger()).map((e) => [e.service, e.count])).toEqual([['huggingface', 1]]);

    expect(await embedMeeting('m-sync')).toBe(2);
    expect(await embedMeeting('m-hire')).toBe(1);
    const rows = await vectorsForMeeting('m-sync');
    expect(rows.map((r) => [r.atMs, r.v.length])).toEqual([[0, 384], [40_000, 384]]);

    const r = await search('money');
    expect(r.mode).toBe('hybrid');
    expect(r.items.map((h) => h.item.id)).toEqual(['i-spend']);
    expect(r.meetings.map((h) => [h.meeting.id, h.atMs])).toEqual([['m-sync', 0]]);
    expect((await search('budget engineers')).meetings.map((h) => h.meeting.id).sort()).toEqual(['m-hire', 'm-sync']);
  });

  it('a second download click joins the first and both get progress', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const [ra, rb] = await Promise.all([ensureModel(a), ensureModel(b)]);
    expect([ra, rb]).toEqual([true, true]);
    expect(a).toHaveBeenCalledWith({ loaded: 11, total: 22 });
    expect(b).toHaveBeenCalledWith({ loaded: 11, total: 22 });
    expect(FakeWorker.made).toBe(1);
    expect(await listLedger()).toHaveLength(1);
  });

  it('stops an idle worker and reloads from the cache without a new ledger entry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await ensureModel();
      cached = true;
      await embedMeeting('m-sync');
      vi.advanceTimersByTime(IDLE_MS + 1);
      expect((await search('money')).mode).toBe('hybrid');
      expect(FakeWorker.made).toBe(2);
      expect(await listLedger()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('remove model deletes the weights and goes back to keywords', async () => {
    await ensureModel();
    cached = true;
    await embedMeeting('m-sync');
    await removeModel();
    expect(await modelState()).toBe('none');
    expect((await search('money')).mode).toBe('keyword');
  });
});
