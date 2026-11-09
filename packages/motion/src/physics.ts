import RAPIER from '@dimforge/rapier2d-compat';
import { LINEAR } from './curves';
import { seeded } from './seed';
import { frameCount, frameMs } from './time';
import type { LayerV3, Track } from './types';

let ready: Promise<void> | undefined;
/** Loads the bundled rapier wasm once; no remote code. */
export function loadPhysics(): Promise<void> {
  return (ready ??= RAPIER.init());
}

/** An axis-aligned box in recipe px, centred on x, y (y down, 0 at the frame's centre). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Body2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
}

/** Recipe px per rapier metre, so the solver works at human scale. */
const PX = 100;
/** Fixed solver step in seconds; steps never depend on wall time. */
export const STEP = 1 / 120;
// Moving bodies only hit the static colliders (membership << 16 | filter), never each other.
const MOVING = (0x0001 << 16) | 0x0002;
const STATIC = (0x0002 << 16) | 0x0001;

/** A 2D rapier world in recipe px. Call `loadPhysics()` first. Same inputs in the same order give the same steps. */
export class World2D {
  private readonly world: RAPIER.World;
  private readonly bodies = new Map<number, RAPIER.RigidBody>();
  private next = 0;

  constructor(gravity: number, colliders: readonly Rect[], restitution: number, timestep = STEP) {
    this.world = new RAPIER.World({ x: 0, y: gravity / PX });
    this.world.timestep = timestep;
    for (const r of colliders) {
      const desc = RAPIER.ColliderDesc.cuboid(r.w / 2 / PX, r.h / 2 / PX)
        .setTranslation(r.x / PX, r.y / PX)
        .setRestitution(restitution)
        .setCollisionGroups(STATIC);
      this.world.createCollider(desc);
    }
  }

  private add(b: Partial<Body2D> & { x: number; y: number }, shape: RAPIER.ColliderDesc, restitution: number): number {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(b.x / PX, b.y / PX)
        .setRotation(((b.angle ?? 0) * Math.PI) / 180)
        .setLinvel((b.vx ?? 0) / PX, (b.vy ?? 0) / PX)
        .setAngvel(((b.spin ?? 0) * Math.PI) / 180),
    );
    this.world.createCollider(shape.setRestitution(restitution).setFriction(0.3).setCollisionGroups(MOVING), body);
    const id = this.next++;
    this.bodies.set(id, body);
    return id;
  }

  addBall(b: Partial<Body2D> & { x: number; y: number }, radius: number, restitution: number): number {
    return this.add(b, RAPIER.ColliderDesc.ball(Math.max(0.5, radius) / PX), restitution);
  }

  addBox(b: Partial<Body2D> & { x: number; y: number }, w: number, h: number, restitution: number): number {
    return this.add(b, RAPIER.ColliderDesc.cuboid(w / 2 / PX, h / 2 / PX), restitution);
  }

  remove(id: number): void {
    const body = this.bodies.get(id);
    if (body) this.world.removeRigidBody(body);
    this.bodies.delete(id);
  }

  /** One fixed step of the world's timestep. */
  step(): void {
    this.world.step();
  }

  read(id: number): Body2D {
    const body = this.bodies.get(id)!;
    const p = body.translation();
    const v = body.linvel();
    return {
      x: p.x * PX,
      y: p.y * PX,
      vx: v.x * PX,
      vy: v.y * PX,
      angle: (body.rotation() * 180) / Math.PI,
      spin: (body.angvel() * 180) / Math.PI,
    };
  }

  free(): void {
    this.world.free();
  }
}

/** A layer that falls and settles: its box in recipe px and an optional push. */
export interface SecondaryBody {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  vx?: number;
  vy?: number;
  spin?: number;
}
export interface SecondaryInput {
  seed: number;
  ms: number;
  fps: number;
  /** Recipe px/s², down. */
  gravity: number;
  /** 0..1: how much a body bounces off the words and the floor. */
  bounce: number;
  colliders: readonly Rect[];
  bodies: readonly SecondaryBody[];
}
export type SecondaryTracks = Record<string, Pick<LayerV3['tracks'], 'x' | 'y' | 'rotate'>>;

/** Secondary motion run once and saved: rapier simulates the bodies, and every frame becomes an x, y, rotate key in the recipe. */
export async function bakeSecondary(input: SecondaryInput): Promise<SecondaryTracks> {
  await loadPhysics();
  const rand = seeded(input.seed);
  const world = new World2D(input.gravity, input.colliders, input.bounce);
  const ids = input.bodies.map((b) =>
    // A small seeded nudge so a row of pieces does not fall in lockstep.
    world.addBox(
      { ...b, vx: (b.vx ?? 0) + (rand() - 0.5) * 40, spin: (b.spin ?? 0) + (rand() - 0.5) * 60 },
      b.w,
      b.h,
      input.bounce,
    ),
  );
  const out: SecondaryTracks = {};
  const tracks = input.bodies.map((b) => {
    const t = { x: [] as Track<number>, y: [] as Track<number>, rotate: [] as Track<number> };
    out[b.id] = t;
    return t;
  });
  const frames = frameCount(input.ms, input.fps);
  let steps = 0;
  try {
    for (let i = 0; i < frames; i++) {
      const at = frameMs(i, input.fps);
      for (; steps < Math.round(at / 1000 / STEP); steps++) world.step();
      ids.forEach((id, k) => {
        const b = world.read(id);
        const t = tracks[k]!;
        t.x.push({ t: at, v: round(b.x), curve: LINEAR });
        t.y.push({ t: at, v: round(b.y), curve: LINEAR });
        t.rotate.push({ t: at, v: round(b.angle), curve: LINEAR });
      });
    }
  } finally {
    world.free();
  }
  return out;
}

const round = (v: number): number => Math.round(v * 100) / 100;
