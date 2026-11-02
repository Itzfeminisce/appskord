// The export's frame clock: frames are spaced evenly in output time, so speed-ups and gaps come out of renderPlan.
import { toRec } from '../project/time';
import type { Cut } from '../project/types';

export const EXPORT_FPS = 30;

/** Frames that cover `lengthMs`; the last one may run past the end by less than a frame. */
export const frameCount = (lengthMs: number, fps: number): number => Math.max(0, Math.ceil((lengthMs * fps) / 1000 - 1e-6));

/** Output ms of frame `i`. */
export const frameOut = (i: number, fps: number): number => (i * 1000) / fps;

export interface ScheduledFrame {
  index: number;
  /** Output ms. */
  out: number;
  /** Recording ms the frame shows; null in a gap. */
  rec: number | null;
}

/** Every frame from `from` to `to` output ms (the whole cut by default), with the recording time it shows. */
export function* frameSchedule(cut: Cut, lengthMs: number, fps = EXPORT_FPS, from = 0, to = lengthMs): Generator<ScheduledFrame> {
  const first = Math.max(0, Math.floor((from * fps) / 1000 + 1e-6));
  const end = Math.min(frameCount(lengthMs, fps), frameCount(to, fps));
  for (let index = first; index < end; index++) {
    const out = frameOut(index, fps);
    yield { index, out, rec: toRec(cut, out) };
  }
}
