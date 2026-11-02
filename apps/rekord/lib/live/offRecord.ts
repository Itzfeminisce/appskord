// Off the record: while it is on, no audio is kept, transcribed or sent. The span shows as a marker in the transcript.
import type { Chunk } from '../types';

/** A span in meeting time (ms from the start). */
export interface OffSpan { startMs: number; endMs: number }
/** `since`: when the current span began (epoch ms); missing while on the record. */
export interface OffRecordState { since?: number; spans: OffSpan[] }

export const OFF_RECORD_WHAT = 'Off the record';
export const OFF_RECORD_COMMAND = 'off-record';

export function goOff(state: OffRecordState | undefined, now: number): OffRecordState {
  const s = state ?? { spans: [] };
  return s.since !== undefined ? s : { ...s, since: now };
}

export function goOn(state: OffRecordState | undefined, now: number, startedAt: number): OffRecordState {
  const s = state ?? { spans: [] };
  if (s.since === undefined) return s;
  return { spans: [...s.spans, { startMs: Math.max(0, s.since - startedAt), endMs: Math.max(0, now - startedAt) }] };
}

/** "Off the record · 2 min" (at least 1 min). */
export function spanLabel(span: OffSpan): string {
  return `Off the record · ${Math.max(1, Math.round((span.endMs - span.startMs) / 60_000))} min`;
}

/** "00:11" since going off. */
export function offClock(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// The last chunk flushed when going off ends a moment after the switch.
const FLUSH_SLACK_MS = 1_500;

/** True when any of the chunk's audio falls in an off-the-record span (or after the current one began). */
export function inOffSpan(chunk: Pick<Chunk, 'startMs' | 'endMs'>, spans: OffSpan[], currentStartMs?: number): boolean {
  if (currentStartMs !== undefined && chunk.endMs > currentStartMs + FLUSH_SLACK_MS) return true;
  return spans.some((s) => chunk.startMs < s.endMs && chunk.endMs > s.startMs + FLUSH_SLACK_MS);
}

/** What the recorder does to stop and restart capture (chunkers, real-time sockets, the speaker recording). */
export interface Capture {
  stop(): Promise<void>;
  start(): Promise<void>;
}

/**
 * The offscreen recorder's switch. Going off stops capture first, so the last chunk holds only audio from before;
 * any chunk that still reaches `keep` with audio from the span is dropped, never saved or sent.
 */
export class OffRecordGate {
  private state: OffRecordState = { spans: [] };
  private switching: Promise<void> = Promise.resolve();

  constructor(private readonly startedAt: number, private readonly capture: Capture, private readonly now: () => number = Date.now) {}

  get off(): boolean { return this.state.since !== undefined; }

  set(off: boolean): Promise<void> {
    this.switching = this.switching.then(async () => {
      if (off === this.off) return;
      if (off) {
        await this.capture.stop();
        this.state = goOff(this.state, this.now());
      } else {
        this.state = goOn(this.state, this.now(), this.startedAt);
        await this.capture.start();
      }
    });
    return this.switching;
  }

  /** False for a chunk with off-the-record audio: the caller drops it. */
  keep(chunk: Pick<Chunk, 'startMs' | 'endMs'>): boolean {
    const current = this.state.since !== undefined ? this.state.since - this.startedAt : undefined;
    return !inOffSpan(chunk, this.state.spans, current);
  }
}
