// CONTRACT.md as code (apps/motikord/v1/CONTRACT.md). Later tasks import these and never redefine them.
export type Aspect = '9:16' | '1:1' | '16:9';
export type ClipType = 'promo' | 'quote' | 'chart' | 'explainer' | 'logo' | 'captions' | 'social';
export type AiMode = 'cloud' | 'local';                     // "Faster with Groq" / "On this computer"
export type Feel = 'smooth' | 'snappy' | 'bouncy' | 'steady';
export type PresetSlot = 'in' | 'during' | 'out';           // "Comes in" / "While on screen" / "Goes out"
export type FileKind = 'mp4' | 'webm' | 'gif' | 'webm-alpha';
export type Quality = '720p' | '1080p';
export type LicenceId = 'cc0' | 'pdm' | 'cc-by' | 'cc-by-sa' | 'cc-by-nc' | 'pexels' | 'page' | 'own';
export type Author = 'groq' | 'builtin' | 'hand' | 'template';

export interface Credit {                                    // every asset someone else made
  title: string; author: string; source: 'openverse' | 'pexels' | 'bundled' | 'page';
  url: string; licence: LicenceId; licenceUrl?: string;
}
export interface Asset {
  id: string; kind: 'image' | 'video' | 'audio' | 'font' | 'logo';
  name: string; mime: string; bytes: number; width?: number; height?: number; durationMs?: number;
  opfsPath: string;                                          // file lives in OPFS, never in the recipe
  credit?: Credit;                                           // absent = your own media ("Not listed")
}

export interface Box { x: number; y: number; w: number; h: number; rotation?: number }
export interface Motion { preset: string; feel: Feel; durationMs: number }   // preset ids from lib/render/presets
export interface LayerBase {
  id: string; name: string; startMs: number; endMs: number;  // relative to the scene start
  box: Box; boxes?: Partial<Record<Aspect, Box>>;            // per-size override ("This size only")
  opacity: number; in?: Motion; during?: Motion; out?: Motion; locked?: boolean;
}
export interface TextLayer extends LayerBase {
  type: 'text'; role: 'title' | 'body' | 'caption' | 'label';
  text: string; font: string; sizePx: number; weight: number; colour: string;   // sizePx at 1080 short side
  align: 'left' | 'center' | 'right'; lineHeight: number; background?: string;
}
export interface ShapeLayer extends LayerBase { type: 'shape'; shape: 'rect' | 'circle' | 'line'; fill: string; radius?: number }
export interface MediaLayer extends LayerBase { type: 'image' | 'video'; assetId: string; fit: 'cover' | 'contain'; muted?: boolean }
export interface ChartLayer extends LayerBase { type: 'chart'; chart: 'bar' | 'line' | 'number'; values: { label: string; value: number }[]; colour: string }
export type Layer = TextLayer | ShapeLayer | MediaLayer | ChartLayer;

export interface Scene { id: string; durationMs: number; background: string; layout: string; layers: Layer[] }
export interface MusicTrack { assetId: string; volume: number; fadeInMs: number; fadeOutMs: number }

export interface Recipe {
  version: 1; id: string; name: string; type: ClipType; aspect: Aspect;   // aspect = size being edited
  scenes: Scene[]; music?: MusicTrack; brandApplied?: boolean; creditsEndCard?: boolean;
  assets: Record<string, Asset>;                             // every asset the clip uses, with its credit
  prompt?: string;                                           // first prompt, for library search
}

export interface Change {                                    // "Changes" tab and undo history
  id: string; at: number; by: Author; summary: string; patch: PatchOp[]; inverse: PatchOp[];
}
export type PatchOp =                                        // RFC 6902 subset; AI edits are only ever these
  | { op: 'replace' | 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'move'; from: string; path: string };

export interface Clip {                                      // library row in IndexedDB
  id: string; recipe: Recipe; history: Change[]; createdAt: number; updatedAt: number;
  thumbnail?: Blob; exportedAt?: number; exports?: { file: string; bytes: number; at: number }[];
}

export interface BrandKit {
  logoAssetId?: string; colours: { hex: string; role: 'primary' | 'accent' | 'text' | 'background' }[];
  headingFont?: string; bodyFont?: string; useForNewClips: boolean;
}

export interface Issue {                                     // quality checker
  id: string; sceneId: string; layerId: string; aspect: Aspect;
  kind: 'overflow' | 'contrast' | 'safe-area' | 'too-fast' | 'too-small' | 'credit-missing';
  fix: PatchOp[];
}

export interface Settings {
  ai: AiMode; keySource: 'penv-app' | 'paste' | null;
  penvApp?: { connectionId: string; org: string; project: string; env: string; keys: string[] };
  defaultType?: ClipType;                                   // "Always use this type": skips detection
  defaultAspect: Aspect; defaultExport: { kind: FileKind; quality: Quality };
  smoothPreview: boolean;                                    // "Keep the preview smooth": drops preview resolution
  libraries: { openverse: boolean; pexels: boolean; allLicences: boolean };
  folderName?: string;                                       // handle itself kept in IndexedDB
  onboarded: boolean;
}

export interface ExportJob {                                 // kept until done, for Recovered
  id: string; clipId: string; kinds: FileKind[]; aspects: Aspect[]; quality: Quality;
  credits: boolean; startedAt: number; status: 'running' | 'done' | 'interrupted' | 'cancelled';
}
