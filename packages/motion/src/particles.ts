import * as THREE from 'three';
import {
  ApplyForce,
  BatchedRenderer,
  CircleEmitter,
  ConstantColor,
  ConstantValue,
  GridEmitter,
  IntervalValue,
  ParticleSystem,
  RenderMode,
  RotationOverLife,
  Vector3 as QVector3,
  Vector4,
} from 'three.quarks';
import type { Behavior, EmitterShape, Particle } from 'three.quarks';
import { loadPhysics, STEP, World2D } from './physics';
import type { Rect } from './physics';
import { UNIT } from './scene';
import { seeded, withRandom } from './seed';
import { frameAtMs, frameCount } from './time';

export type ParticlePreset = 'confetti' | 'sparks' | 'dust' | 'bubbles' | 'snow' | 'text-burst';
export const PARTICLE_PRESETS: readonly ParticlePreset[] = [
  'confetti',
  'sparks',
  'dust',
  'bubbles',
  'snow',
  'text-burst',
];
export const PARTICLE_LABELS: Readonly<Record<ParticlePreset, string>> = {
  confetti: 'Confetti',
  sparks: 'Sparks',
  dust: 'Dust',
  bubbles: 'Bubbles',
  snow: 'Snow',
  'text-burst': 'Text burst',
};

/** The Particles panel: Amount, Size (px), Speed (×), "Falls with gravity", "Bounces off text". */
export interface ParticleSettings {
  preset: ParticlePreset;
  amount: number;
  size: number;
  speed: number;
  gravity: boolean;
  bounce: boolean;
}
export const PARTICLE_DEFAULTS: ParticleSettings = {
  preset: 'confetti',
  amount: 120,
  size: 6,
  speed: 1.2,
  gravity: true,
  bounce: true,
};

export interface ParticleInput {
  settings: ParticleSettings;
  seed: number;
  ms: number;
  fps: number;
  /** Frame size in recipe px. */
  frame?: { w: number; h: number };
  /** Where bursts and sparks start, recipe px from the frame's centre. */
  origin?: { x: number; y: number };
  /** The words' boxes particles bounce off. */
  colliders?: readonly Rect[];
}

/** Particles run once and saved: per frame, every live particle as Int16 x, y, size×10, rotate×10, alpha×1000, colour index. */
export interface ParticleBake {
  key: string;
  fps: number;
  counts: number[];
  data: string;
}
export interface ParticleSample {
  x: number;
  y: number;
  size: number;
  rotate: number;
  alpha: number;
  color: number;
}
const STRIDE = 6;
/** Palette slots a particle can take; the look guide's palette fills them in order, wrapping. */
export const COLOR_SLOTS = 5;

interface Shape {
  emit: 'top' | 'bottom' | 'area' | 'point';
  speed: [number, number];
  life: [number, number];
  /** Recipe px/s², down, when "Falls with gravity" is on. */
  gravity: number;
  spin: number;
  sway: number;
  alpha: number;
  burst: boolean;
}
const SHAPES: Readonly<Record<ParticlePreset, Shape>> = {
  confetti: { emit: 'top', speed: [120, 260], life: [4, 6], gravity: 600, spin: 6, sway: 40, alpha: 1, burst: false },
  sparks: {
    emit: 'point',
    speed: [300, 700],
    life: [0.5, 1.1],
    gravity: 500,
    spin: 0,
    sway: 0,
    alpha: 1,
    burst: false,
  },
  dust: { emit: 'area', speed: [0, 0], life: [3, 6], gravity: 15, spin: 1, sway: 14, alpha: 0.5, burst: false },
  bubbles: {
    emit: 'bottom',
    speed: [80, 160],
    life: [8, 12],
    gravity: -120,
    spin: 0,
    sway: 25,
    alpha: 0.8,
    burst: false,
  },
  snow: { emit: 'top', speed: [40, 90], life: [10, 14], gravity: 40, spin: 1, sway: 30, alpha: 0.9, burst: false },
  'text-burst': {
    emit: 'point',
    speed: [250, 600],
    life: [1.2, 2],
    gravity: 400,
    spin: 8,
    sway: 0,
    alpha: 1,
    burst: true,
  },
};

/** Per-particle look the bake needs that quarks does not keep: palette slot and sway phase. */
const looks = new WeakMap<Particle, { color: number; phase: number }>();

class Look implements Behavior {
  type = 'MotikordLook';
  constructor(private readonly sway: number) {}
  initialize(p: Particle): void {
    looks.set(p, { color: Math.floor(Math.random() * COLOR_SLOTS), phase: Math.random() * Math.PI * 2 });
  }
  update(p: Particle, delta: number): void {
    if (!this.sway) return;
    p.position.x += Math.cos(p.age * 2 + looks.get(p)!.phase) * this.sway * delta;
  }
  frameUpdate(): void {}
  toJSON(): unknown {
    return { type: this.type };
  }
  clone(): Behavior {
    return new Look(this.sway);
  }
  reset(): void {}
}

function emitter(shape: Shape, frame: { w: number; h: number }): { shape: EmitterShape; y: number; rotateX: number } {
  // Grids emit along local +z; turning them a quarter about x aims them down (+y) or up the y-down frame.
  if (shape.emit === 'top')
    return {
      shape: new GridEmitter({ width: frame.w, height: 0, column: 64, row: 1 }),
      y: -frame.h / 2 - 20,
      rotateX: -Math.PI / 2,
    };
  if (shape.emit === 'bottom')
    return {
      shape: new GridEmitter({ width: frame.w, height: 0, column: 64, row: 1 }),
      y: frame.h / 2 + 20,
      rotateX: Math.PI / 2,
    };
  if (shape.emit === 'area')
    return { shape: new GridEmitter({ width: frame.w, height: frame.h, column: 32, row: 56 }), y: 0, rotateX: 0 };
  return { shape: new CircleEmitter({ radius: 30, thickness: 1 }), y: 0, rotateX: 0 };
}

function system(input: ParticleInput, physics: boolean): { batch: BatchedRenderer; system: ParticleSystem } {
  const { settings } = input;
  const s = SHAPES[settings.preset];
  const frame = input.frame ?? { w: 1080, h: 1920 };
  const e = emitter(s, frame);
  const life = (s.life[0] + s.life[1]) / 2;
  const behaviors: Behavior[] = [new Look(physics ? 0 : s.sway)];
  if (settings.gravity && !physics) behaviors.push(new ApplyForce(new QVector3(0, 1, 0), new ConstantValue(s.gravity)));
  if (s.spin) behaviors.push(new RotationOverLife(new IntervalValue(-s.spin, s.spin)));
  const sys = new ParticleSystem({
    duration: (input.ms / 1000) * settings.speed + 1,
    looping: false,
    worldSpace: true,
    shape: e.shape,
    startLife: new IntervalValue(...s.life),
    startSpeed: new IntervalValue(...s.speed),
    startSize: new IntervalValue(settings.size * 0.7, settings.size * 1.3),
    startRotation: new IntervalValue(0, Math.PI * 2),
    startColor: new ConstantColor(new Vector4(1, 1, 1, s.alpha)),
    emissionOverTime: new ConstantValue(s.burst ? 0 : settings.amount / life),
    emissionBursts: s.burst
      ? [{ time: 0, count: new ConstantValue(settings.amount), cycle: 1, interval: 0.01, probability: 1 }]
      : [],
    material: new THREE.MeshBasicMaterial(),
    renderMode: RenderMode.BillBoard,
    behaviors,
  });
  const origin = s.emit === 'point' ? (input.origin ?? { x: 0, y: 0 }) : { x: 0, y: e.y };
  sys.emitter.position.set(origin.x, origin.y, 0);
  sys.emitter.rotation.x = e.rotateX;
  const batch = new BatchedRenderer();
  batch.addSystem(sys);
  const scene = new THREE.Scene();
  scene.add(sys.emitter, batch);
  scene.updateMatrixWorld(true);
  return { batch, system: sys };
}

/** A short stable key of everything a bake depends on, so a changed setting re-bakes. */
export function bakeKey(input: ParticleInput): string {
  const text = JSON.stringify([
    input.settings,
    input.seed,
    input.ms,
    input.fps,
    input.frame,
    input.origin,
    input.colliders,
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const clamp16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

/**
 * Runs the particles once with three.quarks, seeded, and returns the saved bake. With "Bounces off text" rapier moves
 * the particles and the words are its colliders. The frame at t then reads only the bake.
 */
export async function bakeParticles(input: ParticleInput): Promise<ParticleBake> {
  const settings = { ...input.settings, speed: Math.max(0.05, input.settings.speed) };
  const physics = settings.bounce && (input.colliders?.length ?? 0) > 0;
  if (physics) await loadPhysics();
  const random = seeded(input.seed);
  const s = SHAPES[settings.preset];
  const frame = input.frame ?? { w: 1080, h: 1920 };
  let batch: BatchedRenderer | undefined;
  let sys: ParticleSystem | undefined;
  let world: World2D | null = null;
  const bodies = new Map<Particle, { id: number; age: number }>();
  const counts: number[] = [];
  const out: number[] = [];
  const dt = STEP * settings.speed;
  const frames = frameCount(input.ms, input.fps);
  let steps = 0;
  try {
    ({ batch, system: sys } = withRandom(random, () => system({ ...input, settings }, physics)));
    const live = sys;
    if (physics) world = new World2D(settings.gravity ? s.gravity : 0, input.colliders!, 0.6, dt);
    for (let i = 0; i < frames; i++) {
      for (; steps < Math.round(i / input.fps / STEP); steps++) {
        world?.step();
        withRandom(random, () => batch!.update(dt));
        if (world) sync(world, live.particles.slice(0, live.particleNum), bodies, settings.size);
      }
      let n = 0;
      for (const p of live.particles.slice(0, live.particleNum)) {
        if (p.age >= p.life || Math.abs(p.position.x) > frame.w || Math.abs(p.position.y) > frame.h) continue;
        const fade = Math.min(1, p.age / 0.2, (p.life - p.age) / 0.4);
        const rotate = typeof p.rotation === 'number' ? ((p.rotation * 180) / Math.PI) % 360 : 0;
        out.push(
          clamp16(p.position.x),
          clamp16(p.position.y),
          clamp16(p.size.x * 10),
          clamp16(rotate * 10),
          clamp16(p.color.w * fade * 1000),
          looks.get(p)?.color ?? 0,
        );
        n++;
      }
      counts.push(n);
    }
  } finally {
    if (sys) batch?.deleteSystem(sys);
    batch?.dispose?.();
    (sys?.material as THREE.Material | undefined)?.dispose?.();
    sys?.dispose?.();
    world?.free();
  }
  return { key: bakeKey(input), fps: input.fps, counts, data: encode(new Int16Array(out)) };
}

/** Rapier owns where particles go: new ones become balls, live ones read back, dead ones leave the world. */
function sync(
  world: World2D,
  live: Particle[],
  bodies: Map<Particle, { id: number; age: number }>,
  size: number,
): void {
  const seen = new Set<Particle>();
  for (const p of live) {
    seen.add(p);
    const known = bodies.get(p);
    if (known && p.age >= known.age) {
      const b = world.read(known.id);
      p.position.set(b.x, b.y, 0);
      p.velocity.set(b.vx, b.vy, 0);
      known.age = p.age;
      continue;
    }
    if (known) world.remove(known.id);
    const id = world.addBall({ x: p.position.x, y: p.position.y, vx: p.velocity.x, vy: p.velocity.y }, size / 2, 0.6);
    bodies.set(p, { id, age: p.age });
  }
  for (const [p, b] of bodies)
    if (!seen.has(p)) {
      world.remove(b.id);
      bodies.delete(p);
    }
}

function encode(a: Int16Array): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

interface Decoded {
  data: Int16Array;
  offsets: number[];
}
function decode(bake: ParticleBake): Decoded {
  const s = atob(bake.data);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const offsets: number[] = [];
  let o = 0;
  for (const n of bake.counts) {
    offsets.push(o);
    o += n * STRIDE;
  }
  return { data: new Int16Array(bytes.buffer), offsets };
}
const decodedBakes = new WeakMap<ParticleBake, Decoded>();
const decodeCached = (bake: ParticleBake): Decoded => {
  let d = decodedBakes.get(bake);
  if (!d) decodedBakes.set(bake, (d = decode(bake)));
  return d;
};

/** The saved particles at `t` ms from the layer's start. Pure: reads the bake only. */
export function particlesAt(bake: ParticleBake, t: number): ParticleSample[] {
  if (t < 0 || !bake.counts.length) return [];
  const i = Math.min(bake.counts.length - 1, frameAtMs(t, bake.fps));
  const { data, offsets } = decodeCached(bake);
  const out: ParticleSample[] = [];
  for (let k = 0, o = offsets[i]!; k < bake.counts[i]!; k++, o += STRIDE)
    out.push({
      x: data[o]!,
      y: data[o + 1]!,
      size: data[o + 2]! / 10,
      rotate: data[o + 3]! / 10,
      alpha: data[o + 4]! / 1000,
      color: data[o + 5]!,
    });
  return out;
}

/**
 * Writes the frame at `t` ms into caller-owned typed arrays and returns the particle count. No allocation.
 * positions: x, y (recipe px, y down), rotate (deg) per particle; colours: alpha, palette slot per particle.
 */
export function fillFrame(
  bake: ParticleBake,
  t: number,
  positions: Float32Array,
  colours: Float32Array,
  sizes: Float32Array,
  decoded: Decoded = decodeCached(bake),
): number {
  if (t < 0 || !bake.counts.length) return 0;
  const i = Math.min(bake.counts.length - 1, frameAtMs(t, bake.fps));
  const { data, offsets } = decoded;
  const n = Math.min(bake.counts[i]!, sizes.length);
  for (let k = 0, o = offsets[i]!; k < n; k++, o += STRIDE) {
    positions[k * 3] = data[o]!;
    positions[k * 3 + 1] = data[o + 1]!;
    positions[k * 3 + 2] = data[o + 3]! / 10;
    colours[k * 2] = data[o + 4]! / 1000;
    colours[k * 2 + 1] = data[o + 5]!;
    sizes[k] = data[o + 2]! / 10;
  }
  return n;
}

const vertex = /* glsl */ `
attribute float size;
attribute float spin;
attribute vec4 tint;
uniform float pixels;
varying vec4 vTint;
varying float vSpin;
void main() {
  vTint = tint;
  vSpin = spin;
  gl_PointSize = size * pixels;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const fragment = /* glsl */ `
uniform int shape;
varying vec4 vTint;
varying float vSpin;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vSpin), s = sin(vSpin);
  p = mat2(c, -s, s, c) * p;
  float a;
  if (shape == 1) a = step(abs(p.x), 0.5) * step(abs(p.y), 0.25);
  else if (shape == 2) a = smoothstep(0.5, 0.42, length(p)) * (0.35 + 0.65 * smoothstep(0.3, 0.45, length(p)));
  else a = smoothstep(0.5, 0.2, length(p));
  if (a * vTint.a < 0.01) discard;
  gl_FragColor = vec4(vTint.rgb, vTint.a * a);
}`;

/** Draws a bake as points under a layer group. `pixels` is device px per recipe px. */
export class ParticlesView {
  readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly colors: THREE.Color[];
  private readonly decoded: Decoded;
  private readonly scratch: { positions: Float32Array; colours: Float32Array; sizes: Float32Array };

  constructor(
    private readonly bake: ParticleBake,
    preset: ParticlePreset,
    palette: readonly string[],
    pixels: number,
  ) {
    this.colors = Array.from(
      { length: COLOR_SLOTS },
      (_, i) => new THREE.Color(palette[i % palette.length] ?? '#ffffff'),
    );
    const max = Math.max(1, ...bake.counts);
    this.decoded = decode(bake);
    this.scratch = {
      positions: new Float32Array(max * 3),
      colours: new Float32Array(max * 2),
      sizes: new Float32Array(max),
    };
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(max), 1));
    this.geometry.setAttribute('spin', new THREE.BufferAttribute(new Float32Array(max), 1));
    this.geometry.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(max * 4), 4));
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        pixels: { value: pixels },
        shape: { value: preset === 'confetti' ? 1 : preset === 'bubbles' ? 2 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: preset === 'sparks' || preset === 'text-burst' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** Shows the saved frame at `t` ms from the layer's start. */
  update(t: number): void {
    const { positions, colours, sizes } = this.scratch;
    const n = fillFrame(this.bake, t, positions, colours, sizes, this.decoded);
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const size = this.geometry.getAttribute('size') as THREE.BufferAttribute;
    const spin = this.geometry.getAttribute('spin') as THREE.BufferAttribute;
    const tint = this.geometry.getAttribute('tint') as THREE.BufferAttribute;
    for (let k = 0; k < n; k++) {
      pos.setXYZ(k, positions[k * 3]! * UNIT, -positions[k * 3 + 1]! * UNIT, 0);
      size.setX(k, sizes[k]!);
      spin.setX(k, (positions[k * 3 + 2]! * Math.PI) / 180);
      const c = this.colors[colours[k * 2 + 1]! % COLOR_SLOTS]!;
      tint.setXYZW(k, c.r, c.g, c.b, colours[k * 2]!);
    }
    for (const a of [pos, size, spin, tint]) a.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
