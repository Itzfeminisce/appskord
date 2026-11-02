// The scene model Motikord and Klipkord share: templates, packs, layers and scenes (apps/motikord/v2/CONTRACT.md).
export type Aspect = '9:16' | '1:1' | '16:9';
export type ClipType = 'promo' | 'quote' | 'chart' | 'explainer' | 'logo' | 'captions' | 'social';
export type Feel = 'smooth' | 'snappy' | 'bouncy' | 'steady';
export type PresetSlot = 'in' | 'during' | 'out'; // "Comes in" / "While on screen" / "Goes out"
export type Quality = '720p' | '1080p';
export type StyleId = 'clean' | 'bold' | 'playful' | 'corporate';
export type Pace = 'calm' | 'normal' | 'fast';
export type TransitionKind = 'cut' | 'crossfade' | 'slide' | 'push' | 'wipe' | 'zoom' | 'match';
export type TemplateId =
  | 'title-hook'
  | 'big-statement'
  | 'stat-reveal'
  | 'chart'
  | 'quote'
  | 'list'
  | 'hero'
  | 'split'
  | 'before-after'
  | 'steps'
  | 'logo-sting'
  | 'end-card';
export type SlotKind = 'text' | 'items' | 'media' | 'chart' | 'logo';
export type TypeScale = 'display' | 'headline' | 'body' | 'caption' | 'number';

export interface SlotDef {
  // one named slot in a scene template
  id: string;
  name: string;
  kind: SlotKind; // name is the frame's label ("Headline")
  words?: number; // word limit (text, and each item)
  items?: [number, number]; // min and max items (items, chart bars)
  scale?: TypeScale;
  align?: 'left' | 'center' | 'right';
  optional?: boolean;
  valign?: 'top';
  highlight?: boolean; // one word may carry the accent highlight
  boxes: Record<Aspect, Box>; // 0..1 of the frame, inside the safe area
  motion: { in: string; stagger?: 'word' | 'line'; during?: string }; // preset ids from lib/render/presets
}
export interface SceneTemplate {
  // lib/templates/scenes/<id>.json
  id: TemplateId;
  name: string;
  line: string; // line: the one-line purpose shown on cards
  slots: SlotDef[];
  defaultMs: number;
  fits: string; // fits: plain words the storyboard prompt shows
}
export interface Background {
  kind: 'solid' | 'gradient' | 'blobs' | 'blocks' | 'grain';
  colours: string[];
  angle?: number;
  grain?: number; // grain 0..1; any kind may add grain
  drift?: boolean; // slow background motion
  shapes?: Partial<Record<Aspect, [number, number][]>>; // blocks: the slab per size, placed off the text (lib/templates/blocks)
}
export interface StylePack {
  // lib/templates/packs/<id>.json
  id: StyleId;
  name: string;
  description?: string; // NewLook's line for the pack
  fonts: { display: string; text: string; number: string };
  palette: { bg: string; bg2: string; ink: string; muted: string; accent: string; accent2?: string };
  label?: { bg: string; ink: string }; // a caption slot (not the kicker) drawn as a pill
  background: Background;
  feel: Feel;
  motionMs: number;
  transitions: TransitionKind[];
  clipTypes: ClipType[]; // clipTypes: Auto picks this pack for them
}

export type SlotValue = string | string[] | { assetId: string } | { label: string; value: number }[];
export interface Transition {
  kind: TransitionKind;
  ms: number;
} // into this scene, from the one before
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}
export interface Motion {
  preset: string;
  feel: Feel;
  durationMs: number;
} // preset ids from lib/render/presets
export interface LayerBase {
  id: string;
  name: string;
  startMs: number;
  endMs: number; // relative to the scene start
  box: Box;
  boxes?: Partial<Record<Aspect, Box>>; // per-size override ("This size only")
  opacity: number;
  in?: Motion;
  during?: Motion;
  out?: Motion;
  locked?: boolean;
}
export interface TextLayer extends LayerBase {
  type: 'text';
  role: 'title' | 'body' | 'caption' | 'label';
  text: string;
  font: string;
  sizePx: number;
  weight: number;
  colour: string; // sizePx at 1080 short side
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  background?: string;
  pill?: boolean; // the background hugs the words as a pill instead of filling the box
  letterSpacing?: number; // em
  highlight?: { word: number; colour: string };
  shadow?: boolean;
  stagger?: 'word' | 'line';
  slot?: string;
  scaleAt?: Partial<Record<Aspect, number>>; // sizePx times this on one size (the frame's own type size per shape)
  valign?: 'top'; // lines start at the top of the box instead of its middle
}
export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: 'rect' | 'circle' | 'line';
  fill: string;
  radius?: number;
  slot?: string;
}
export interface MediaLayer extends LayerBase {
  type: 'image' | 'video';
  assetId: string;
  fit: 'cover' | 'contain';
  muted?: boolean;
  radius?: number;
  mask?: 'rounded' | 'circle' | 'blob';
  border?: string;
  kenBurns?: boolean;
  slot?: string;
}
export interface ChartLayer extends LayerBase {
  type: 'chart';
  chart: 'bar' | 'line' | 'number';
  values: { label: string; value: number }[];
  colour: string;
  slot?: string;
}
export type Layer = TextLayer | ShapeLayer | MediaLayer | ChartLayer;
export interface Scene {
  id: string;
  durationMs: number;
  background: string;
  layout: string;
  layers: Layer[];
  // v2, all optional; a scene without `template` is a v1 free-layer scene.
  template?: TemplateId;
  slots?: Record<string, SlotValue>;
  transition?: Transition;
  bg?: Background;
  original?: Record<string, SlotValue>; // slot text before it was shortened ("Show original")
}
export interface BrandKit {
  logoAssetId?: string;
  colours: { hex: string; role: 'primary' | 'accent' | 'text' | 'background' }[];
  headingFont?: string;
  bodyFont?: string;
  useForNewClips: boolean;
}

/** The parts of a clip the renderer reads; a Motikord Recipe is one. */
export interface ClipFrames {
  aspect: Aspect;
  scenes: Scene[];
  style?: StyleId;
}
