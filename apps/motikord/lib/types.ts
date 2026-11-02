// CONTRACT.md as code (apps/motikord/v1/CONTRACT.md). Later tasks import these and never redefine them.
import type { Aspect, ClipType, Pace, Quality, Scene, StyleId, TemplateId } from '@appskord/scenes';
// The scene model moved to @appskord/scenes; re-exported so these paths keep working.
export type { Aspect, ClipType, Feel, PresetSlot, Quality, StyleId, Pace, TransitionKind, TemplateId, SlotKind, TypeScale, SlotDef, SceneTemplate, Background, StylePack, SlotValue, Transition, Box, Motion, LayerBase, TextLayer, ShapeLayer, MediaLayer, ChartLayer, Layer, Scene, BrandKit } from '@appskord/scenes';
export type AiMode = 'cloud' | 'local';                     // "Faster in the cloud" / "On this computer"
export type Provider = 'groq' | 'openai' | 'anthropic' | 'openrouter';   // who runs the cloud AI
export type FileKind = 'mp4' | 'webm' | 'gif' | 'webm-alpha';
export type LicenceId = 'cc0' | 'pdm' | 'cc-by' | 'cc-by-sa' | 'cc-by-nc' | 'pexels' | 'pixabay' | 'unsplash' | 'unknown' | 'page' | 'own' | 'ai';
// unknown: the source gives no licence ("Check you may use it"); credited like a page grab.
export type MediaSourceId = 'openverse' | 'wikimedia' | 'nasa' | 'museums' | 'ccmixter' | 'pexels' | 'pixabay' | 'freesound' | 'jamendo' | 'unsplash';
export type KeyPlacement = 'bearer' | 'authorization' | 'key' | 'api_key' | 'client_id' | 'header';
export type CustomFormat = 'openverse' | 'wordpress' | 'mediawiki' | 'pexels' | 'pixabay' | 'generic';
export type Author = Provider | 'builtin' | 'hand' | 'template' | 'check';   // check: a quality-check fix

export interface Credit {                                    // every asset someone else made
  title: string; author: string; source: MediaSourceId | 'custom' | 'bundled' | 'page' | 'ai';   // ai: "AI image, OpenAI"
  sourceName?: string;                                       // a custom source's name, for "From {source}"
  url: string; licence: LicenceId; licenceUrl?: string;
}
export interface Asset {
  id: string; kind: 'image' | 'video' | 'audio' | 'font' | 'logo';
  name: string; mime: string; bytes: number; width?: number; height?: number; durationMs?: number;
  opfsPath: string;                                          // file lives in OPFS, never in the recipe
  credit?: Credit;                                           // absent = your own media ("Not listed")
}

// v2 (apps/motikord/v2/CONTRACT.md): scene templates, style packs and the look.
export type LookStyle = StyleId | 'auto';                 // "Auto": picked by clip type
export type Mood = 'upbeat' | 'calm' | 'warm' | 'dramatic' | 'none';   // 'none' = "No music"

export interface Beat { template: TemplateId; line: string; ms: number }
export interface Storyboard { name: string; hook: string; style: StyleId; beats: Beat[] }
export interface CriticNote { sceneIndex: number; problem: string; fix: string }


export interface MusicTrack { assetId: string; volume: number; fadeInMs: number; fadeOutMs: number }

export interface Recipe {
  version: 1 | 2; id: string; name: string; type: ClipType; aspect: Aspect;   // aspect = size being edited
  scenes: Scene[]; music?: MusicTrack; brandApplied?: boolean; creditsEndCard?: boolean;
  assets: Record<string, Asset>;                             // every asset the clip uses, with its credit
  prompt?: string;                                           // first prompt, for library search
  style?: StyleId; pace?: Pace; mood?: Mood; beatSync?: boolean;
  beats?: number[];                                          // ms, found locally
}

export interface Change {                                    // "Changes" tab and undo history
  id: string; at: number; by: Author; summary: string; patch: PatchOp[]; inverse: PatchOp[];
  reverts?: string;                                          // the older change this one takes back
}
export type PatchOp =                                        // RFC 6902 subset; AI edits are only ever these
  | { op: 'replace' | 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'move'; from: string; path: string };

export interface Clip {                                      // library row in IndexedDB
  id: string; recipe: Recipe; history: Change[]; createdAt: number; updatedAt: number;
  thumbnail?: Blob; exportedAt?: number; exports?: { file: string; bytes: number; at: number }[];
}


export interface Issue {                                     // quality checker
  id: string; sceneId: string; layerId: string; aspect: Aspect;
  kind: 'overflow' | 'contrast' | 'safe-area' | 'too-fast' | 'too-small' | 'credit-missing'
    | 'overlap' | 'crowding' | 'empty' | 'align' | 'words' | 'template-repeat';
  fix: PatchOp[];
  auto?: boolean;                                            // fixed for you, shown under "Fixed for you" with Undo
  note?: string;
}

export interface Settings {
  ai: AiMode; keySource: 'penv-app' | 'paste' | null;
  provider: Provider;                                        // used when ai is 'cloud'
  models: Partial<Record<Provider, string>>;                 // the model the person picked; absent = recommended
  penvApp?: { connectionId: string; org: string; project: string; env: string; keys: string[] };
  defaultType?: ClipType;                                   // "Always use this type": skips detection
  defaultAspect: Aspect; defaultExport: { kind: FileKind; quality: Quality };
  voiceOn: boolean;                                          // "Speak your prompt": off hides the mic buttons
  voiceLang: string;                                         // BCP-47 for voice prompts; '' = Chrome's language
  smoothPreview: boolean;                                    // "Keep the preview smooth": drops preview resolution
  media: MediaSettings;                                      // "Media sources"; replaces the old libraries field
  folderName?: string;                                       // handle itself kept in IndexedDB
  onboarded: boolean;
  look: { style: LookStyle; pace: Pace; mood: Mood };
  critic: boolean; beatSync: boolean; aiImages: boolean; imageProvider: 'openai'; lookCardSeen: boolean;
}

export interface CustomSource {                              // "Your own sources"; its key lives in session storage only
  id: string; name: string; url: string;                     // url holds {query}
  kinds: ('image' | 'video' | 'audio')[]; format: CustomFormat; on: boolean;
  keyAs?: KeyPlacement; keyHeader?: string;                  // set when the source takes a key
}
export interface MediaSettings {
  on: Partial<Record<MediaSourceId, boolean>>;               // absent = the source's default
  custom: CustomSource[];
  allLicences: boolean;                                      // off = "Only free to use in videos"
}

export interface ExportJob {                                 // kept until done, for Recovered
  id: string; clipId: string; kinds: FileKind[]; aspects: Aspect[]; quality: Quality;
  credits: boolean; startedAt: number; status: 'running' | 'done' | 'interrupted' | 'cancelled';
}
