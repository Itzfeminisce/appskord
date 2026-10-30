import { record } from '../editor/history';
import type { Edit } from '../editor/store';
import { getClip, updateClip } from '../db';
import { mediaPath, putMedia } from '../media';
import type { Asset, Author, Layer, Recipe } from '../types';
import type { FetchLike, MediaResult } from './openverse';

/** The file could not be fetched or kept; the screen shows media-download-failed. */
export class DownloadError extends Error {
  constructor(message: string) { super(message); this.name = 'DownloadError'; }
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac',
};
export const MAX_BYTES = 200 * 1024 * 1024;
const TOO_BIG = 'The file is empty or too large.';

export interface DownloadDeps { fetch: FetchLike; put?: (path: string, data: Blob) => Promise<void>; id?: string; maxBytes?: number; signal?: AbortSignal }

/** Reads the body with a running byte count and cancels the moment it passes the cap; Content-Length is checked first. */
async function readCapped(res: Response, max: number): Promise<Blob> {
  const type = res.headers.get('content-type') ?? '';
  const declared = Number(res.headers.get('content-length'));
  if (declared > max) { await res.body?.cancel().catch(() => undefined); throw new DownloadError(TOO_BIG); }
  if (!res.body) {
    const blob = await res.blob();
    if (blob.size > max) throw new DownloadError(TOO_BIG);
    return blob;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => undefined); throw new DownloadError(TOO_BIG); }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], { type });
}

/** Downloads the file once into OPFS and returns its Asset with a full Credit. Nothing is kept when the download fails. */
export async function downloadResult(r: MediaResult, deps: DownloadDeps): Promise<Asset> {
  let res: Response;
  try {
    res = await deps.fetch(r.downloadUrl, { credentials: 'omit', signal: deps.signal });
  } catch {
    throw new DownloadError('The site that hosts it did not send the file.');
  }
  if (!res.ok) throw new DownloadError(`The site answered ${res.status}.`);
  let blob: Blob;
  try {
    blob = await readCapped(res, deps.maxBytes ?? MAX_BYTES);
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    throw new DownloadError('The site that hosts it did not send the file.');
  }
  if (blob.size === 0) throw new DownloadError(TOO_BIG);
  const mime = (blob.type || r.mime || '').split(';')[0]!.trim();
  const id = deps.id ?? crypto.randomUUID();
  const opfsPath = mediaPath(id, EXT[mime] ?? '');
  try {
    await (deps.put ?? putMedia)(opfsPath, blob);
  } catch (error) {
    console.error('Motikord: could not keep the downloaded file', error);
    throw new DownloadError('The file could not be kept on this computer.');
  }
  return {
    id, kind: r.kind, name: r.title, mime, bytes: blob.size, opfsPath,
    width: r.width, height: r.height, durationMs: r.durationMs,
    credit: { title: r.title, author: r.author, source: r.source, url: r.pageUrl, licence: r.licence, licenceUrl: r.licenceUrl },
  };
}

/** One Change: the asset with its credit, and a full-frame layer behind the scene's other layers. */
export function addMediaEdit(r: Recipe, sceneId: string, asset: Asset, layerId: string): Edit | undefined {
  const si = r.scenes.findIndex((s) => s.id === sceneId);
  const scene = r.scenes[si];
  if (!scene || (asset.kind !== 'image' && asset.kind !== 'video')) return undefined;
  const layer: Layer = {
    id: layerId, name: asset.kind === 'image' ? 'Photo' : 'Video', type: asset.kind, assetId: asset.id, fit: 'cover', muted: asset.kind === 'video' ? true : undefined,
    startMs: 0, endMs: scene.durationMs, opacity: 1, box: { x: 0, y: 0, w: 1, h: 1 },
  };
  return {
    summary: `Added ${asset.name}`,
    ops: [{ op: 'add', path: `/assets/${asset.id}`, value: asset }, { op: 'add', path: `/scenes/${si}/layers/0`, value: layer }],
  };
}

/** Records an edit on a stored clip from a screen that is not the editor (the editor reads it back when it opens). Returns false when the clip is gone or the edit does not apply. */
export async function commitEdit(clipId: string, edit: Edit, by: Author = 'hand'): Promise<boolean> {
  let ok = false;
  try {
    await updateClip(clipId, (clip) => {
      try {
        const at = Date.now();
        const out = record(clip.recipe, { past: clip.history, future: [] }, edit.ops, { by, summary: edit.summary, at, id: crypto.randomUUID(), mergeKey: edit.mergeKey });
        ok = true;
        return { recipe: out.doc, history: out.history.past, updatedAt: at };
      } catch (error) {
        console.error('Motikord: could not apply an edit', error);
        return null;
      }
    });
  } catch (error) {
    console.error('Motikord: could not save the clip', error);
  }
  return ok;
}

export const readClipRecipe = async (clipId: string): Promise<Recipe | undefined> => (await getClip(clipId))?.recipe;
