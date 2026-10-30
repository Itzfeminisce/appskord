import type { Edit } from './editor/store';
import { mediaPath } from './media';
import type { Asset, MusicTrack, Recipe } from './types';

/** Tracks made by scripts/make-music.mjs and released by us as CC0. Files are in public/music. */
export interface BundledTrack { id: string; name: string; mood: string; durationMs: number; file: string }
export const BUNDLED_TRACKS: readonly BundledTrack[] = [
  { id: 'upbeat', name: 'Upbeat', mood: 'Upbeat', durationMs: 32000, file: 'music/upbeat.wav' },
  { id: 'calm', name: 'Calm', mood: 'Calm', durationMs: 33333, file: 'music/calm.wav' },
  { id: 'bold', name: 'Bold', mood: 'Bold', durationMs: 33600, file: 'music/bold.wav' },
  { id: 'playful', name: 'Playful', mood: 'Playful', durationMs: 32727, file: 'music/playful.wav' },
];

export const DEFAULT_MUSIC = { volume: 0.7, fadeInMs: 500, fadeOutMs: 1000 } as const;
export const FADE_CHOICES = [0, 500, 1000, 2000] as const;

/** One asset id per bundled track, so picking it twice never doubles it in the recipe. */
export const bundledAssetId = (trackId: string) => `music-${trackId}`;

export function bundledAsset(t: BundledTrack): Asset {
  const id = bundledAssetId(t.id);
  return {
    id, kind: 'audio', name: t.name, mime: 'audio/wav', bytes: 0, durationMs: t.durationMs, opfsPath: mediaPath(id, 'wav'),
    credit: { title: t.name, author: 'Motikord', source: 'bundled', url: '', licence: 'cc0' },
  };
}

export const trackOf = (r: Recipe): Asset | undefined => (r.music ? r.assets[r.music.assetId] : undefined);

export const fadeLabel = (ms: number) => `${ms / 1000} s`;
export function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const usedByLayers = (r: Recipe, assetId: string) =>
  r.scenes.some((s) => s.layers.some((l) => (l.type === 'image' || l.type === 'video') && l.assetId === assetId));

/** Chooses a track (or none). Keeps the volume and fades; drops the old track's asset when nothing else uses it. */
export function chooseMusicEdit(r: Recipe, asset: Asset | null): Edit | undefined {
  const cur = r.music;
  const ops: Edit['ops'] = [];
  if (!asset) {
    if (!cur) return undefined;
    ops.push({ op: 'remove', path: '/music' });
  } else {
    if (cur?.assetId === asset.id) return undefined;
    if (!r.assets[asset.id]) ops.push({ op: 'add', path: `/assets/${asset.id}`, value: asset });
    const value: MusicTrack = { assetId: asset.id, volume: cur?.volume ?? DEFAULT_MUSIC.volume, fadeInMs: cur?.fadeInMs ?? DEFAULT_MUSIC.fadeInMs, fadeOutMs: cur?.fadeOutMs ?? DEFAULT_MUSIC.fadeOutMs };
    ops.push({ op: cur ? 'replace' : 'add', path: '/music', value });
  }
  if (cur && cur.assetId !== asset?.id && r.assets[cur.assetId] && !usedByLayers(r, cur.assetId)) ops.push({ op: 'remove', path: `/assets/${cur.assetId}` });
  return { ops, summary: asset ? `Music: ${asset.name}` : 'No music' };
}

const LABEL = { volume: 'Music volume', fadeInMs: 'Music fade in', fadeOutMs: 'Music fade out' } as const;

/** Volume (0 to 1) and fades write Recipe.music; dragging the slider merges into one change. */
export function musicSettingEdit(r: Recipe, field: keyof typeof LABEL, value: number): Edit | undefined {
  if (!r.music) return undefined;
  return { ops: [{ op: 'replace', path: `/music/${field}`, value }], summary: LABEL[field], mergeKey: `music-${field}` };
}
