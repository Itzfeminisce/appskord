// How long an export takes on this computer and how big it comes out, from the encoder probe (packages/media).
import { AUDIO_BITRATE, videoBitrate } from './presets';
import { EXPORT_FPS, frameCount } from './schedule';

const PX_1080 = 1920 * 1080;
// Drawing and decoding one 1080p frame on the owner's laptop (4 cores, no WebGPU) runs at about this rate.
const RENDER_FPS_1080 = 45;
// Software VP9 or H.264 at 1080p when no hardware encoder was found.
const SOFTWARE_FPS_1080 = 18;

export interface EstimateInput {
  lengthMs: number;
  width: number;
  height: number;
  /** probeEncoder's frames per second at this size; 0 when H.264 could not be probed. */
  encoderFps: number;
  audio: boolean;
}

export interface Estimate { seconds: number; bytes: number }

/** Frames per second the whole pipeline keeps: render and encode one after another. */
export function pipelineFps(width: number, height: number, encoderFps: number): number {
  const scale = PX_1080 / Math.max(1, width * height);
  const render = RENDER_FPS_1080 * scale;
  const encode = encoderFps > 0 ? encoderFps : SOFTWARE_FPS_1080 * scale;
  return 1 / (1 / render + 1 / encode);
}

export function estimateExport(i: EstimateInput): Estimate {
  const frames = frameCount(i.lengthMs, EXPORT_FPS);
  const seconds = frames / pipelineFps(i.width, i.height, i.encoderFps);
  const bits = (videoBitrate(i.width, i.height) + (i.audio ? AUDIO_BITRATE : 0)) * (i.lengthMs / 1000);
  // Container overhead is about 1 %.
  return { seconds, bytes: Math.round((bits / 8) * 1.01) };
}

/** Whole minutes, at least 1. */
export const minutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));

/** export-slow: "about 9 minutes", "about 1 minute", "under a minute". */
export function minutesText(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  return minutes(seconds) === 1 ? 'about 1 minute' : `about ${minutes(seconds)} minutes`;
}

/** The short form: "1 min", "9 min". */
export const minShort = (seconds: number): string => `${minutes(seconds)} min`;

/** "6.2 MB", "142 MB". */
export function sizeText(bytes: number): string {
  const mb = bytes / 1_000_000;
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (mb < 1000) return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
  return `${Math.round(mb / 100) / 10} GB`;
}

/** ExportVideo: "About 4 min on this computer · about 140 MB". */
export const estimateLine = (e: Estimate): string => `About ${minShort(e.seconds)} on this computer · about ${sizeText(e.bytes)}`;

/** Exporting card: "about 1 min 30 s left"; seconds over a minute round to tens. */
export function timeLeft(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `about ${s} s left`;
  const tens = Math.round(s / 10) * 10;
  const m = Math.floor(tens / 60), rest = tens % 60;
  return rest ? `about ${m} min ${rest} s left` : `about ${m} min left`;
}

/** drive-uploading: "About 1 min left." */
export function uploadLeft(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  return s < 60 ? `About ${s} s left.` : `About ${minutes(s)} min left.`;
}

/** Seconds left from progress so far; null until there is enough to tell. */
export function remaining(done: number, total: number, elapsedMs: number): number | null {
  if (done <= 0 || total <= 0 || elapsedMs < 1000) return null;
  return ((total - done) / done) * (elapsedMs / 1000);
}

// T0: 15 s at 640x360 and 12 fps came to 3.4 MB in 188 frames.
const GIF_BYTES_PER_PIXEL_FRAME = 3_400_000 / 188 / (640 * 360);

/** GifExport "about 3.1 MB": grows with frames and pixels; the real size depends on how busy the screen is. */
export function gifBytes(lengthMs: number, width: number, height: number, fps: number): number {
  return Math.round(frameCount(lengthMs, fps) * width * height * GIF_BYTES_PER_PIXEL_FRAME);
}
