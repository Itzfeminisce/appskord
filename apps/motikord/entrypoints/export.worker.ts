import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { encodeAudio, pickAudioCodec } from '@/lib/encode/audio';
import { gifWriter } from '@/lib/encode/gif';
import { mp4Muxer } from '@/lib/encode/mp4';
import type { FrameWant, FromWorker, ToWorker } from '@/lib/encode/protocol';
import { Cancelled, pickVideoConfig, runFrames, Unsupported, videoTrack, type Muxed } from '@/lib/encode/video';
import { webmMuxer } from '@/lib/encode/webm';
import type { RenderItem } from '@/lib/exportPlan';
import { getMedia } from '@/lib/media';
import { MediaCache } from '@/lib/render/cache';
import { activeLayers, drawFrame, sceneAt } from '@/lib/render/drawFrame';
import type { Recipe } from '@/lib/types';

// Render worker: draws every frame with drawFrame on an OffscreenCanvas and encodes it, so the editor stays responsive.
const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let cancelled = false;
let nextId = 1;
const waiting = new Map<number, (b: Record<string, ImageBitmap | null>) => void>();

/** Video frames come from the page, which decodes them with a video element; each holder keeps the latest one. */
function holders(recipe: Recipe, cache: MediaCache) {
  const latest = new Map<string, ImageBitmap>();
  for (const a of Object.values(recipe.assets)) if (a.kind === 'video') cache.setVideo(a.id, { frameAt: () => latest.get(a.id), close: () => latest.get(a.id)?.close() });
  return async (tMs: number) => {
    const at = sceneAt(recipe, tMs);
    if (!at) return;
    const wants: FrameWant[] = activeLayers(at.scene, at.localMs).flatMap((l) => (l.type === 'video' ? [{ assetId: l.assetId, ms: at.localMs - l.startMs }] : []));
    if (!wants.length) return;
    const id = nextId++;
    const bitmaps = await new Promise<Record<string, ImageBitmap | null>>((resolve) => { waiting.set(id, resolve); post({ type: 'need', id, wants }); });
    for (const [assetId, b] of Object.entries(bitmaps)) {
      latest.get(assetId)?.close();
      if (b) latest.set(assetId, b); else latest.delete(assetId);
    }
  };
}

async function preview(canvas: OffscreenCanvas): Promise<ImageBitmap | undefined> {
  const k = 640 / Math.max(canvas.width, canvas.height);
  return createImageBitmap(canvas, { resizeWidth: Math.round(canvas.width * k), resizeHeight: Math.round(canvas.height * k), resizeQuality: 'low' }).catch(() => undefined);
}

async function render(recipe: Recipe, item: RenderItem, audio: Extract<ToWorker, { type: 'start' }>['audio']) {
  const cache = new MediaCache({ read: (a) => getMedia(a.opfsPath) });
  await cache.load(recipe);
  const prepare = holders(recipe, cache);
  const canvas = new OffscreenCanvas(item.width, item.height);
  const gif = item.kind === 'gif';
  const ctx = canvas.getContext('2d', { alpha: item.seeThrough || gif, willReadFrequently: gif })!;
  let lastPreview = 0;
  const progress = async (frame: number, frames: number, tMs: number) => {
    const now = performance.now();
    // A preview frame every half second is enough to see the export moving.
    const pic = now - lastPreview > 500 ? await preview(canvas) : undefined;
    if (pic) lastPreview = now;
    post({ type: 'progress', frame, frames, tMs, preview: pic }, pic ? [pic] : []);
  };
  const base = { frames: item.frames, fps: item.fps, cancelled: () => cancelled, prepare: (_i: number, t: number) => prepare(t), draw: (_i: number, t: number) => drawFrame(ctx, recipe, item.aspect, t, cache, { seeThrough: item.seeThrough }), progress: (f: number, n: number, t: number) => void progress(f, n, t) };

  try {
    if (gif) {
      const out = gifWriter(item.width, item.height, item.fps);
      await runFrames({ ...base, encode: () => out.add(ctx.getImageData(0, 0, item.width, item.height).data) });
      const bytes = out.finish();
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      post({ type: 'done', buffer, mime: 'image/gif' }, [buffer]);
      return;
    }
    const kind = item.kind as Exclude<RenderItem['kind'], 'gif'>;
    const picked = await pickVideoConfig({ kind, width: item.width, height: item.height, fps: item.fps, bitrate: item.bitrate }, (c) => VideoEncoder.isConfigSupported(c));
    if (!picked) throw new Unsupported(item.label);
    post({ type: 'encoder', hardware: picked.hardware });
    const sound = audio && typeof AudioEncoder !== 'undefined' ? await pickAudioCodec(kind === 'mp4' ? 'mp4' : 'webm', (c) => AudioEncoder.isConfigSupported(c)) : null;
    if (audio && !sound) throw new Unsupported('Audio');
    const mux: Muxed = kind === 'mp4'
      ? mp4Muxer(item.width, item.height, item.fps, sound ?? undefined)
      : webmMuxer(item.width, item.height, item.fps, item.seeThrough, sound ?? undefined);
    // Sound first: it is small, so the muxers hold it while the video chunks arrive in order.
    if (audio && sound) await encodeAudio(audio, sound, mux);
    const track = videoTrack(picked.config, mux);
    try {
      const frameUs = 1e6 / item.fps;
      await runFrames({ ...base, encode: (i) => track.add(new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) }), i) });
      await track.done();
    } catch (error) {
      track.close();
      throw error;
    }
    const buffer = mux.finish();
    post({ type: 'done', buffer, mime: mux.mime }, [buffer]);
  } finally {
    cache.dispose();
  }
}

function listen() {
  self.onmessage = (event: MessageEvent<ToWorker>) => {
    const m = event.data;
    if (m.type === 'cancel') { cancelled = true; return; }
    if (m.type === 'frames') { waiting.get(m.id)?.(m.bitmaps); waiting.delete(m.id); return; }
    render(m.recipe, m.item, m.audio).catch((error: unknown) => {
      const e = error as { name?: string; message?: string };
      const reason = error instanceof Cancelled ? 'cancelled' : error instanceof Unsupported ? 'unsupported' : 'failed';
      post({ type: 'error', reason, name: e?.name ?? 'Error', message: e?.message ?? String(error) });
    });
  };
}

// Vite bundles this as the editor's module worker (new Worker(new URL(...))); WXT must not build it as a script of its own.
export default defineUnlistedScript({ include: ['vite-worker'], main: listen });
if ('WorkerGlobalScope' in globalThis) listen();
