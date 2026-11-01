/** Nearest-rank percentile (p in 0..100) of the values; 0 for none. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)]!;
}

export interface FrameStats { frames: number; meanFps: number; p95Ms: number; dropped: number }

/**
 * Stats over requestAnimationFrame intervals (ms). A frame is dropped for every display refresh (`refreshMs`)
 * an interval missed beyond the first.
 */
export function frameStats(intervals: readonly number[], refreshMs = 1000 / 60): FrameStats {
  const total = intervals.reduce((sum, ms) => sum + ms, 0);
  const dropped = intervals.reduce((sum, ms) => sum + Math.max(0, Math.round(ms / refreshMs) - 1), 0);
  return {
    frames: intervals.length,
    meanFps: total > 0 ? (intervals.length * 1000) / total : 0,
    p95Ms: percentile(intervals, 95),
    dropped,
  };
}

export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
