import { isVideoFrame, pictureSize, type Picture } from './layers/scene';
import type { CameraMask } from './renderer';
import type { Delegate, SegmentRequest, SegmentResponse } from './segment.worker';

export type { Delegate } from './segment.worker';

/** How sharp and how often the person mask is made. `fps` 0: on every frame. */
export interface MaskQuality { width: number; fps: number }

/** Preview: a small mask a few times a second, the camera bubble is small and the CPU is shared with decoding. */
export const PREVIEW_SEGMENT: MaskQuality = { width: 256, fps: 10 };
/** Export: a sharper mask for every frame. */
export const EXPORT_SEGMENT: MaskQuality = { width: 512, fps: 0 };

export interface Segmented { mask: ImageBitmap; ms: number; delegate: Delegate }

/** The person finder; the worker one in the app, a fake in tests. It takes the picture it is given. */
export interface Segmenter {
  segment(picture: ImageBitmap): Promise<Segmented>;
  close(): void;
}

/** How long close() waits for the worker to let go of the model before ending it. */
const CLOSE_WAIT_MS = 500;

/** MediaPipe in its own worker, started on the first picture so the editor opens without it. */
export function workerSegmenter(make: () => Worker): Segmenter {
  let worker: Worker | null = null;
  let id = 0;
  const waiting = new Map<number, { resolve: (s: Segmented) => void; reject: (e: Error) => void }>();
  const failAll = (error: Error) => {
    for (const w of waiting.values()) w.reject(error);
    waiting.clear();
  };
  const start = () => {
    const w = make();
    w.addEventListener('message', (event: MessageEvent<SegmentResponse>) => {
      const reply = event.data;
      if (reply.type === 'closed') return;
      const pending = waiting.get(reply.id);
      waiting.delete(reply.id);
      if (reply.type === 'mask') {
        if (pending) pending.resolve({ mask: reply.mask, ms: reply.ms, delegate: reply.delegate });
        else reply.mask.close();
      } else pending?.reject(new Error(reply.message));
    });
    w.addEventListener('error', (event) => failAll(new Error(event.message || 'The segmentation worker stopped')));
    return w;
  };
  return {
    segment(picture) {
      worker ??= start();
      const n = ++id;
      const w = worker;
      return new Promise<Segmented>((resolve, reject) => {
        waiting.set(n, { resolve, reject });
        w.postMessage({ type: 'segment', id: n, picture } satisfies SegmentRequest, [picture]);
      });
    },
    close() {
      failAll(new Error('Segmentation closed'));
      const w = worker;
      worker = null;
      if (!w) return;
      const end = () => {
        clearTimeout(timer);
        w.terminate();
      };
      const timer = setTimeout(end, CLOSE_WAIT_MS);
      w.addEventListener('message', (event: MessageEvent<SegmentResponse>) => {
        if (event.data.type === 'closed') end();
      });
      w.postMessage({ type: 'close' } satisfies SegmentRequest);
    },
  };
}

/** Scales a camera picture to the mask size; injectable because tests have no createImageBitmap. */
export type Scale = (picture: Picture, width: number, height: number) => Promise<ImageBitmap>;

const defaultScale: Scale = (picture, width, height) =>
  createImageBitmap(picture, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' });

export interface MaskOptions extends MaskQuality {
  /** In preview, a jump further than this (source ms) waits for a fresh mask; nearer, the last one shows meanwhile. */
  jumpMs?: number;
  /** Called when a mask made in the background is ready, so a paused preview can draw again. */
  onMask?: () => void;
  scale?: Scale;
}

export interface MaskStats { frames: number; fps: number; delegate: Delegate | null }

export interface CameraMasks {
  /** The renderer's `cameraMask` hook. */
  cameraMask: CameraMask;
  /** Masks made so far and how fast the model ran on them. */
  stats(): MaskStats;
  /** Closes the masks it holds and the segmenter. */
  dispose(): void;
}

interface Held { mask: ImageBitmap | null; old: ImageBitmap | null; t: number; running: Promise<void> | null }

const DEFAULT_JUMP_MS = 1000;

/**
 * The person mask per camera source. Preview (`fps` > 0) makes one at most every 1000/fps ms of video and shows the
 * last one meanwhile; export (`fps` 0) waits for a mask of every frame.
 */
export function cameraMasks(segmenter: Segmenter, options: MaskOptions): CameraMasks {
  const scale = options.scale ?? defaultScale;
  const jump = options.jumpMs ?? DEFAULT_JUMP_MS;
  const every = options.fps > 0 ? 1000 / options.fps : 0;
  const held = new Map<string, Held>();
  let frames = 0;
  let modelMs = 0;
  let delegate: Delegate | null = null;
  let disposed = false;

  const run = (h: Held, camera: Picture, t: number): Promise<void> => {
    // The renderer may close its frame before the copy is scaled; a clone keeps it alive until then.
    const own = isVideoFrame(camera) ? camera.clone() : camera;
    const size = pictureSize(own, { w: 0, h: 0 });
    const width = Math.max(1, Math.min(options.width, size.w));
    const height = Math.max(1, Math.round((width * size.h) / Math.max(1, size.w)));
    h.t = t;
    const job = scale(own, width, height)
      .finally(() => {
        if (own !== camera && isVideoFrame(own)) own.close();
      })
      .then((small) => segmenter.segment(small))
      .then((done) => {
        if (disposed) {
          done.mask.close();
          return;
        }
        frames++;
        modelMs += done.ms;
        delegate = done.delegate;
        // The one before stays open a step longer in case a draw still holds it.
        h.old?.close();
        h.old = h.mask;
        h.mask = done.mask;
      })
      .finally(() => {
        if (h.running === job) h.running = null;
      });
    h.running = job;
    return job;
  };

  const cameraMask: CameraMask = async (camera, source, t) => {
    if (disposed) return null;
    let h = held.get(source);
    if (!h) {
      h = { mask: null, old: null, t: Number.NaN, running: null };
      held.set(source, h);
    }
    const off = Math.abs(t - h.t);
    if (h.mask && (every === 0 ? off === 0 : off < every)) return h.mask;
    if (every > 0 && h.mask && off <= jump) {
      if (!h.running) {
        void run(h, camera, t).then(() => options.onMask?.(), (error: unknown) => {
          console.error('Klipkord: could not find the person for camera blur', error);
        });
      }
      return h.mask;
    }
    if (h.running) await h.running.catch(() => {});
    if (!h.mask || Math.abs(t - h.t) > (every || 0)) await run(h, camera, t);
    return h.mask;
  };

  return {
    cameraMask,
    stats: () => ({ frames, fps: modelMs > 0 ? Math.round((frames / modelMs) * 10_000) / 10 : 0, delegate }),
    dispose() {
      disposed = true;
      for (const h of held.values()) {
        h.mask?.close();
        h.old?.close();
      }
      held.clear();
      segmenter.close();
    },
  };
}

/** For the export path: masks on every frame from a segmentation worker it makes on first use. */
export function exportCameraMasks(makeWorker: () => Worker): CameraMasks {
  return cameraMasks(workerSegmenter(makeWorker), EXPORT_SEGMENT);
}
