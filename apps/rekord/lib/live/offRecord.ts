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

/** True when any of the chunk's audio falls in an off-the-record span, or after the current one began (the click). */
export function inOffSpan(chunk: Pick<Chunk, 'startMs' | 'endMs'>, spans: OffSpan[], currentStartMs?: number): boolean {
  if (currentStartMs !== undefined && chunk.endMs > currentStartMs) return true;
  return spans.some((s) => chunk.startMs < s.endMs && chunk.endMs > s.startMs);
}

/** Lines from outside the meeting's off-the-record spans: the summary and memory never read a span. */
export function onRecord<T extends { startMs: number }>(lines: T[], spans: OffSpan[] | undefined): T[] {
  return spans?.length ? lines.filter((l) => !spans.some((s) => l.startMs >= s.startMs && l.startMs < s.endMs)) : lines;
}

/** Chunker hooks behind the gate: a chunk `keep` refuses is never saved, queued or sent. */
export function gatedChunks(keep: (chunk: Chunk) => boolean, save: (chunk: Chunk) => Promise<void>, enqueue: (chunkId: string) => void) {
  const dropped = new Set<string>();
  return {
    saveChunk: (chunk: Chunk): Promise<void> => {
      if (keep(chunk)) return save(chunk);
      dropped.add(chunk.id);
      return Promise.resolve();
    },
    onPending: (chunk: Chunk): void => { if (!dropped.delete(chunk.id)) enqueue(chunk.id); },
  };
}

/** What the recorder does to stop and restart capture (chunkers, real-time sockets, the speaker recording). */
export interface Capture {
  /** `cutoffMs`: the click in meeting time; anything heard from then on is dropped. */
  stop(cutoffMs: number): Promise<void>;
  start(): Promise<void>;
}

/**
 * The offscreen recorder's switch. From the click on, any chunk whose audio ends after it is dropped (the one in
 * flight too: losing a moment before the click is the safe side), never saved, queued or sent.
 */
export class OffRecordGate {
  private state: OffRecordState = { spans: [] };
  private switching: Promise<void> = Promise.resolve();
  /** The click that asked to go off, judged against at once, before the switch has run. */
  private asked?: number;

  constructor(private readonly startedAt: number, private readonly capture: Capture, private readonly now: () => number = Date.now) {}

  get off(): boolean { return this.state.since !== undefined; }

  /** `at`: the click (epoch ms). Going off stamps the span there, so audio from after it is never kept. */
  set(off: boolean, at: number = this.now()): Promise<void> {
    if (off && !this.off && this.asked === undefined) this.asked = at;
    this.switching = this.switching.then(async () => {
      if (off === this.off) return;
      if (off) {
        this.state = goOff(this.state, this.asked ?? at);
        this.asked = undefined;
        await this.capture.stop(this.state.since! - this.startedAt);
      } else {
        this.state = goOn(this.state, at, this.startedAt);
        await this.capture.start();
      }
    });
    return this.switching;
  }

  /** False for a chunk with off-the-record audio: the caller drops it. */
  keep(chunk: Pick<Chunk, 'startMs' | 'endMs'>): boolean {
    const since = this.asked ?? this.state.since;
    return !inOffSpan(chunk, this.state.spans, since !== undefined ? since - this.startedAt : undefined);
  }
}
