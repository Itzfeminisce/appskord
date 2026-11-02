import { describe, expect, it, vi } from 'vitest';
import type { Picture } from './layers/scene';
import { cameraMasks, EXPORT_SEGMENT, PREVIEW_SEGMENT, workerSegmenter, type Segmented, type Segmenter } from './segment';

/** A stand-in bitmap: width, height and close are all the code under test touches. */
const bitmap = (w = 256, h = 144) => ({ width: w, height: h, close: vi.fn() }) as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
const camera = { width: 640, height: 360 } as unknown as Picture;

function fakeSegmenter() {
  const pending: { resolve: () => void; mask: ImageBitmap }[] = [];
  const sizes: [number, number][] = [];
  const close = vi.fn();
  const segmenter: Segmenter = {
    segment: vi.fn((picture: ImageBitmap): Promise<Segmented> => {
      sizes.push([picture.width, picture.height]);
      const mask = bitmap(picture.width, picture.height);
      return new Promise((resolve) => pending.push({ mask, resolve: () => resolve({ mask, ms: 20, delegate: 'CPU' }) }));
    }),
    close,
  };
  const finish = async () => {
    for (const p of pending.splice(0)) p.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { segmenter, close, pending, sizes, finish };
}
const scale = vi.fn(async (_p: Picture, w: number, h: number) => bitmap(w, h));

describe('cameraMasks in preview', () => {
  it('waits for the first mask at the small size, then reuses it within one preview frame', async () => {
    const f = fakeSegmenter();
    const masks = cameraMasks(f.segmenter, { ...PREVIEW_SEGMENT, scale });
    const first = masks.cameraMask(camera, 'cam', 1000);
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    expect(f.sizes[0]).toEqual([256, 144]);
    await f.finish();
    const mask = await first;
    expect(mask).toBeTruthy();
    expect(await masks.cameraMask(camera, 'cam', 1050)).toBe(mask);
    expect(f.segmenter.segment).toHaveBeenCalledTimes(1);
    expect(masks.stats()).toEqual({ frames: 1, fps: 50, delegate: 'CPU' });
  });

  it('keeps showing the last mask while the next one is made in the background, then asks for a redraw', async () => {
    const f = fakeSegmenter();
    const onMask = vi.fn();
    const masks = cameraMasks(f.segmenter, { ...PREVIEW_SEGMENT, scale, onMask });
    const first = masks.cameraMask(camera, 'cam', 0);
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    await f.finish();
    const old = await first;
    expect(await masks.cameraMask(camera, 'cam', 150)).toBe(old);
    expect(await masks.cameraMask(camera, 'cam', 180)).toBe(old);
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    await f.finish();
    expect(onMask).toHaveBeenCalledTimes(1);
    expect(await masks.cameraMask(camera, 'cam', 160)).not.toBe(old);
  });

  it('dates a mask by the frame it was made from, not the frames asked for meanwhile', async () => {
    const f = fakeSegmenter();
    const masks = cameraMasks(f.segmenter, { ...PREVIEW_SEGMENT, scale });
    const a = masks.cameraMask(camera, 'cam', 0);
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    await f.finish();
    const old = await a;
    expect(await masks.cameraMask(camera, 'cam', 150)).toBe(old);
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    // The shown mask is still of frame 0, so frame 1050 is past the jump and waits for its own mask.
    const far = masks.cameraMask(camera, 'cam', 1050);
    await f.finish();
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    await f.finish();
    expect(await far).not.toBe(old);
    expect(f.segmenter.segment).toHaveBeenCalledTimes(3);
  });

  it('lets the segmenter go on release and starts again on the next blurred frame', async () => {
    const f = fakeSegmenter();
    const masks = cameraMasks(f.segmenter, { ...PREVIEW_SEGMENT, scale });
    const a = masks.cameraMask(camera, 'cam', 0);
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    await f.finish();
    const old = (await a) as ReturnType<typeof bitmap>;
    masks.release();
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(old.close).toHaveBeenCalled();
    const b = masks.cameraMask(camera, 'cam', 50);
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    await f.finish();
    expect(await b).toBeTruthy();
  });

  it('waits for a fresh mask after a seek', async () => {
    const f = fakeSegmenter();
    const masks = cameraMasks(f.segmenter, { ...PREVIEW_SEGMENT, scale });
    const a = masks.cameraMask(camera, 'cam', 0);
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    await f.finish();
    const old = await a;
    let done = false;
    const b = Promise.resolve(masks.cameraMask(camera, 'cam', 30_000)).then((m) => { done = true; return m; });
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    expect(done).toBe(false);
    await f.finish();
    expect(await b).not.toBe(old);
  });
});

describe('cameraMasks in export', () => {
  it('makes a sharper mask for every frame and closes them all on dispose', async () => {
    const f = fakeSegmenter();
    const masks = cameraMasks(f.segmenter, { ...EXPORT_SEGMENT, scale });
    const got: (Picture | null)[] = [];
    for (const t of [0, 33, 67]) {
      const m = masks.cameraMask(camera, 'cam', t);
      await vi.waitFor(() => expect(f.pending).toHaveLength(1));
      await f.finish();
      got.push(await m);
    }
    expect(new Set(got).size).toBe(3);
    expect(f.sizes).toEqual([[512, 288], [512, 288], [512, 288]]);
    expect(await masks.cameraMask(camera, 'cam', 67)).toBe(got[2]);
    masks.dispose();
    expect((got[2] as ReturnType<typeof bitmap>).close).toHaveBeenCalled();
    expect(f.close).toHaveBeenCalled();
    expect(await masks.cameraMask(camera, 'cam', 100)).toBeNull();
  });
});

describe('workerSegmenter', () => {
  function fakeWorker() {
    const listeners: ((e: MessageEvent) => void)[] = [];
    const posted: unknown[] = [];
    const worker = {
      addEventListener: (type: string, l: (e: MessageEvent) => void) => type === 'message' && listeners.push(l),
      postMessage: vi.fn((m: unknown) => posted.push(m)),
      terminate: vi.fn(),
    };
    const answer = (data: unknown) => listeners.forEach((l) => l({ data } as MessageEvent));
    return { worker, posted, answer };
  }

  it('starts the worker on the first picture and matches answers to requests', async () => {
    const w = fakeWorker();
    const make = vi.fn(() => w.worker as unknown as Worker);
    const s = workerSegmenter(make);
    expect(make).not.toHaveBeenCalled();
    const pic = bitmap();
    const a = s.segment(pic);
    const b = s.segment(bitmap());
    expect(make).toHaveBeenCalledTimes(1);
    expect(w.worker.postMessage).toHaveBeenCalledWith({ type: 'segment', id: 1, picture: pic }, [pic]);
    const mask = bitmap();
    w.answer({ type: 'error', id: 2, message: 'no model' });
    w.answer({ type: 'mask', id: 1, mask, ms: 12, delegate: 'GPU' });
    expect(await a).toEqual({ mask, ms: 12, delegate: 'GPU' });
    await expect(b).rejects.toThrow('no model');
  });

  it('close asks the worker to let go, then ends it', () => {
    const w = fakeWorker();
    const s = workerSegmenter(() => w.worker as unknown as Worker);
    void s.segment(bitmap()).catch(() => {});
    s.close();
    expect(w.posted.at(-1)).toEqual({ type: 'close' });
    w.answer({ type: 'closed' });
    expect(w.worker.terminate).toHaveBeenCalledTimes(1);
  });
});
