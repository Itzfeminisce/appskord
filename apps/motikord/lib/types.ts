// CONTRACT.md as code (apps/motikord/v1/CONTRACT.md). Later tasks import these and never redefine them.
export type Aspect = '9:16' | '1:1' | '16:9';
export type ClipType = 'promo' | 'quote' | 'chart' | 'explainer' | 'logo' | 'captions' | 'social';
export type AiMode = 'cloud' | 'local';                     // "Faster in the cloud" / "On this computer"
export type Provider = 'groq' | 'openai' | 'anthropic' | 'openrouter';   // who runs the cloud AI
export type Feel = 'smooth' | 'snappy' | 'bouncy' | 'steady';
export type PresetSlot = 'in' | 'during' | 'out';           // "Comes in" / "While on screen" / "Goes out"
export type FileKind = 'mp4' | 'webm' | 'gif' | 'webm-alpha';
export type Quality = '720p' | '1080p';
export type LicenceId = 'cc0' | 'pdm' | 'cc-by' | 'cc-by-sa' | 'cc-by-nc' | 'pexels' | 'pixabay' | 'unsplash' | 'unknown' | 'page' | 'own' | 'ai';
// unknown: the source gives no licence ("Check you may use it"); credited like a page grab.
export type MediaSourceId = 'openverse' | 'wikimedia' | 'nasa' | 'museums' | 'ccmixter' | 'pexels' | 'pixabay' | 'freesound' | 'jamendo' | 'unsplash';
export type KeyPlacement = 'bearer' | 'authorization' | 'key' | 'api_key' | 'client_id' | 'header';
export type CustomFormat = 'openverse' | 'wordpress' | 'mediawiki' | 'pexels' | 'pixabay' | 'generic';
export type Author = Provider | 'builtin' | 'hand' | 'template';

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
export type StyleId = 'clean' | 'bold' | 'playful' | 'corporate';
export type LookStyle = StyleId | 'auto';                 // "Auto": picked by clip type
export type Pace = 'calm' | 'normal' | 'fast';
export type Mood = 'upbeat' | 'calm' | 'warm' | 'dramatic' | 'none';   // 'none' = "No music"
export type TransitionKind = 'cut' | 'crossfade' | 'slide' | 'push' | 'wipe' | 'zoom' | 'match';
export type TemplateId = 'title-hook' | 'big-statement' | 'stat-reveal' | 'chart' | 'quote' | 'list'
  | 'hero' | 'split' | 'before-after' | 'steps' | 'logo-sting' | 'end-card';
export type SlotKind = 'text' | 'items' | 'media' | 'chart' | 'logo';
export type TypeScale = 'display' | 'headline' | 'body' | 'caption' | 'number';

export interface SlotDef {                                 // one named slot in a scene template
  id: string; name: string; kind: SlotKind;                // name is the frame's label ("Headline")
  words?: number;                                          // word limit (text, and each item)
  items?: [number, number];                                // min and max items (items, chart bars)
  scale?: TypeScale; align?: 'left' | 'center' | 'right'; optional?: boolean;
  highlight?: boolean;                                     // one word may carry the accent highlight
  boxes: Record<Aspect, Box>;                              // 0..1 of the frame, inside the safe area
  motion: { in: string; stagger?: 'word' | 'line'; during?: string };   // preset ids from lib/render/presets
}
export interface SceneTemplate {                           // lib/templates/scenes/<id>.json
  id: TemplateId; name: string; line: string;              // line: the one-line purpose shown on cards
  slots: SlotDef[]; defaultMs: number; fits: string;       // fits: plain words the storyboard prompt shows
}
export interface Background {
  kind: 'solid' | 'gradient' | 'blobs' | 'blocks' | 'grain';
  colours: string[]; angle?: number; grain?: number;       // grain 0..1; any kind may add grain
  drift?: boolean;                                         // slow background motion
}
export interface StylePack {                               // lib/templates/packs/<id>.json
  id: StyleId; name: string;
  fonts: { display: string; text: string; number: string };
  palette: { bg: string; bg2: string; ink: string; muted: string; accent: string; accent2?: string };
  background: Background; feel: Feel; motionMs: number;
  transitions: TransitionKind[]; clipTypes: ClipType[];   // clipTypes: Auto picks this pack for them
}

export type SlotValue = string | string[] | { assetId: string } | { label: string; value: number }[];
export interface Transition { kind: TransitionKind; ms: number }   // into this scene, from the one before

export interface Beat { template: TemplateId; line: string; ms: number }
export interface Storyboard { name: string; hook: string; style: StyleId; beats: Beat[] }
export interface CriticNote { sceneIndex: number; problem: string; fix: string }

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
  letterSpacing?: number;                                    // em
  highlight?: { word: number; colour: string }; shadow?: boolean; stagger?: 'word' | 'line'; slot?: string;
}
export interface ShapeLayer extends LayerBase { type: 'shape'; shape: 'rect' | 'circle' | 'line'; fill: string; radius?: number; slot?: string }
export interface MediaLayer extends LayerBase {
  type: 'image' | 'video'; assetId: string; fit: 'cover' | 'contain'; muted?: boolean;
  radius?: number; mask?: 'rounded' | 'circle' | 'blob'; border?: string; kenBurns?: boolean; slot?: string;
}
export interface ChartLayer extends LayerBase { type: 'chart'; chart: 'bar' | 'line' | 'number'; values: { label: string; value: number }[]; colour: string; slot?: string }
export type Layer = TextLayer | ShapeLayer | MediaLayer | ChartLayer;

export interface Scene {
  id: string; durationMs: number; background: string; layout: string; layers: Layer[];
  // v2, all optional; a scene without `template` is a v1 free-layer scene.
  template?: TemplateId; slots?: Record<string, SlotValue>; transition?: Transition; bg?: Background;
  original?: Record<string, SlotValue>;                      // slot text before it was shortened ("Show original")
}
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
