// Time is integer frames at the clip's fps, converted to ms; nothing here reads a clock.

export function frameMs(frame: number, fps: number): number {
  return (frame * 1000) / fps;
}

export function frameCount(ms: number, fps: number): number {
  return Math.max(0, Math.ceil((ms * fps) / 1000 - 1e-6));
}

/** The frame showing time `ms`, so float drift never picks a neighbour frame. */
export function frameAtMs(ms: number, fps: number): number {
  return Math.floor((ms * fps) / 1000 + 1e-6);
}

export function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/** Progress 0..1 through [start, start + ms]. */
export function progress(t: number, start: number, ms: number): number {
  return ms <= 0 ? (t >= start ? 1 : 0) : clamp01((t - start) / ms);
}
