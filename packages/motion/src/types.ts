// The v3 recipe (Motikord v3 CONTRACT.md). Others import these; never redefine them.

export type Curve =
  | { kind: 'bezier'; p: [number, number, number, number] }
  | { kind: 'spring'; bounce: number; ms: number }; // "Spring · {bounce}% bounce"
export type Feel = 'smooth' | 'snappy' | 'bouncy' | 'steady' | 'floaty';
export interface Key<T> {
  t: number;
  v: T;
  curve?: Curve;
} // t in ms from the layer's start
export type Track<T> = Key<T>[];
export type Depth = 'front' | 'middle' | 'back'; // parallax 1.0 / 0.6 / 0.3
export type CameraMove = 'push-in' | 'pull-out' | 'pan' | 'orbit' | 'rack-focus' | 'hold';
export interface LayerV3 {
  id: string;
  kind: 'text' | 'shape' | 'path' | 'media' | 'lottie' | 'icon' | 'particles' | 'chart' | 'model';
  depth: Depth;
  z?: number;
  slotId?: string;
  tracks: Partial<
    Record<
      'x' | 'y' | 'z' | 'scale' | 'rotate' | 'opacity' | 'blur' | 'weight' | 'width' | 'draw' | 'morph' | 'mask',
      Track<number>
    >
  >;
  type?: { unit: 'letter' | 'word' | 'line'; fill?: boolean }; // kinetic type
  carry?: string; // continuity id shared with a layer in the next scene
  seed?: number; // particles and physics
  start?: number; // T1 addition: ms from the scene's start; absent means hierarchy-timed after the layer before it
}
export interface CameraV3 {
  move: CameraMove;
  amount: number;
  focus?: string /* layer id */;
}
export interface Finish {
  on: boolean;
  blur: number;
  light: number;
  grain: number;
  grade: number;
} // 0..1
export interface LookGuide {
  id: string;
  name: string;
  palette: string[];
  type: { display: string; text: string };
  feel: Feel;
  light: 'left' | 'right' | 'top' | 'none';
  texture: number;
  camera: CameraMove;
}
export interface SceneV3 {
  version: 3;
  id: string;
  templateId: string;
  ms: number;
  layers: LayerV3[];
  camera: CameraV3;
  transition: { kind: string; carry?: string[] };
  keyFrameApproved?: boolean;
}
export interface ClipV3 {
  version: 3;
  scenes: SceneV3[];
  lookGuideId: string;
  packId: string;
  fps: 30 | 60;
  finish: Finish;
  restyledFrom?: string /* v2 clip id kept in Changes */;
}

export type Prop = keyof LayerV3['tracks'];
export type Unit = NonNullable<LayerV3['type']>['unit'];

export const LAYER_KINDS: readonly LayerV3['kind'][] = [
  'text',
  'shape',
  'path',
  'media',
  'lottie',
  'icon',
  'particles',
  'chart',
  'model',
];
export const DEPTHS: readonly Depth[] = ['front', 'middle', 'back'];
export const CAMERA_MOVES: readonly CameraMove[] = ['push-in', 'pull-out', 'pan', 'orbit', 'rack-focus', 'hold'];
export const FEELS: readonly Feel[] = ['smooth', 'snappy', 'bouncy', 'steady', 'floaty'];
export const UNITS: readonly Unit[] = ['letter', 'word', 'line'];
export const PROPS: readonly Prop[] = [
  'x',
  'y',
  'z',
  'scale',
  'rotate',
  'opacity',
  'blur',
  'weight',
  'width',
  'draw',
  'morph',
  'mask',
];
export const LIGHTS: readonly LookGuide['light'][] = ['left', 'right', 'top', 'none'];
export const PARALLAX: Readonly<Record<Depth, number>> = { front: 1, middle: 0.6, back: 0.3 };
