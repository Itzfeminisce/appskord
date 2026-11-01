import { CODECS } from '../check/plan';
import type { FileKind } from '../types';

export interface MuxAudio { codec: 'aac' | 'opus'; sampleRate: number; channels: number }
/** A container being filled; `finish` returns the whole file. */
export interface Muxed {
  mime: string;
  addVideo(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudio(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finish(): ArrayBuffer;
}

/** Thrown when Chrome cannot encode this kind on this computer (maps to export-failed). */
export class Unsupported extends Error {
  constructor(what: string) { super(`${what} is not supported here`); this.name = 'Unsupported'; }
}
/** Thrown inside the frame loop when the person pressed Cancel. */
export class Cancelled extends Error {
  constructor() { super('Export cancelled'); this.name = 'Cancelled'; }
}

export interface VideoSpec { kind: Exclude<FileKind, 'gif'>; width: number; height: number; fps: number; bitrate: number }

export function videoConfig(s: VideoSpec): VideoEncoderConfig {
  return {
    codec: s.kind === 'mp4' ? CODECS.h264 : CODECS.vp9,
    width: s.width, height: s.height, framerate: s.fps, bitrate: s.bitrate, latencyMode: 'quality',
    ...(s.kind === 'mp4' ? { avc: { format: 'avc' as const } } : {}),
    ...(s.kind === 'webm-alpha' ? { alpha: 'keep' as const } : {}),
  };
}

export type IsSupported = (c: VideoEncoderConfig) => Promise<{ supported?: boolean }>;

/** The video chip first, then software; null when neither is accepted (see-through VP9 often is not). */
export async function pickVideoConfig(s: VideoSpec, isSupported: IsSupported): Promise<{ config: VideoEncoderConfig; hardware: boolean } | null> {
  for (const hardwareAcceleration of ['prefer-hardware', 'prefer-software'] as const) {
    const config = { ...videoConfig(s), hardwareAcceleration };
    try {
      if ((await isSupported(config)).supported) return { config, hardware: hardwareAcceleration === 'prefer-hardware' };
    } catch { /* try the next one */ }
  }
  return null;
}

let seeThroughProbe: Promise<boolean> | undefined;
/** Asked once per page: can Chrome encode VP9 with alpha here? Export disables See-through WebM when not. */
export function seeThroughSupported(isSupported?: IsSupported): Promise<boolean> {
  const ask: IsSupported | undefined = isSupported ?? (typeof VideoEncoder === 'undefined' ? undefined : (c) => VideoEncoder.isConfigSupported(c));
  seeThroughProbe ??= ask ? pickVideoConfig({ kind: 'webm-alpha', width: 1080, height: 1920, fps: 30, bitrate: 8_000_000 }, ask).then((p) => !!p, () => false) : Promise.resolve(false);
  return seeThroughProbe;
}

export interface FrameLoop {
  frames: number; fps: number;
  /** Gets what frame i needs (video frames) before it is drawn. */
  prepare?(i: number, tMs: number): Promise<void>;
  draw(i: number, tMs: number): void;
  encode(i: number, tMs: number): Promise<void> | void;
  progress(frame: number, frames: number, tMs: number): void;
  cancelled(): boolean;
  now?: () => number;
  /** Progress at most this often, so the editor gets about 4 updates a second. */
  everyMs?: number;
}

/** Draws and encodes every frame in order. Throws Cancelled as soon as Cancel is seen. */
export async function runFrames(loop: FrameLoop): Promise<void> {
  const now = loop.now ?? (() => performance.now());
  const every = loop.everyMs ?? 250;
  let last = -Infinity;
  for (let i = 0; i < loop.frames; i++) {
    if (loop.cancelled()) throw new Cancelled();
    const tMs = (i * 1000) / loop.fps;
    await loop.prepare?.(i, tMs);
    loop.draw(i, tMs);
    await loop.encode(i, tMs);
    const t = now();
    if (t - last >= every || i === loop.frames - 1) {
      last = t;
      loop.progress(i + 1, loop.frames, tMs);
    }
  }
}

/** The calls of VideoEncoder the export uses, so tests pass a fake. */
export interface EncoderLike {
  readonly encodeQueueSize: number;
  configure(c: VideoEncoderConfig): void;
  encode(frame: VideoFrame, o?: VideoEncoderEncodeOptions): void;
  flush(): Promise<void>;
  close(): void;
}
export type MakeEncoder = (init: VideoEncoderInit) => EncoderLike;

/** Wraps a VideoEncoder: hands chunks to the muxer, keeps the queue short, and rethrows its error. */
export function videoTrack(config: VideoEncoderConfig, mux: Muxed, make: MakeEncoder = (i) => new VideoEncoder(i), maxQueue = 6) {
  let failure: unknown = null;
  const enc = make({
    output: (chunk, meta) => { try { mux.addVideo(chunk, meta); } catch (e) { failure ??= e; } },
    error: (e) => { failure ??= e; },
  });
  enc.configure(config);
  const keyEvery = Math.round((config.framerate ?? 30) * 2);
  return {
    async add(frame: VideoFrame, i: number) {
      if (failure) { frame.close(); throw failure; }
      enc.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      while (enc.encodeQueueSize > maxQueue) await new Promise((r) => setTimeout(r, 1));
    },
    async done() {
      await enc.flush();
      enc.close();
      if (failure) throw failure;
    },
    close() { try { enc.close(); } catch { /* already closed */ } },
  };
}
