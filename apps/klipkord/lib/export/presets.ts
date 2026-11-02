// Export presets as data: what each one names, the shape and height it writes, and the length its site takes.
import type { Shape } from '../project/types';
import { FRAME } from '../render/plan';

export type PresetId = 'youtube' | 'shorts' | 'linkedin' | 'x' | 'custom';
export type QualityId = 'fast' | 'best';
export type ContainerId = 'mp4' | 'webm';

export interface Preset {
  id: PresetId;
  name: string;
  sub: string;
  /** Shapes the site takes, first is the default; null keeps the cut's shape. */
  shapes: Shape[] | null;
  /** Tallest short side the site wants. */
  maxSide: 720 | 1080;
  /** Longest video the site takes, ms; absent when it has no practical limit. */
  limitMs?: number;
  /** "Over the Shorts limit by 2:48" */
  limitName?: string;
  /** "Shorts, Reels and TikTok may cut it short or refuse it." */
  sites?: string;
}

export const PRESETS: Preset[] = [
  { id: 'youtube', name: 'YouTube', sub: '16:9 · 1080p', shapes: ['16:9'], maxSide: 1080 },
  { id: 'shorts', name: 'Shorts, Reels, TikTok', sub: '9:16 · 1080p', shapes: ['9:16'], maxSide: 1080, limitMs: 180_000, limitName: 'Shorts', sites: 'Shorts, Reels and TikTok' },
  { id: 'linkedin', name: 'LinkedIn', sub: '1:1 or 16:9', shapes: ['1:1', '16:9'], maxSide: 1080, limitMs: 600_000, limitName: 'LinkedIn', sites: 'LinkedIn' },
  { id: 'x', name: 'X', sub: '16:9 · 720p', shapes: ['16:9'], maxSide: 720, limitMs: 140_000, limitName: 'X', sites: 'X' },
  { id: 'custom', name: 'Custom', sub: 'Any size', shapes: null, maxSide: 1080 },
];

export const GIF_PRESET = { name: 'GIF of a part', sub: 'Up to 15 s' } as const;

export const QUALITIES: { id: QualityId; label: string; side: 720 | 1080 }[] = [
  { id: 'fast', label: 'Fast · 720p', side: 720 },
  { id: 'best', label: 'Best · 1080p', side: 1080 },
];

export const presetById = (id: PresetId): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;

/** Ms the cut runs past the preset's limit; 0 when it fits. Over the limit still exports. */
export function overLimit(preset: Preset, lengthMs: number): number {
  return preset.limitMs && lengthMs > preset.limitMs ? lengthMs - preset.limitMs : 0;
}

/** The cut's own shape when the preset takes it, else the preset's first. */
export function shapeFor(preset: Preset, cutShape: Shape): Shape {
  if (!preset.shapes || preset.shapes.includes(cutShape)) return cutShape;
  return preset.shapes[0]!;
}

/** The short side written: the quality's, capped by the preset. */
export const shortSide = (preset: Preset, quality: QualityId): 720 | 1080 =>
  Math.min(preset.maxSide, QUALITIES.find((q) => q.id === quality)!.side) as 720 | 1080;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output pixels for a shape at a short side, both even (encoders want it). */
export function outputSize(shape: Shape, side: number): { width: number; height: number } {
  const f = FRAME[shape];
  const scale = side / Math.min(f.w, f.h);
  return { width: even(f.w * scale), height: even(f.h * scale) };
}

// About 3 Mbps at 1080p 16:9: screen video stays sharp and an hour fits in ~1.4 GB.
const BITS_PER_PIXEL = 3_000_000 / (1920 * 1080);
export const AUDIO_BITRATE = 128_000;

export const videoBitrate = (width: number, height: number): number => Math.round(width * height * BITS_PER_PIXEL);
