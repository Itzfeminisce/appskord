import { getBrandKit, putBrandKit } from './db';
import { mediaPath, putMedia } from './media';
import type { Asset } from './types';

// Your own files: kept in OPFS and listed here for later clips. They carry no credit.
const STORE_KEY = 'yourMedia';

export type MediaKind = Asset['kind'];
export type MediaProblem = 'media-unsupported' | 'video-wont-play';
export interface Rejected { name: string; problem: MediaProblem }
export interface Probe { width?: number; height?: number; durationMs?: number }

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'ogv'];
const AUDIO_EXT = ['mp3', 'wav'];
const FONT_EXT = ['ttf', 'otf', 'woff2'];

const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
const stem = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name);

/** What a file is, or undefined when Motikord cannot use it. SVG files and pictures named "logo" are logos. */
export function classifyFile(file: Pick<File, 'name' | 'type'>): MediaKind | undefined {
  const ext = extOf(file.name);
  if (ext === 'svg' || file.type === 'image/svg+xml') return 'logo';
  if (IMAGE_EXT.includes(ext) || ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return /logo/i.test(file.name) ? 'logo' : 'image';
  if (VIDEO_EXT.includes(ext) || file.type.startsWith('video/')) return 'video';
  if (AUDIO_EXT.includes(ext) || ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'].includes(file.type)) return 'audio';
  if (FONT_EXT.includes(ext) || /^(font\/|application\/font)/.test(file.type)) return 'font';
  return undefined;
}

export interface MediaDeps {
  put(path: string, data: Blob): Promise<void>;
  probe(file: File, kind: MediaKind): Promise<Probe>;
  loadFont(family: string, data: Blob): Promise<void>;
  addToBrandKit(asset: Asset): Promise<void>;
  read(): Promise<Asset[]>;
  write(items: Asset[]): Promise<void>;
  id(): string;
}

/** Loads the file in a media element; rejects when Chrome cannot play or decode it. */
function loadElement<T extends HTMLImageElement | HTMLVideoElement | HTMLAudioElement>(el: T, file: File, ready: 'load' | 'loadedmetadata'): Promise<T> {
  const url = URL.createObjectURL(file);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    el.addEventListener(ready, () => { clearTimeout(timer); resolve(el); }, { once: true });
    el.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cannot decode')); }, { once: true });
    el.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

async function probeFile(file: File, kind: MediaKind): Promise<Probe> {
  if (kind === 'image' || kind === 'logo') {
    const img = await loadElement(new Image(), file, 'load');
    return { width: img.naturalWidth || undefined, height: img.naturalHeight || undefined };
  }
  if (kind === 'video') {
    const video = document.createElement('video');
    video.preload = 'metadata';
    if (file.type && !video.canPlayType(file.type)) throw new Error('cannot play');
    const v = await loadElement(video, file, 'loadedmetadata');
    return { width: v.videoWidth || undefined, height: v.videoHeight || undefined, durationMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : undefined };
  }
  if (kind === 'audio') {
    const audio = new Audio();
    audio.preload = 'metadata';
    const a = await loadElement(audio, file, 'loadedmetadata');
    return { durationMs: Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : undefined };
  }
  return {};
}

export const defaultMediaDeps: MediaDeps = {
  put: (path, data) => putMedia(path, data),
  probe: probeFile,
  async loadFont(family, data) {
    const face = new FontFace(family, await data.arrayBuffer());
    await face.load();
    document.fonts.add(face);
  },
  async addToBrandKit(asset) {
    const kit = await getBrandKit();
    await putBrandKit({ colours: [], useForNewClips: false, ...kit, logoAssetId: asset.id });
  },
  async read() {
    const stored = await browser.storage.local.get(STORE_KEY);
    return (stored[STORE_KEY] as Asset[] | undefined) ?? [];
  },
  write: (items) => browser.storage.local.set({ [STORE_KEY]: items }),
  id: () => globalThis.crypto?.randomUUID?.() ?? `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
};

/** Everything you added, newest first. */
export async function listMedia(deps: Pick<MediaDeps, 'read'> = defaultMediaDeps): Promise<Asset[]> {
  return deps.read();
}

/**
 * Stores each usable file in OPFS and remembers it for later clips. A logo also goes into the brand kit.
 * Files that cannot be used come back in `rejected`; the others are still added.
 */
export async function addFiles(files: File[], deps: MediaDeps = defaultMediaDeps): Promise<{ added: Asset[]; rejected: Rejected[] }> {
  const added: Asset[] = [];
  const rejected: Rejected[] = [];
  for (const file of files) {
    const kind = classifyFile(file);
    if (!kind) { rejected.push({ name: file.name, problem: 'media-unsupported' }); continue; }
    let probe: Probe;
    try {
      probe = await deps.probe(file, kind);
    } catch {
      rejected.push({ name: file.name, problem: kind === 'video' ? 'video-wont-play' : 'media-unsupported' });
      continue;
    }
    const id = deps.id();
    // The renderer loads a font under the asset's name, so a font keeps its family there.
    const name = kind === 'font' ? stem(file.name) : file.name;
    const asset: Asset = {
      id, kind, name, mime: file.type || 'application/octet-stream', bytes: file.size, ...probe,
      opfsPath: mediaPath(id, extOf(file.name)),
    };
    try {
      if (kind === 'font') await deps.loadFont(name, file);
      await deps.put(asset.opfsPath, file);
    } catch (error) {
      console.error('Motikord: could not add your file', error);
      rejected.push({ name: file.name, problem: 'media-unsupported' });
      continue;
    }
    if (kind === 'logo') {
      try { await deps.addToBrandKit(asset); } catch (error) { console.error('Motikord: could not add the logo to the brand kit', error); }
    }
    added.push(asset);
  }
  if (added.length) await deps.write([...[...added].reverse(), ...(await deps.read())]);
  return { added, rejected };
}

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`;
export function formatBytes(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** The second line of a row, as the YourMedia frame words it. */
export function describeMedia(a: Asset): string {
  switch (a.kind) {
    case 'image': return `Image · ${formatBytes(a.bytes)}`;
    case 'logo': return 'Logo · added to your brand kit';
    case 'video': return `Video · ${a.durationMs ? `${clock(a.durationMs)} · ` : ''}${formatBytes(a.bytes)}`;
    case 'font': return 'Font · ready to use';
    case 'audio': return `Music${a.durationMs ? ` · ${clock(a.durationMs)}` : ''}`;
  }
}

/** The name as shown: a font shows its file name again. */
export const displayName = (a: Asset) => (a.kind === 'font' ? `${a.name}.${extOf(a.opfsPath)}` : a.name);

/** Registers a remembered font with the page again after a restart. */
export async function restoreFont(asset: Asset, data: Blob, deps: Pick<MediaDeps, 'loadFont'> = defaultMediaDeps): Promise<void> {
  await deps.loadFont(asset.name, data);
}
