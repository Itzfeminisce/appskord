import { badgeSender } from '../badge';
import type { RunDeps } from '../exportJob';
import { getMedia } from '../media';
import { send } from '../messages';
import { BUNDLED_TRACKS, bundledAssetId } from '../music';
import type { Asset, Recipe } from '../types';
import { audioParts, mixAudio } from './audio';
import type { FrameWant, FromWorker, ToWorker } from './protocol';

/** An asset's file: OPFS, or for bundled music the copy that ships with the extension. */
export async function readAsset(a: Asset): Promise<Blob | undefined> {
  const file = await getMedia(a.opfsPath).catch(() => undefined);
  if (file) return file;
  const track = BUNDLED_TRACKS.find((t) => bundledAssetId(t.id) === a.id);
  if (!track) return undefined;
  const res = await fetch(browser.runtime.getURL(`/${track.file}` as '/'));
  return res.ok ? res.blob() : undefined;
}

const SEEK_TIMEOUT_MS = 10_000;

/** Workers cannot decode video with a <video> element, so the page seeks one per asset and hands over frames. */
function videoFrames(recipe: Recipe) {
  const videos = new Map<string, Promise<HTMLVideoElement | null>>();
  const open = (a: Asset) => readAsset(a).then((blob) => new Promise<HTMLVideoElement | null>((resolve) => {
    if (!blob) return resolve(null);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(blob);
  }));
  // A broken or stuck file fails the export instead of hanging it.
  const seek = (v: HTMLVideoElement, t: number) => new Promise<void>((resolve, reject) => {
    if (Math.abs(v.currentTime - t) < 0.001) return resolve();
    const end = () => { clearTimeout(timer); v.removeEventListener('seeked', ok); v.removeEventListener('error', bad); };
    const ok = () => { end(); resolve(); };
    const bad = () => { end(); reject(new Error(v.error?.message || 'Could not read a video in the clip')); };
    const timer = setTimeout(() => { end(); reject(new Error('A video in the clip took too long to seek')); }, SEEK_TIMEOUT_MS);
    v.addEventListener('seeked', ok);
    v.addEventListener('error', bad);
    v.currentTime = t;
  });
  return {
    async frames(wants: FrameWant[]): Promise<Record<string, ImageBitmap | null>> {
      const out: Record<string, ImageBitmap | null> = {};
      try {
        for (const w of wants) {
          const a = recipe.assets[w.assetId];
          if (!a) { out[w.assetId] = null; continue; }
          if (!videos.has(a.id)) videos.set(a.id, open(a));
          const v = await videos.get(a.id)!;
          if (!v) { out[w.assetId] = null; continue; }
          await seek(v, Math.max(0, Math.min(w.ms / 1000, (v.duration || 0) - 0.001)));
          out[w.assetId] = await createImageBitmap(v).catch(() => null);
        }
      } catch (error) {
        Object.values(out).forEach((b) => b?.close());
        throw error;
      }
      return out;
    },
    // pause + load after removing src lets Chrome free the decoder now, not at garbage collection.
    close() { for (const p of videos.values()) void p.then((v) => { if (v) { v.pause(); URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); } }); },
  };
}

/** The real export: the render worker, the page's audio mix, the toolbar badge through the service worker. */
export function pageDeps(root: FileSystemDirectoryHandle): RunDeps {
  return {
    root,
    now: () => Date.now(),
    badge: badgeSender((percent) => void send({ type: 'export/progress', percent })),
    mix: (recipe, item) => mixAudio(audioParts(recipe, item.durationMs), item.durationMs / 1000, (id) => (recipe.assets[id] ? readAsset(recipe.assets[id]) : Promise.resolve(undefined))),
    render(recipe, item, audio, hooks) {
      const worker = new Worker(new URL('../../entrypoints/export.worker.ts', import.meta.url), { type: 'module' });
      const video = videoFrames(recipe);
      const tell = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
      let fail: (e: unknown) => void = () => undefined;
      let ended = false;
      const done = new Promise<Blob>((resolve, reject) => {
        fail = reject;
        worker.onmessage = (event: MessageEvent<FromWorker>) => {
          const m = event.data;
          if (m.type === 'encoder') hooks.encoder(m.hardware);
          else if (m.type === 'progress') hooks.progress(m.frame, m.frames, m.tMs, m.preview);
          else if (m.type === 'need') {
            video.frames(m.wants).then((bitmaps) => {
              const list = Object.values(bitmaps).filter((b): b is ImageBitmap => !!b);
              // The worker is gone after Cancel or an error; nobody would close these.
              if (ended) list.forEach((b) => b.close());
              else tell({ type: 'frames', id: m.id, bitmaps }, list);
            }).catch(reject);
          } else if (m.type === 'done') resolve(new Blob([m.buffer], { type: m.mime }));
          else reject(Object.assign(new Error(m.message), { name: m.reason === 'cancelled' ? 'Cancelled' : m.name, reason: m.reason }));
        };
        worker.onerror = (e) => reject(new Error(e.message || 'The render worker stopped'));
      }).finally(() => { ended = true; worker.terminate(); video.close(); });
      tell({ type: 'start', recipe, item, audio });
      return {
        done,
        cancel() { tell({ type: 'cancel' }); fail(Object.assign(new Error('Export cancelled'), { name: 'Cancelled' })); },
      };
    },
  };
}
