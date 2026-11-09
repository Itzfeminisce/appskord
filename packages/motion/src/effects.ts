import { Color, Matrix4, Uniform, Vector2, Vector3 } from 'three';
import type { Camera, Texture } from 'three';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  DotScreenEffect,
  Effect,
  EffectAttribute,
} from 'postprocessing';
import type { FrameState } from './scene';
import type { LookGuide } from './types';

const blurShader = /* glsl */ `
uniform mat4 previousViewProjection;
uniform mat4 inverseViewProjection;
uniform float shutter;
#ifdef USE_VELOCITY
uniform sampler2D velocityBuffer;
#endif

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 world = inverseViewProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  world /= world.w;
  vec4 previous = previousViewProjection * world;
  vec2 velocity = (uv - (previous.xy / previous.w * 0.5 + 0.5)) * shutter;
#ifdef USE_VELOCITY
  // Moving layers write their own screen velocity; elsewhere only the camera moved.
  vec4 layer = texture2D(velocityBuffer, uv);
  if (layer.a > 0.5) velocity = layer.xy * shutter;
#endif
  float pixels = length(velocity / texelSize);
  if (pixels > MAX_PIXELS) velocity *= MAX_PIXELS / pixels;
  vec4 sum = vec4(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float f = float(i) / float(SAMPLES - 1) - 0.5;
    sum += texture2D(inputBuffer, uv + velocity * f);
  }
  outputColor = sum / float(SAMPLES);
}
`;

/** Velocity motion blur: per-layer screen velocity from `velocityBuffer` where given, else depth reprojected with last frame's camera. */
export class VelocityBlurEffect extends Effect {
  constructor(samples: number, shutter = 0.5, velocityBuffer?: Texture) {
    const defines = new Map([
      ['SAMPLES', String(Math.max(2, samples))],
      ['MAX_PIXELS', '48.0'],
    ]);
    const uniforms = new Map<string, Uniform>([
      ['previousViewProjection', new Uniform(new Matrix4())],
      ['inverseViewProjection', new Uniform(new Matrix4())],
      ['shutter', new Uniform(shutter)],
    ]);
    if (velocityBuffer) {
      defines.set('USE_VELOCITY', '1');
      uniforms.set('velocityBuffer', new Uniform(velocityBuffer));
    }
    super('VelocityBlurEffect', blurShader, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      defines,
      uniforms,
    });
  }

  /** Sets the camera one frame ago and now, so the blur depends only on t and the frame interval. */
  track(previous: Camera, current: Camera): void {
    (this.uniforms.get('previousViewProjection')!.value as Matrix4).copy(viewProjection(previous));
    (this.uniforms.get('inverseViewProjection')!.value as Matrix4).copy(viewProjection(current)).invert();
  }
}

function viewProjection(camera: Camera): Matrix4 {
  camera.updateMatrixWorld();
  return new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
}

const finishShader = /* glsl */ `
uniform vec3 lift;
uniform vec3 gain;
uniform float saturation;
uniform float grain;
uniform float frame;
uniform float vignette;
uniform vec2 center;

float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * gain;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  vec2 d = uv - center;
  c *= 1.0 - dot(d, d) * vignette;
  // The chain is linear light; lift and grain are steps on screen, so add them after gamma, or blacks turn to speckle.
  vec3 s = pow(max(c, 0.0), vec3(1.0 / 2.2));
  s += lift * (1.0 - s);
  s += (hash(vec3(floor(uv * resolution), frame)) - 0.5) * grain;
  outputColor = vec4(pow(max(s, 0.0), vec3(2.2)), inputColor.a);
}
`;

/** The finish: a lift/gain grade, saturation, light falloff toward the edges and grain seeded by frame time. */
export class FinishEffect extends Effect {
  constructor({
    lift = new Vector3(0.02, 0.0, 0.05),
    gain = new Vector3(1.05, 1.0, 0.95),
    saturation = 1.1,
    grain = 0.06,
    vignette = 0.7,
    center = new Vector2(0.5, 0.5),
  } = {}) {
    super('FinishEffect', finishShader, {
      uniforms: new Map<string, Uniform>([
        ['lift', new Uniform(lift)],
        ['gain', new Uniform(gain)],
        ['saturation', new Uniform(saturation)],
        ['grain', new Uniform(grain)],
        ['frame', new Uniform(0)],
        ['vignette', new Uniform(vignette)],
        ['center', new Uniform(center)],
      ]),
    });
  }

  /** Grain is seeded by frame time, never by a counter. */
  set frame(ms: number) {
    this.uniforms.get('frame')!.value = ms;
  }
}

// ---- Effects library (EffectsLibrary frame). Strings below are copied from the frame.

export type EffectId =
  | 'glass'
  | 'glow'
  | 'bloom'
  | 'depth-of-field'
  | 'dither'
  | 'distort'
  | 'chromatic'
  | '3d-flip'
  | 'light-sweep'
  | 'grain'
  | 'halftone'
  | 'blur-in';
export type EffectGroup = 'Light' | 'Texture' | 'Distort' | 'Reveal';
export type EffectColour = 'glow' | 'light' | 'ink';
export type EffectScope = 'layer' | 'scene' | 'clip';

export interface EffectEntry {
  id: EffectId;
  name: string;
  group: EffectGroup;
  /** The line under the name, from the frame. */
  line: string;
  /** Default amount 0..1. */
  amount: number;
  colour: boolean;
  /** A postprocessing shader, or keyframes written into the layer's tracks. */
  kind: 'shader' | 'motion';
  /** Samples neighbouring pixels, so it needs its own pass. */
  convolution: boolean;
  /** Dropped first when a slow computer needs a lighter preview. */
  heavy: boolean;
}

const entry = (
  id: EffectId,
  name: string,
  group: EffectGroup,
  o: Partial<Pick<EffectEntry, 'line' | 'amount' | 'colour' | 'kind' | 'convolution' | 'heavy'>> = {},
): EffectEntry => ({
  id,
  name,
  group,
  line: '',
  amount: 0.5,
  colour: false,
  kind: 'shader',
  convolution: false,
  heavy: false,
  ...o,
});

/** The library in the frame's order. */
export const EFFECTS: readonly EffectEntry[] = [
  entry('glass', 'Glass', 'Light', {
    line: 'Frosted glass over what’s behind.',
    amount: 0.5,
    convolution: true,
    heavy: true,
  }),
  entry('glow', 'Glow', 'Light', {
    line: 'A soft halo in your look’s light.',
    amount: 0.6,
    colour: true,
    convolution: true,
  }),
  entry('bloom', 'Bloom', 'Light', { line: 'Bright parts spill soft light.', amount: 0.4 }),
  entry('depth-of-field', 'Depth of field', 'Reveal', {
    line: 'Sharp in focus, soft behind.',
    amount: 0.5,
    convolution: true,
    heavy: true,
  }),
  entry('dither', 'Dither', 'Texture', { line: 'A fine dot pattern, like print.', amount: 0.35 }),
  entry('distort', 'Distort', 'Distort', { line: 'A slow wave runs through it.', amount: 0.3, convolution: true }),
  entry('chromatic', 'Chromatic', 'Distort', {
    line: 'Colour edges split, like a lens.',
    amount: 0.25,
    convolution: true,
  }),
  entry('3d-flip', '3D flip', 'Distort', { line: 'Turns in on its edge, in depth.', amount: 0.7, kind: 'motion' }),
  entry('light-sweep', 'Light sweep', 'Light', { line: 'A sheen of light slides across.', amount: 0.6, colour: true }),
  entry('grain', 'Grain', 'Texture', { line: 'Fine film grain that moves.', amount: 0.2 }),
  entry('halftone', 'Halftone', 'Texture', { line: 'Shading turns into printed dots.', amount: 0.45 }),
  entry('blur-in', 'Blur in', 'Reveal', { line: 'Comes into focus from a blur.', amount: 0.7, kind: 'motion' }),
];
export const EFFECT_FILTERS = ['All', 'Light', 'Texture', 'Distort', 'Reveal'] as const;
export const EFFECT_COLOURS: readonly { id: EffectColour; label: string }[] = [
  { id: 'glow', label: 'Glow' },
  { id: 'light', label: 'Light' },
  { id: 'ink', label: 'Ink' },
];
export const EFFECT_SCOPES: readonly { id: EffectScope; label: string }[] = [
  { id: 'layer', label: 'This layer' },
  { id: 'scene', label: 'This scene' },
  { id: 'clip', label: 'Whole clip' },
];
export const EFFECTS_NOTE = 'Effects run on this computer. Preview may be lighter on a slow computer; export never is.';

export function effectEntry(id: EffectId): EffectEntry {
  const e = EFFECTS.find((x) => x.id === id);
  if (!e) throw new Error(`Motikord: no effect "${id}"`);
  return e;
}

/** An effect added to a clip. CONTRACT.md has no recipe field for it yet; this is the shape the editor writes. */
export interface EffectUse {
  effect: EffectId;
  amount: number;
  colour?: EffectColour;
  scope: EffectScope;
  sceneId?: string;
  layerId?: string;
}

// Palette roles in LookBible order: Ground, Ink, Glow, Panel, Muted. Fallbacks are the frame's swatches.
const FALLBACK: Record<EffectColour, string> = { glow: '#8B9CFF', light: '#B8C1FF', ink: '#F5F5F7' };

/** The hex for a colour choice from the look guide; Light is the glow lifted toward ink. */
export function effectColour(colour: EffectColour, look?: Pick<LookGuide, 'palette'>): string {
  const ink = look?.palette[1];
  const glow = look?.palette[2];
  if (colour === 'ink') return ink ?? FALLBACK.ink;
  if (colour === 'glow') return glow ?? FALLBACK.glow;
  if (!ink || !glow) return FALLBACK.light;
  return `#${new Color(glow).lerp(new Color(ink), 0.42).getHexString().toUpperCase()}`;
}

const clamp = (a: number) => (Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 0);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export type EffectParams = Record<string, number | string | boolean>;

/** The shader numbers for one effect use, from its amount and colour. Pure. */
export function effectParams(use: EffectUse, look?: Pick<LookGuide, 'palette'>): EffectParams {
  const a = clamp(use.amount);
  const colour = effectColour(use.colour ?? 'glow', look);
  switch (use.effect) {
    case 'glass':
      return { refraction: r3(0.02 * a), frost: r3(1 + 5 * a), highlight: r3(0.25 * a) };
    case 'glow':
      return { intensity: r3(2 * a), threshold: r3(0.6 - 0.3 * a), radius: r3(6 + 18 * a), colour };
    case 'bloom':
      return { intensity: r3(2.5 * a), luminanceThreshold: r3(0.8 - 0.4 * a), luminanceSmoothing: 0.2 };
    case 'depth-of-field':
      return { bokehScale: r3(1 + 4 * a), focusRange: r3(4 - 3 * a) };
    case 'dither':
      return { levels: Math.round(16 - 12 * a), pixel: 1 + Math.round(2 * a), mix: r3(a) };
    case 'distort':
      return { strength: r3(0.03 * a), frequency: 6, periodMs: 3000 };
    case 'chromatic':
      return { offset: r3(0.006 * a), radial: true };
    case '3d-flip':
      return { degrees: Math.round(180 * a), ms: 600 };
    case 'light-sweep':
      return { width: r3(0.08 + 0.12 * a), intensity: r3(0.8 * a), periodMs: 2400, colour };
    case 'grain':
      return { amount: r3(0.25 * a) };
    case 'halftone':
      return { scale: r3(1.6 - a), opacity: r3(a), angle: 0.785 };
    case 'blur-in':
      return { blur: r3(24 * a), ms: 600 };
  }
}

export interface PlannedEffect {
  use: EffectUse;
  entry: EffectEntry;
  params: EffectParams;
}

/** The shader effects to draw. Export never drops one; a lighter preview drops the heavy ones. */
export function planEffects(
  uses: readonly EffectUse[],
  { mode, lighter = false, look }: { mode: 'export' | 'preview'; lighter?: boolean; look?: Pick<LookGuide, 'palette'> },
): PlannedEffect[] {
  return uses
    .map((use) => ({ use, entry: effectEntry(use.effect), params: effectParams(use, look) }))
    .filter((p) => p.entry.kind === 'shader' && !(mode === 'preview' && lighter && p.entry.heavy));
}

/** Whether a use shows at this moment: a layer use while its layer is on screen, a scene use in its scene. */
export function isActive(use: EffectUse, sceneId: string, frame?: FrameState): boolean {
  if (use.scope === 'clip') return true;
  if (use.sceneId && use.sceneId !== sceneId) return false;
  if (use.scope === 'scene') return true;
  const layer = frame?.layers.find((l) => l.id === use.layerId);
  return !!layer && layer.local >= 0 && layer.props.opacity > 0;
}

type Keys = { t: number; v: number }[];

/** Keyframes a motion effect writes into the layer's tracks; null for a shader effect. */
export function effectTracks(use: EffectUse): { blur: Keys; opacity: Keys } | { rotateY: Keys } | null {
  if (use.effect === '3d-flip') {
    const ms = effectParams(use).ms as number;
    return {
      rotateY: [
        { t: 0, v: 90 },
        { t: ms, v: 0 },
      ],
    };
  }
  if (use.effect !== 'blur-in') return null;
  const p = effectParams(use);
  const ms = p.ms as number;
  return {
    blur: [
      { t: 0, v: p.blur as number },
      { t: ms, v: 0 },
    ],
    opacity: [
      { t: 0, v: 0 },
      { t: Math.round(ms * 0.6), v: 1 },
    ],
  };
}

// ---- Shaders for the library entries postprocessing does not carry. `clock` is frame time in ms, never a counter.

const HASH = /* glsl */ `
float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
`;

const SHADERS: Partial<Record<EffectId, string>> = {
  glass: /* glsl */ `
uniform float refraction; uniform float frost; uniform float highlight;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 n = vec2(sin(uv.y * 40.0), cos(uv.x * 40.0)) * refraction;
  vec4 c = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    c += texture2D(inputBuffer, uv + n + vec2(cos(a), sin(a)) * texelSize * frost);
  }
  float h = smoothstep(0.0, 1.0, 1.0 - abs(uv.y - uv.x * 0.3 - 0.6) * 6.0) * highlight;
  outputColor = vec4(c.rgb / 8.0 + h, inputColor.a);
}`,
  glow: /* glsl */ `
uniform vec3 colour; uniform float intensity; uniform float threshold; uniform float radius;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float acc = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.523599;
    float r = radius * (i < 6 ? 0.5 : 1.0);
    vec3 s = texture2D(inputBuffer, uv + vec2(cos(a), sin(a)) * texelSize * r).rgb;
    acc += smoothstep(threshold, threshold + 0.2, dot(s, vec3(0.2126, 0.7152, 0.0722)));
  }
  outputColor = vec4(inputColor.rgb + colour * (acc / 12.0) * intensity, inputColor.a);
}`,
  dither: /* glsl */ `
uniform float levels; uniform float pixel; uniform float mixAmount;
float bayer(vec2 p) {
  vec2 q = mod(p, 4.0);
  int i = int(q.x) + int(q.y) * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float d = bayer(floor(uv * resolution / pixel)) - 0.5;
  vec3 q = floor(inputColor.rgb * (levels - 1.0) + 0.5 + d) / (levels - 1.0);
  outputColor = vec4(mix(inputColor.rgb, q, mixAmount), inputColor.a);
}`,
  distort: /* glsl */ `
uniform float strength; uniform float frequency; uniform float periodMs; uniform float clock;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float p = clock / periodMs * 6.283185;
  vec2 o = vec2(sin(uv.y * frequency + p), cos(uv.x * frequency + p * 0.7)) * strength;
  outputColor = texture2D(inputBuffer, uv + o);
}`,
  'light-sweep': /* glsl */ `
uniform vec3 colour; uniform float width; uniform float intensity; uniform float periodMs; uniform float clock;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float x = fract(clock / periodMs) * 2.0 - 0.5;
  float band = 1.0 - smoothstep(0.0, width, abs(uv.x + uv.y * 0.35 - x));
  outputColor = vec4(inputColor.rgb + colour * band * intensity * inputColor.a, inputColor.a);
}`,
  grain: /* glsl */ `
uniform float amount; uniform float clock;
${HASH}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Added after gamma, as the finish's grain is: in linear light it lands as heavy speckle in the darks.
  vec3 s = pow(max(inputColor.rgb, 0.0), vec3(1.0 / 2.2)) + (hash(vec3(floor(uv * resolution), clock)) - 0.5) * amount;
  outputColor = vec4(pow(max(s, 0.0), vec3(2.2)), inputColor.a);
}`,
};

/** A library shader with named uniforms; `clock` follows frame time so effects that move stay deterministic. */
export class LibraryEffect extends Effect {
  constructor(id: EffectId, params: EffectParams) {
    const fragment = SHADERS[id];
    if (!fragment) throw new Error(`Motikord: effect "${id}" has no library shader`);
    const uniforms = new Map<string, Uniform>([['clock', new Uniform(0)]]);
    for (const [k, v] of Object.entries(params)) {
      const name = k === 'mix' ? 'mixAmount' : k;
      if (typeof v === 'number') uniforms.set(name, new Uniform(v));
      else if (k === 'colour') uniforms.set(name, new Uniform(new Color(v as string)));
    }
    super(`Motikord_${id.replace(/-/g, '_')}`, fragment, {
      attributes: effectEntry(id).convolution ? EffectAttribute.CONVOLUTION : EffectAttribute.NONE,
      uniforms,
    });
  }

  set clock(ms: number) {
    this.uniforms.get('clock')!.value = ms;
  }
}

/** Builds the postprocessing effect for a planned use. Bloom, depth of field, chromatic and halftone come from postprocessing. */
export function createEffect(planned: PlannedEffect, camera: Camera): Effect {
  const p = planned.params;
  switch (planned.use.effect) {
    case 'bloom':
      return new BloomEffect({
        intensity: p.intensity as number,
        luminanceThreshold: p.luminanceThreshold as number,
        luminanceSmoothing: p.luminanceSmoothing as number,
        mipmapBlur: true,
      });
    case 'depth-of-field':
      return new DepthOfFieldEffect(camera, {
        focusDistance: 7,
        focusRange: p.focusRange as number,
        bokehScale: p.bokehScale as number,
        resolutionScale: 0.5,
      });
    case 'chromatic':
      return new ChromaticAberrationEffect({
        offset: new Vector2(p.offset as number, (p.offset as number) * 0.5),
        radialModulation: p.radial as boolean,
        modulationOffset: 0.15,
      });
    case 'halftone': {
      const e = new DotScreenEffect({ angle: p.angle as number, scale: p.scale as number });
      e.blendMode.opacity.value = p.opacity as number;
      return e;
    }
    default:
      return new LibraryEffect(planned.use.effect, p);
  }
}
