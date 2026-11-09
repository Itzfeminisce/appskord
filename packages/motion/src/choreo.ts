import { trackEnd } from './curves';
import type { LayerV3, Track, Unit } from './types';

/** Each hierarchy level starts this long before the one above it ends. */
export const OVERLAP_MS = 40;

/** Stagger between units, as drawn in MotionV3: 40 ms a letter, 90 ms a word, 120 ms a line. */
export const STAGGER_MS: Readonly<Record<Unit, number>> = { letter: 40, word: 90, line: 120 };

/** The units a text animates by. Letters skip spaces; lines split on newlines. */
export function splitUnits(text: string, unit: Unit): string[] {
  if (unit === 'letter') return [...text].filter((c) => !/\s/.test(c));
  if (unit === 'word') return text.split(/\s+/).filter(Boolean);
  return text.split('\n').filter((line) => line.trim() !== '');
}

/** Start offset of each of `count` units, in ms from the layer's start. */
export function stagger(count: number, unit: Unit, stepMs: number = STAGGER_MS[unit]): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => i * stepMs);
}

/** How long a staggered entrance runs: the last unit starts late and then runs its own length. */
export function staggeredMs(unitMs: number, count: number, stepMs: number): number {
  return count > 0 ? unitMs + (count - 1) * stepMs : 0;
}

/** Starts for hierarchy levels of the given lengths: each starts OVERLAP_MS before the one above it ends. */
export function hierarchyStarts(levelMs: readonly number[], overlapMs: number = OVERLAP_MS): number[] {
  const starts: number[] = [];
  let end = 0;
  levelMs.forEach((ms, i) => {
    const start = i === 0 ? 0 : Math.max(0, end - overlapMs);
    starts.push(start);
    end = start + ms;
  });
  return starts;
}

/** A layer's entrance length: its latest key across all tracks. */
export function layerMs(layer: LayerV3): number {
  let ms = 0;
  for (const track of Object.values(layer.tracks) as Track<number>[]) ms = Math.max(ms, trackEnd(track));
  return ms;
}

/** Start of every layer in ms from the scene's start. Layers without `start` follow the previous one, overlapping by 40 ms. */
export function layerStarts(layers: readonly LayerV3[], overlapMs: number = OVERLAP_MS): number[] {
  const starts: number[] = [];
  let end: number | undefined;
  for (const layer of layers) {
    const start = layer.start ?? (end === undefined ? 0 : Math.max(0, end - overlapMs));
    starts.push(start);
    end = start + layerMs(layer);
  }
  return starts;
}
