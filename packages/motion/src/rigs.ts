// Rigs: bones on a shape or SVG layer, posed by moves keyframed into tracks on one hidden layer per bone.
// Pure: a bone's pose at t comes from its layer's tracks (frameAt), and `poseBones` turns poses into joints.
import type { Key, LayerV3, Track } from './types';

export type Point = [number, number];
export type BoneId = 'body' | 'arm-left' | 'arm-right' | 'lid';
export interface Bone {
  id: BoneId;
  name: string;
  parent?: BoneId;
  /** Index of the parent's joint this bone hangs from. */
  at?: number;
  /** The pivot then the end of each joint, in the layer's px (0,0 at its centre, y down). */
  points: Point[];
  /** -1 on the left, 1 on the right: moves mirror across the body. */
  side: -1 | 0 | 1;
}
export type RigMove = 'wave' | 'hop' | 'nod' | 'lean' | 'breathe';
export const RIG_MOVES: readonly [RigMove, string][] = [
  ['wave', 'Wave'],
  ['hop', 'Hop'],
  ['nod', 'Nod'],
  ['lean', 'Lean'],
  ['breathe', 'Idle breathe'],
];
export interface RigSettings {
  moves: Partial<Record<BoneId, RigMove>>;
  /** Squash and stretch, 0..1. */
  squash: number;
  /** Follow-through: arms and lid settle a beat after the body stops. */
  follow: boolean;
}
export const RIG_DEFAULTS: Readonly<RigSettings> = { moves: {}, squash: 0.4, follow: true };
/** How long the arms and lid trail the body with follow-through on. */
export const FOLLOW_MS = 120;

/** Shapes and SVGs take bones; photos, video, words and animations do not. */
export const RIGGABLE: readonly LayerV3['kind'][] = ['shape', 'path', 'icon'];
export const canRig = (layer: Pick<LayerV3, 'kind'>): boolean => RIGGABLE.includes(layer.kind);

/** "Auto rig from shape": a body up the middle (3 joints), an arm each side (2 joints) and a lid on top (1 joint). */
export function autoRig(size: { w: number; h: number }): Bone[] {
  const { w, h } = size;
  const bottom = h / 2;
  const top = -h / 2;
  const body: Point[] = [0, 1, 2, 3].map((i) => [0, bottom + ((top - bottom) * i) / 3] as Point);
  const shoulder = body[1]![1];
  const arm = (s: -1 | 1): Point[] => [
    [(s * w) / 2, shoulder],
    [s * (w / 2 + w * 0.18), shoulder + h * 0.12],
    [s * (w / 2 + w * 0.24), shoulder + h * 0.28],
  ];
  return [
    { id: 'body', name: 'Body', points: body, side: 0 },
    { id: 'arm-left', name: 'Arm left', parent: 'body', at: 1, points: arm(-1), side: -1 },
    { id: 'arm-right', name: 'Arm right', parent: 'body', at: 1, points: arm(1), side: 1 },
    { id: 'lid', name: 'Lid', parent: 'body', at: 3, points: [body[3]!, [0, top - h * 0.18]], side: 0 },
  ];
}

export const jointCount = (b: Bone): number => b.points.length - 1;
/** "root · 3 joints", "2 joints · Wave", "1 joint". */
export function boneLine(b: Bone, move?: RigMove): string {
  const n = jointCount(b);
  const joints = `${n} ${n === 1 ? 'joint' : 'joints'}`;
  const parts = [b.parent ? joints : `root · ${joints}`];
  if (move) parts.push(RIG_MOVES.find(([id]) => id === move)![1]);
  return parts.join(' · ');
}

const key = (t: number, v: number): Key<number> => ({ t, v });
const keys = (pairs: readonly [number, number][]): Track<number> => pairs.map(([t, v]) => key(t, v));
type BoneTracks = Pick<LayerV3['tracks'], 'rotate' | 'y' | 'scale'>;

/**
 * A move's keys for one bone. On a bone layer `rotate` is the bend in degrees, `y` a lift in px and `scale` the
 * stretch along the bone (squash below 1).
 */
export function moveTracks(move: RigMove | undefined, bone: Pick<Bone, 'side' | 'parent'>, squash: number): BoneTracks {
  const s = bone.side || 1;
  const big = bone.parent && bone.side ? 1 : 0.25;
  const q = Math.min(1, Math.max(0, squash));
  switch (move) {
    case 'wave':
      return {
        rotate: keys(
          [0, 250, 450, 650, 850, 1050, 1300].map((t, i) => [t, i === 0 || i === 6 ? 0 : s * big * (i % 2 ? 70 : 40)]),
        ),
      };
    case 'hop':
      return {
        y: keys([
          [0, 0],
          [150, 0],
          [400, -80],
          [650, 0],
        ]),
        scale: keys([
          [0, 1],
          [150, 1 - 0.3 * q],
          [400, 1 + 0.2 * q],
          [650, 1 - 0.2 * q],
          [800, 1],
        ]),
      };
    case 'nod':
      return { rotate: keys([0, 200, 400, 600, 800].map((t, i) => [t, i % 2 ? 14 * s : 0])) };
    case 'lean':
      return {
        rotate: keys([
          [0, 0],
          [500, -12 * s],
          [1300, -12 * s],
          [1800, 0],
        ]),
      };
    case 'breathe':
      return {
        scale: keys([
          [0, 1],
          [1200, 1.04],
          [2400, 1],
        ]),
      };
    default:
      return { rotate: [key(0, 0)] };
  }
}

/** A bone's hidden layer id: `<layer id>~bone~<bone>`. */
export const boneLayerId = (host: string, bone: BoneId) => `${host}~bone~${bone}`;

/** The bone layers for a rig on `host`; they never draw (opacity 0) and carry the pose in their tracks. */
export function rigLayers(
  host: Pick<LayerV3, 'id' | 'depth'>,
  bones: readonly Bone[],
  o: RigSettings,
  start = 0,
  sceneMs?: number,
): LayerV3[] {
  return bones.map((b) => {
    const at = start + (o.follow && b.parent ? FOLLOW_MS : 0);
    const room = sceneMs === undefined ? Infinity : sceneMs - at;
    return {
      id: boneLayerId(host.id, b.id),
      kind: 'path',
      depth: host.depth,
      start: at,
      tracks: { opacity: [key(0, 0)], ...fitTracks(moveTracks(o.moves[b.id], b, o.squash), room) },
    };
  });
}

/** Moves scaled in time so their last key lands inside `room` ms of scene. */
function fitTracks(tracks: BoneTracks, room: number): BoneTracks {
  const last = Math.max(0, ...Object.values(tracks).map((t) => t[t.length - 1]!.t));
  if (last <= room) return tracks;
  const f = Math.max(0, room) / last;
  const out: BoneTracks = {};
  for (const [prop, track] of Object.entries(tracks) as [keyof BoneTracks, Track<number>][]) {
    let prev = -1;
    out[prop] = track.map((k) => ({ ...k, t: (prev = Math.max(prev + 1, Math.round(k.t * f))) }));
  }
  return out;
}

/** The scene's layers with `hostId`'s bone layers redone, right after the host. */
export function withRig(
  layers: readonly LayerV3[],
  hostId: string,
  bones: readonly Bone[],
  o: RigSettings,
  start = 0,
  sceneMs?: number,
): LayerV3[] {
  const host = layers.find((l) => l.id === hostId);
  if (!host || !canRig(host)) return [...layers];
  const prefix = `${hostId}~bone~`;
  const kept = layers.filter((l) => !l.id.startsWith(prefix));
  const i = kept.indexOf(host);
  return [...kept.slice(0, i + 1), ...rigLayers(host, bones, o, start, sceneMs), ...kept.slice(i + 1)];
}

const sameTracks = (a: BoneTracks, b: LayerV3['tracks']) =>
  (['rotate', 'y', 'scale'] as const).every(
    (p) => JSON.stringify(a[p]?.map((k) => k.v) ?? null) === JSON.stringify(b[p]?.map((k) => k.v) ?? null),
  );

/** The rig on `hostId` as its layers hold it; undefined when the layer has no bones. */
export function rigOf(layers: readonly LayerV3[], hostId: string, bones: readonly Bone[]): RigSettings | undefined {
  const of = (b: Bone) => layers.find((l) => l.id === boneLayerId(hostId, b.id));
  const present = bones.filter(of);
  if (!present.length) return undefined;
  const hop = present.map((b) => of(b)!.tracks.scale).find((s) => s && s.length === 5);
  const squash = hop ? Math.round(((1 - Math.min(...hop.map((k) => k.v))) / 0.3) * 100) / 100 : RIG_DEFAULTS.squash;
  const moves: RigSettings['moves'] = {};
  for (const b of present) {
    const tracks = of(b)!.tracks;
    const m = RIG_MOVES.map(([id]) => id).find((id) => sameTracks(moveTracks(id, b, squash), tracks));
    if (m) moves[b.id] = m;
  }
  const root = present.find((b) => !b.parent);
  const child = present.find((b) => b.parent);
  const follow = root && child ? (of(child)!.start ?? 0) - (of(root)!.start ?? 0) === FOLLOW_MS : RIG_DEFAULTS.follow;
  return { moves, squash, follow };
}

export interface BonePose {
  rotate: number;
  y: number;
  scale: number;
}
const REST_POSE: BonePose = { rotate: 0, y: 0, scale: 1 };

const turn = ([x, y]: Point, deg: number): Point => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
};

/**
 * Forward kinematics: each bone's joints in the layer's px for the given poses. A bone's bend is shared along its
 * joints (the first takes the most); children turn with the joint they hang from.
 */
export function poseBones(bones: readonly Bone[], poses: Partial<Record<BoneId, BonePose>>): Record<BoneId, Point[]> {
  const out = {} as Record<BoneId, Point[]>;
  const turns = {} as Record<BoneId, number[]>;
  const done = new Set<BoneId>();
  const place = (b: Bone) => {
    if (done.has(b.id)) return;
    const parent = b.parent ? bones.find((p) => p.id === b.parent) : undefined;
    if (parent) place(parent);
    const p = { ...REST_POSE, ...poses[b.id] };
    const n = jointCount(b);
    // Share of the bend at each joint: 1, then halves, normalised so the tip turns by the whole bend.
    const weights = Array.from({ length: n }, (_, j) => 0.5 ** j);
    const total = weights.reduce((a, w) => a + w, 0);
    let base = 0;
    let origin: Point = [b.points[0]![0], b.points[0]![1] + p.y];
    if (parent) {
      const at = b.at ?? 0;
      base = turns[parent.id]![at]!;
      const anchor = out[parent.id]![at]!;
      const offset = turn([b.points[0]![0] - parent.points[at]![0], b.points[0]![1] - parent.points[at]![1]], base);
      origin = [anchor[0] + offset[0], anchor[1] + offset[1] + p.y];
    }
    const points: Point[] = [origin];
    const angles: number[] = [base];
    let angle = base;
    for (let j = 0; j < n; j++) {
      angle += (p.rotate * weights[j]!) / total;
      const a = b.points[j]!;
      const c = b.points[j + 1]!;
      // Squash stretches the segment along its own direction, then the bend turns it.
      const v = turn([(c[0] - a[0]) * p.scale, (c[1] - a[1]) * p.scale], angle);
      const last = points[j]!;
      points.push([last[0] + v[0], last[1] + v[1]]);
      angles.push(angle);
    }
    out[b.id] = points;
    turns[b.id] = angles;
    done.add(b.id);
  };
  for (const b of bones) place(b);
  return out;
}

const segmentDistance = (p: Point, a: Point, c: Point): number => {
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const k = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * k, p[1] - a[1] - dy * k);
};

/**
 * Skins an outline to its bones: each point follows every joint segment from `rest` to `posed` (both from
 * poseBones), weighted by nearness, keeping its offset along and across the segment (squash stretches along).
 * At rest every point stays where it is.
 */
export function deformPoints(
  points: readonly Point[],
  rest: Partial<Record<BoneId, Point[]>>,
  posed: Partial<Record<BoneId, Point[]>>,
): Point[] {
  const segs: [Point, Point, Point, Point][] = [];
  for (const id of Object.keys(rest) as BoneId[]) {
    const r = rest[id]!;
    const p = posed[id];
    if (!p) continue;
    for (let j = 0; j + 1 < r.length && j + 1 < p.length; j++) segs.push([r[j]!, r[j + 1]!, p[j]!, p[j + 1]!]);
  }
  if (!segs.length) return points.map((q) => [q[0], q[1]]);
  return points.map((q) => {
    let x = 0;
    let y = 0;
    let total = 0;
    for (const [a, c, a2, c2] of segs) {
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const len2 = Math.hypot(c2[0] - a2[0], c2[1] - a2[1]);
      if (!(len > 0) || !(len2 > 0)) continue;
      const w = 1 / (1 + segmentDistance(q, a, c)) ** 4;
      const ux = (c[0] - a[0]) / len;
      const uy = (c[1] - a[1]) / len;
      const along = (q[0] - a[0]) * ux + (q[1] - a[1]) * uy;
      const across = -(q[0] - a[0]) * uy + (q[1] - a[1]) * ux;
      const vx = (c2[0] - a2[0]) / len2;
      const vy = (c2[1] - a2[1]) / len2;
      const s = along * (len2 / len);
      x += w * (a2[0] + vx * s - vy * across);
      y += w * (a2[1] + vy * s + vx * across);
      total += w;
    }
    return total > 0 ? [x / total, y / total] : [q[0], q[1]];
  });
}
