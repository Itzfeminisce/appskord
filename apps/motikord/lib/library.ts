import { brandPaths } from './brand';
import { deleteClip, getBrandKit, listClips, putClip, updateClip } from './db';
import { deleteMedia, getMedia, mediaSize } from './media';
import { MediaCache } from './render/cache';
import { drawFrame } from './render/drawFrame';
import type { Asset, Clip, ClipType } from './types';

export type TypeFilter = ClipType | 'all';

/** Clips whose name or prompt contains the words typed, ignoring case; `type` narrows by clip type. Order is kept. */
export function filterClips(clips: Clip[], query: string, type: TypeFilter = 'all'): Clip[] {
  const q = query.trim().toLowerCase();
  return clips.filter((c) => (type === 'all' || c.recipe.type === type)
    && (q === '' || c.recipe.name.toLowerCase().includes(q) || (c.recipe.prompt ?? '').toLowerCase().includes(q)));
}

/** Most recently changed first; does not change the input. */
export const sortClips = (clips: Clip[]): Clip[] => [...clips].sort((a, b) => b.updatedAt - a.updatedAt);

/** A copy with a new id (clip and recipe) and the name “<name> copy”. Assets stay shared; the copy has not been exported. */
export function duplicateClip(clip: Clip, id: string, now: number): Clip {
  const recipe = structuredClone(clip.recipe);
  recipe.id = id;
  recipe.name = `${clip.recipe.name} copy`;
  const copy: Clip = { id, recipe, history: structuredClone(clip.history), createdAt: now, updatedAt: now };
  if (clip.thumbnail) {
    copy.thumbnail = clip.thumbnail;
    const key = (clip as { thumbnailKey?: string }).thumbnailKey;
    if (key) (copy as { thumbnailKey?: string }).thumbnailKey = key;
  }
  return copy;
}

/** OPFS paths of the clip's assets that no other clip and not the brand kit uses, so they are safe to delete with it. */
export function exclusivePaths(clip: Clip, others: Clip[], keep: string[] = []): string[] {
  const used = new Set(keep);
  for (const p of others.filter((c) => c.id !== clip.id).flatMap((c) => Object.values(c.recipe.assets).map((a: Asset) => a.opfsPath))) used.add(p);
  return [...new Set(Object.values(clip.recipe.assets).map((a) => a.opfsPath))].filter((p) => !used.has(p));
}

/** Every distinct OPFS path the clips use; a file shared by two clips is counted once. */
export const mediaPaths = (clips: Clip[]): string[] => [...new Set(clips.flatMap((c) => Object.values(c.recipe.assets).map((a) => a.opfsPath)))];

/** Bytes IndexedDB holds for the clips when the browser does not say: thumbnails plus recipes and history as text. */
export const clipRowBytes = (clips: Clip[]): number =>
  clips.reduce((sum, c) => sum + (c.thumbnail?.size ?? 0) + JSON.stringify(c.recipe).length + JSON.stringify(c.history).length, 0);

export const spaceUsed = (mediaBytes: number, databaseBytes: number): number => mediaBytes + databaseBytes;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** “4 clips · 210 MB on this computer, with their media” */
export const footerText = (count: number, bytes: number): string =>
  `${count} ${count === 1 ? 'clip' : 'clips'} · ${formatBytes(bytes)} on this computer, with their media`;

/** “Today”, “Yesterday”, else “Oct 24”. */
export function clipDate(at: number, now = Date.now()): string {
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

/** The name the person typed, or undefined when it is empty or unchanged (so nothing is saved). */
export function cleanName(typed: string, current: string): string | undefined {
  const name = typed.trim().replace(/\s+/g, ' ');
  return name === '' || name === current ? undefined : name;
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `clip-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface LibraryDeps {
  list: () => Promise<Clip[]>;
  put: (clip: Clip) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeMedia: (path: string) => Promise<void>;
  size: (path: string) => Promise<number>;
  brandPaths: () => Promise<string[]>;
  databaseEstimate: () => Promise<number | undefined>;
  id: () => string;
  now: () => number;
}
export const libraryDeps: LibraryDeps = {
  list: listClips, put: putClip, remove: deleteClip, removeMedia: (p) => deleteMedia(p), size: (p) => mediaSize(p), brandPaths: async () => brandPaths(await getBrandKit()), id: newId, now: Date.now,
  databaseEstimate: async () => ((await navigator.storage?.estimate?.()) as { usageDetails?: { indexedDB?: number } } | undefined)?.usageDetails?.indexedDB,
};

export async function duplicate(clip: Clip, deps: LibraryDeps = libraryDeps): Promise<Clip> {
  const copy = duplicateClip(clip, deps.id(), deps.now());
  await deps.put(copy);
  return copy;
}

/** Removes the clip, then the media only it used. Exported videos in the user's folder are never touched. */
export async function removeClip(id: string, deps: LibraryDeps = libraryDeps): Promise<void> {
  const all = await deps.list();
  const clip = all.find((c) => c.id === id);
  if (!clip) return;
  const keep = await deps.brandPaths();
  await deps.remove(id);
  for (const path of exclusivePaths(clip, all, keep)) {
    try { await deps.removeMedia(path); } catch (error) { console.error('Motikord: could not delete a clip’s media', error); }
  }
}

/** Space the clips use on this computer: their OPFS media plus what IndexedDB holds for them. */
export async function measureSpace(clips: Clip[], deps: LibraryDeps = libraryDeps): Promise<number> {
  const sizes = await Promise.all(mediaPaths(clips).map((p) => deps.size(p).catch(() => 0)));
  const database = (await deps.databaseEstimate().catch(() => undefined)) ?? clipRowBytes(clips);
  return spaceUsed(sizes.reduce((a, b) => a + b, 0), database);
}

/** Draws the clip's first moments small and keeps the picture on the clip (without touching its updatedAt). */
export async function makeThumbnail(clip: Clip, height = 240): Promise<Blob | undefined> {
  const first = clip.recipe.scenes[0];
  if (!first) return undefined;
  const ratio = clip.recipe.aspect === '9:16' ? 9 / 16 : clip.recipe.aspect === '1:1' ? 1 : 16 / 9;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(height * ratio);
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  const cache = new MediaCache({ read: async (asset) => getMedia(asset.opfsPath) });
  await cache.load(clip.recipe);
  drawFrame(ctx, clip.recipe, clip.recipe.aspect, Math.min(1800, first.durationMs - 1), cache);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.8));
}

type Stored = Clip & { thumbnailKey?: string };

/** A cheap fingerprint of what the picture shows (not the name), kept beside the stored thumbnail. */
export function thumbnailKey(clip: Clip): string {
  const text = JSON.stringify([clip.recipe.aspect, clip.recipe.scenes, clip.recipe.assets]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${text.length}-${(h >>> 0).toString(36)}`;
}

/** Runs at most `max` jobs at once; the rest wait in order. */
export function queue(max: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  const next = () => { running--; waiting.shift()?.(); };
  return <T>(job: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const start = () => { running++; job().then(resolve, reject).finally(next); };
    if (running < max) start(); else waiting.push(start);
  });
}
const thumbnailQueue = queue(2);

/** The stored picture when it still matches the recipe; else a new one, kept on the clip (two at a time). */
export function ensureThumbnail(clip: Clip, signal?: AbortSignal): Promise<Blob | undefined> {
  const key = thumbnailKey(clip);
  if (clip.thumbnail && (clip as Stored).thumbnailKey === key) return Promise.resolve(clip.thumbnail);
  return thumbnailQueue(async () => {
    if (signal?.aborted) return undefined;
    const thumbnail = await makeThumbnail(clip).catch(() => undefined);
    await updateClip(clip.id, (c) => {
      if (thumbnailKey(c) !== key) return null;
      if ((c as Stored).thumbnailKey === key && c.thumbnail) return null;
      return thumbnail ? { thumbnail, thumbnailKey: key } as Partial<Clip> : { thumbnail: undefined, thumbnailKey: undefined } as Partial<Clip>;
    });
    return thumbnail;
  });
}
