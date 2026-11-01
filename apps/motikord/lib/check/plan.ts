// What each test draws and encodes, and the plan's budget it is judged against.
export const PREVIEW = { width: 1280, height: 720, seconds: 60, minFps: 30 } as const;
export const EXPORT = { width: 1920, height: 1080, fps: 30, seconds: 15, budgetSeconds: 30 } as const;
export const GIF = { width: 480, height: 270, fps: 15, seconds: 6 } as const;
export const AUDIO = { seconds: 15, sampleRate: 48000, channels: 2 } as const;
export const MEMORY_BUDGET_MB = 400;
export const CODECS = { h264: 'avc1.640028', vp9: 'vp09.00.10.08', aac: 'mp4a.40.2', opus: 'opus' } as const;

export type ExportKind = 'mp4' | 'webm' | 'alpha' | 'gif';

/** Seconds of clip, frames and frame rate one export test renders. */
export function exportPlan(kind: ExportKind) {
  if (kind === 'gif') return { width: GIF.width, height: GIF.height, fps: GIF.fps, seconds: GIF.seconds, frames: GIF.fps * GIF.seconds };
  return { width: EXPORT.width, height: EXPORT.height, fps: EXPORT.fps, seconds: EXPORT.seconds, frames: EXPORT.fps * EXPORT.seconds };
}
