import type { Chapter } from '../types';      // { at: number; title: string }, rec ms
export type SourceKind = 'screen' | 'camera' | 'mic' | 'tab' | 'baked' | 'media' | 'voiceover' | 'music';
export interface Source {                     // one file in OPFS under <recordingId>/
  id: string; kind: SourceKind; file: string; mime: string;
  offset: number;                             // rec ms when this file's first frame or sample starts
  duration: number; width?: number; height?: number; video: boolean; audio: boolean;
  name?: string;                              // added media and music: the file name shown in the UI
}

// Events track: <recordingId>/events.json. Positions are 0..1 of the captured tab viewport.
export type RecEvent =
  | { t: number; type: 'move'; x: number; y: number }
  | { t: number; type: 'click'; x: number; y: number }
  | { t: number; type: 'key'; key: 'typing' | string; x?: number; y?: number } // shortcut name, e.g. "Ctrl+C"; never a character
  | { t: number; type: 'scroll'; dy: number }                                   // 0..1 of viewport height
  | { t: number; type: 'page' };                                                // a new page loaded; no URL kept
export interface EventsTrack { version: 1; viewport: { w: number; h: number }; events: RecEvent[] }

export type Shape = '16:9' | '9:16' | '1:1' | '4:5';
export type VerticalFit = 'stack' | 'follow' | 'bars';       // "Screen over camera", "Follow the cursor", "Fit with bars"
export type Feel = 'calm' | 'smooth' | 'snappy';
export type LayoutKind = 'bubble' | 'side' | 'camera' | 'screen';

export interface Clip {
  id: string; in: number; out: number;        // rec ms; a gap clip has gap: true and shows the background
  speed: number;                              // 0.5 to 4
  silencesOnly?: boolean;                     // "Speed up only the silences"
  naturalVoice?: boolean;                     // "Keep the voice natural" (pitch kept)
  transition?: { kind: 'fade' | 'zoom'; ms: number };  // into this clip
  gap?: boolean;
}
export interface Zoom { id: string; at: number; end: number; depth: number; focus: 'cursor' | { x: number; y: number };
  feel: Feel; auto: boolean; why?: string;    // why: "3 clicks on Save" (shown in ZoomEdit's list)
  rampIn?: number; rampOut?: number }         // ms, set by autoZoom when less time is left than the feel's ramp
export interface LayoutSwitch { id: string; at: number; layout: LayoutKind; switch: 'cut' | 'smooth' }
export interface Camera { corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; size: number; // 0..1 of frame height
  shape: 'round' | 'rounded'; mirror: boolean; blur: { on: boolean; mode: 'blur' | 'colour'; colour: string } }
export interface Look {
  background: { kind: 'colour' | 'gradient' | 'image' | 'blurred'; value: string };  // value: hex, gradient id or media source id
  padding: number; corners: number; shadow: number;   // px at 1080p
  cursor: { size: number; smooth: boolean; clicks: boolean };
}
export interface CaptionStyle { style: 'clean' | 'bold' | 'word'; position: 'bottom' | 'middle' | 'top'; size: number;
  show: boolean; language?: string }          // language shown in the video; others export as files
export interface Overlay { id: string; kind: 'text' | 'arrow' | 'callout' | 'highlight' | 'spotlight' | 'blur';
  at: number; end: number; box: { x: number; y: number; w: number; h: number };  // 0..1 of the screen picture
  text?: string; blur?: { mode: 'blur' | 'pixelate' | 'solid'; amount: number; follow: boolean };
  motion: 'fade' | 'pop' | 'none' }
export interface Card { id: string; template: string; at: number; ms: number;  // overlays the picture for ms; never inserts time
  slots: Record<string, string>; pack: 'clean' | 'bold' | 'playful' }
export interface AudioMix { denoise: boolean; level: boolean; tabVolume: number; voiceVolume: number;
  music?: { source: string; volume: number; duck: boolean; fadeIn: number; fadeOut: number } }
export interface Placed { id: string; source: string; at: number; trim: [number, number]; volume: number; muted: boolean;
  muteOriginal?: boolean }                   // voiceover: the original voice is silent under this take

export interface Cut {
  id: string; name: string; shape: Shape; fit: VerticalFit;
  made: 'full' | 'manual' | 'duplicate' | 'ai' | 'highlight';
  clips: Clip[]; zooms: Zoom[]; layouts: LayoutSwitch[]; camera: Camera; look: Look; captions: CaptionStyle;
  overlays: Overlay[]; cards: Card[]; audio: AudioMix; media: Placed[]; voiceovers: Placed[];
  tracks: Record<string, { hidden?: boolean; locked?: boolean; muted?: boolean }>;   // key: track name
}
export type Undoable = Partial<Pick<Project, 'wordFixes' | 'chapters' | 'translations'>> & { cut: Cut };   // only the fields the step changed
export interface Step { label: string; before: Undoable; at: number }   // label: "Deleted 13 words"; project-level text undoes too

export interface Project {
  id: string; version: 3;                     // id = recording id
  name: string;                               // project name in the top bar; never empty ("name-empty")
  sources: Source[]; events: boolean;         // events.json exists
  wordFixes: Record<number, string>;          // word index (lib/wordCuts units) → fixed text
  chapters: Chapter[];                        // rec ms; seeded from the notes
  translations: Record<string, string[]>;     // language → one line per caption line
  cuts: Cut[]; current: string;
  history: Record<string, { undo: Step[]; redo: Step[] }>;  // per cut, 200 steps each
  quickWins: 'new' | 'seen';
  options: { lightPreview: boolean; tour: boolean; bakeCamera: boolean };  // bakeCamera: this recording's next re-record; the global default is Settings.bakeCamera
  updatedAt: number;
}

// lib/render/plan.ts: what the renderer draws at one output time. Pure; preview and export share it.
export interface RenderPlan {
  out: number; rec: number | null;            // null: gap or past the end
  screen?: { source: string; t: number; crop: Box; dest: Box; radius: number; shadow: number };
  background: Look['background'];
  camera?: { source: string; t: number; dest: Box; shape: Camera['shape']; mirror: boolean; blur: Camera['blur']; alpha: number };
  cursor?: { x: number; y: number; size: number; click: number; ring?: { x: number; y: number } };   // click: 0..1 ring progress; ring: where it is drawn
  overlays: Overlay[]; cards: Card[]; captions?: { words: { text: string; on: boolean }[]; style: CaptionStyle };
  media?: { source: string; t: number };
  fade: number;                               // 0..1 transition mix with the previous clip
}
export interface Box { x: number; y: number; w: number; h: number }

// Ask AI: closed list of operations over word indexes (never times). lib/ai/ops.ts validates them.
export type AiOp =
  | { op: 'cut' | 'keep'; from: number; to: number }
  | { op: 'move'; from: number; to: number; after: number }
  | { op: 'speed'; from: number; to: number; rate: number }
  | { op: 'zoom'; from: number; to: number; depth: number }
  | { op: 'caption'; style: CaptionStyle['style'] }
  | { op: 'card'; template: string; at: number; slots: Record<string, string> }
  | { op: 'chapter'; at: number; title: string }
  | { op: 'layout'; at: number; layout: LayoutKind }
  | { op: 'newCut'; name: string; shape: Shape; keep: { from: number; to: number }[] };
export interface Draft { request: string; ops: AiOp[]; changes: { label: string; at: number; on: boolean }[];
  before: number; after: number }             // edited lengths, ms

export interface ExportPreset { id: string; name: string; shape: Shape;
  fast: [number, number]; best: [number, number];   // [width, height] for "Fast · 720p" and "Best · 1080p"
  fps: 30; maxMs?: number; maxBytes?: number }      // Custom: no limits, shape from the cut
