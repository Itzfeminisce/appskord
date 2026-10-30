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
  const seek = (v: HTMLVideoElement, t: number) => new Promise<void>((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.001) return resolve();
    v.addEventListener('seeked', () => resolve(), { once: true });
    v.currentTime = t;
  });
  return {
    async frames(wants: FrameWant[]): Promise<Record<string, ImageBitmap | null>> {
      const out: Record<string, ImageBitmap | null> = {};
      for (const w of wants) {
        const a = recipe.assets[w.assetId];
        if (!a) { out[w.assetId] = null; continue; }
        if (!videos.has(a.id)) videos.set(a.id, open(a));
        const v = await videos.get(a.id)!;
        if (!v) { out[w.assetId] = null; continue; }
        await seek(v, Math.max(0, Math.min(w.ms / 1000, (v.duration || 0) - 0.001)));
        out[w.assetId] = await createImageBitmap(v).catch(() => null);
      }
      return out;
    },
    close() { for (const p of videos.values()) void p.then((v) => { if (v) { URL.revokeObjectURL(v.src); v.removeAttribute('src'); } }); },
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
      const done = new Promise<Blob>((resolve, reject) => {
        fail = reject;
        worker.onmessage = (event: MessageEvent<FromWorker>) => {
          const m = event.data;
          if (m.type === 'encoder') hooks.encoder(m.hardware);
          else if (m.type === 'progress') hooks.progress(m.frame, m.frames, m.tMs, m.preview);
          else if (m.type === 'need') {
            void video.frames(m.wants).then((bitmaps) => tell({ type: 'frames', id: m.id, bitmaps }, Object.values(bitmaps).filter((b): b is ImageBitmap => !!b)));
          } else if (m.type === 'done') resolve(new Blob([m.buffer], { type: m.mime }));
          else reject(Object.assign(new Error(m.message), { name: m.reason === 'cancelled' ? 'Cancelled' : m.name, reason: m.reason }));
        };
        worker.onerror = (e) => reject(new Error(e.message || 'The render worker stopped'));
      }).finally(() => { worker.terminate(); video.close(); });
      tell({ type: 'start', recipe, item, audio });
      return {
        done,
        cancel() { tell({ type: 'cancel' }); fail(Object.assign(new Error('Export cancelled'), { name: 'Cancelled' })); },
      };
    },
  };
}
