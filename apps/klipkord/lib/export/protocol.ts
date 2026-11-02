// Messages between the editor page (run.ts) and the export worker. The page keeps the sound (Web Audio is page-only).
import type { MixChunk } from '../audio/export';
import type { Caption } from '../project/captions';
import type { Cut, EventsTrack, Project } from '../project/types';
import type { RenderSource } from '../render/render.worker';
import type { ContainerId } from './presets';

/** Where a file goes: a file in the user's folder, or the extension's own storage for a download. */
export type Target = { kind: 'handle'; handle: FileSystemFileHandle } | { kind: 'opfs'; name: string };

interface Common {
  project: Project;
  /** The cut as it renders: shape, captions and camera already set for this export. */
  cut: Cut;
  captions?: Caption[];
  events?: EventsTrack;
  sources: RenderSource[];
  width: number;
  height: number;
}

export interface VideoJob extends Common {
  kind: 'video';
  fps: number;
  container: ContainerId;
  bitrate: number;
  hardware: boolean;
  /** The page sends the mix in chunks when true. */
  audio: boolean;
  target: Target;
  /** "Audio only (M4A)": the same mix into its own file. */
  audioOnly?: Target;
}

export interface GifJob extends Common { kind: 'gif'; fps: number; from: number; to: number; target: Target }

export type TitleStyle = 'none' | 'bold' | 'clean';
export interface StillJob extends Common { kind: 'still'; out: number; title?: { text: string; style: TitleStyle } }

export type Job = VideoJob | GifJob | StillJob;

export type ExportRequest =
  | { type: 'start'; id: number; job: Job }
  /** The next piece of the mix; null when it has ended. */
  | { type: 'audio'; chunk: MixChunk | null }
  | { type: 'cancel' };

export type ExportResponse =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'need-audio'; id: number }
  /** `file` is the finished file (a disk-backed File for video), `audio` the M4A when asked for. */
  | { type: 'done'; id: number; file: Blob; audio?: Blob }
  | { type: 'error'; id: number; message: string }
  | { type: 'cancelled'; id: number };
