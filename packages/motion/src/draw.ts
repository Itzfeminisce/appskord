// What each v3 layer draws, as plain data: outlines, strokes, words and counts in recipe px (0,0 at the layer, y down).
// Pure: the renderer turns a DrawSpec into meshes; tests read it without WebGL.
import { PLOT } from './charts';
import { parsePath, type Point } from './paths';
import { autoRig, boneLayerId, canRig, type Bone, type BoneId, type BonePose } from './rigs';
import { arch, blob, bounds, circle, roundedRect } from './shapes';
import type { LayerV3, Unit } from './types';

/** What the app knows about a layer that the v3 recipe does not hold: its words, colour and geometry. */
export interface LayerContent {
  text?: string;
  color?: string;
  /** Recipe px. */
  fontSize?: number;
  /** Recipe px, for shapes, media and stickers. */
  size?: { w: number; h: number };
  shape?: 'rect' | 'circle' | 'line' | 'blob' | 'arch';
  /** Corner radius of a rect, recipe px. */
  radius?: number;
  /** SVG path data in the layer's px, 0,0 at its centre: a path layer's line, or an icon's outline. */
  path?: string;
  /** SVG path data the `morph` track flows the shape into; a circle when absent. */
  morphTo?: string;
  stroke?: string;
  strokeWidth?: number;
  /** The layer's layout box as fractions of the frame, x and y its top-left: the layer rests at its centre. */
  box?: { x: number; y: number; w: number; h: number };
  /** Text: lines start at the box's left or right edge instead of its middle. */
  align?: 'left' | 'right';
  /** Text: the block starts at the top of its box instead of its middle. */
  valign?: 'top';
  /** A backing panel: sits behind the text layers of these slots, sized to their block plus padding. */
  backs?: string[];
  /** Decor only: drawn at low contrast at its full size, and may sit behind text where it covers it least. */
  decor?: boolean;
  /** An accent bar: a line drawn on just under this slot's text, as wide as its block. */
  under?: string;
}

/** How strongly decor-only shapes and lines read against the background, so text over them stays readable. */
export const DECOR_ALPHA = 0.14;
/** DECOR_ALPHA as a blend in linear light, where the frame is composed: it reads as DECOR_ALPHA once gamma is applied. */
export const DECOR_OPACITY = DECOR_ALPHA ** 2.2;

export interface Inks {
  ink: string;
  panel: string;
  accent: string;
}

export type DrawSpec =
  | { kind: 'none' }
  | { kind: 'particles' }
  | { kind: 'text'; text: string; unit: Unit; fontSize: number; color: string; fill: boolean }
  | { kind: 'count'; count: Count; fontSize: number; color: string }
  | {
      kind: 'shape';
      outline: Point[];
      /** The `morph` track flows `outline` into this. */
      morphTo?: Point[];
      /** The `draw` track grows the shape up from its bottom edge. */
      grow: boolean;
      color: string;
      stroke?: { color: string; width: number };
      bones?: Bone[];
      /** Opacity on top of the layer's own: decor draws at DECOR_OPACITY. */
      alpha?: number;
    }
  | { kind: 'path'; lines: Point[][]; color: string; width: number; bones?: Bone[]; alpha?: number };

export const SHAPE_SIZE = { w: 320, h: 200 } as const;
export const ICON_SIZE = { w: 120, h: 120 } as const;
const CHART_PART = /^(.*)~(bar|count|dot|cell|card|line)(?:~(\d+))?$/;
const DOT_R = 14;
const CARD = { w: 200, h: 120, r: 18 } as const;
const LINE_W = 6;
const DEFAULT_PATH = 'M -280 60 C -140 60 -140 -60 0 -60 S 140 60 280 -60';

/** A chart part's base layer, part and row, from its id `<chart>~<part>~<i>`. */
export function chartPart(id: string): { base: string; part: string; i?: number } | undefined {
  const m = CHART_PART.exec(id);
  if (!m) return undefined;
  return { base: m[1]!, part: m[2]!, i: m[3] === undefined ? undefined : Number(m[3]) };
}

const last = (track: { v: number }[] | undefined, rest: number) => (track?.length ? track[track.length - 1]!.v : rest);

/** A count that ends: its `to` is known. */
export type Count = { from: number; to: number; decimals?: number };

const group = (whole: string): string => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The shown value of a counting number at progress `draw`, grouped by thousands unless `grouped` is false. */
export function formatCount(count: Count, draw: number, grouped = true): string {
  const p = draw > 0 ? (draw >= 1 ? 1 : draw) : 0;
  const v = count.from + (count.to - count.from) * p;
  const [whole, frac] = Math.abs(v)
    .toFixed(count.decimals ?? 0)
    .split('.');
  const sign = v < 0 && Number(v.toFixed(count.decimals ?? 0)) !== 0 ? '-' : '';
  return `${sign}${grouped ? group(whole!) : whole}${frac ? `.${frac}` : ''}`;
}

/** The first number in a text, as it is written ("$4.5k" is 4.5 between "$" and "k"). */
export interface TextNumber {
  /** The number as written, which the count replaces. */
  raw: string;
  value: number;
  decimals: number;
  /** Written with thousands commas ("1,200"). */
  grouped: boolean;
  prefix: string;
  suffix: string;
}

// A minus counts only at the start of a word, so "Top-10" is 10.
const NUMBER = /(?:(?<![^\s(])-)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/;

/** The first number in `text`; undefined when it has none, so there is nothing to count. */
export function textNumber(text: string): TextNumber | undefined {
  const m = NUMBER.exec(text);
  if (!m) return undefined;
  const raw = m[0];
  const frac = raw.split('.')[1];
  return {
    raw,
    value: Number(raw.replace(/,/g, '')),
    decimals: frac?.length ?? 0,
    grouped: raw.includes(','),
    prefix: text.slice(0, m.index),
    suffix: text.slice(m.index + raw.length),
  };
}

/** The number a text layer's count shows at progress `draw`, written as its text writes it, without the prefix and suffix. */
export function countedNumber(n: TextNumber, from: number, draw: number): string {
  return formatCount({ from, to: n.value, decimals: n.decimals }, draw, n.grouped);
}

/** The bones on `host` when the scene holds its rig layers: auto bones for its size, centred on `centre`. */
export function rigBones(
  host: Pick<LayerV3, 'id' | 'kind'>,
  layers: readonly Pick<LayerV3, 'id'>[],
  size: { w: number; h: number },
  centre: Point = [0, 0],
): Bone[] | undefined {
  if (!canRig(host)) return undefined;
  const prefix = `${host.id}~bone~`;
  if (!layers.some((l) => l.id.startsWith(prefix))) return undefined;
  const [cx, cy] = centre;
  return autoRig(size).map((b) => ({ ...b, points: b.points.map(([x, y]): Point => [x + cx, y + cy]) }));
}

/** Rig bones fitted to what the layer draws, not its nominal size. */
function bonesFor(host: LayerV3, layers: readonly LayerV3[], drawn: readonly Point[]): Bone[] | undefined {
  const b = bounds(drawn);
  // A flat line still needs a body with length to bend.
  return rigBones(host, layers, { w: Math.max(1, b.width), h: Math.max(1, b.height) }, [
    b.x + b.width / 2,
    b.y + b.height / 2,
  ]);
}

/** A bone's pose from its hidden layer's props at this frame. */
export function bonePoses(
  host: string,
  bones: readonly Bone[],
  props: (id: string) => { rotate: number; y: number; scale: number } | undefined,
): Partial<Record<BoneId, BonePose>> {
  const out: Partial<Record<BoneId, BonePose>> = {};
  for (const b of bones) {
    const p = props(boneLayerId(host, b.id));
    if (p) out[b.id] = { rotate: p.rotate, y: p.y, scale: p.scale };
  }
  return out;
}

/** An outline at `draw`: squashed toward its bottom edge (a bar growing from its base). */
export function growOutline(points: readonly Point[], draw: number): Point[] {
  const d = draw > 0 ? (draw >= 1 ? 1 : draw) : 0;
  let bottom = -Infinity;
  for (const p of points) bottom = Math.max(bottom, p[1]);
  return points.map(([x, y]) => [x, bottom + (y - bottom) * d]);
}

const firstLine = (d: string): Point[] => parsePath(d)[0] ?? [];

function outlineOf(kind: LayerV3['kind'], c: LayerContent): Point[] {
  if (kind === 'icon' && c.path) return firstLine(c.path);
  const size = c.size ?? (kind === 'icon' ? ICON_SIZE : SHAPE_SIZE);
  if (c.shape === 'circle') return circle(Math.min(size.w, size.h) / 2);
  if (c.shape === 'blob') return blob(size.w, size.h);
  if (c.shape === 'arch') return arch(size.w, size.h);
  return roundedRect(size.w, size.h, c.radius ?? (kind === 'icon' ? 28 : 24));
}

/** What `layer` draws, from the scene's layers (chart parts and rigs read their siblings) and the app's content. */
export function drawSpec(
  layer: LayerV3,
  layers: readonly LayerV3[],
  content: LayerContent | undefined,
  inks: Inks,
): DrawSpec {
  const c = content ?? {};
  if (layer.id.includes('~bone~')) return { kind: 'none' };
  if (layer.kind === 'particles') return layer.particles?.bake ? { kind: 'particles' } : { kind: 'none' };
  const part = chartPart(layer.id);
  // A count with no end is a text layer's own number counting up in place: it draws as text.
  if (layer.count?.to !== undefined)
    return {
      kind: 'count',
      count: { ...layer.count, to: layer.count.to },
      fontSize: c.fontSize ?? (part ? (part.part === 'cell' ? 56 : 40) : 120),
      color: c.color ?? inks.ink,
    };
  if (part) {
    const parts = layers.filter((l) => chartPart(l.id)?.base === part.base);
    if (part.part === 'bar') {
      const n = parts.filter((l) => chartPart(l.id)?.part === 'bar').length;
      const w = (PLOT.width / Math.max(1, n)) * 0.62;
      const bar = roundedRect(w, PLOT.height, Math.min(12, w / 4)).map(([x, y]): Point => [x, y - PLOT.height / 2]);
      return { kind: 'shape', outline: bar, grow: true, color: c.color ?? inks.accent };
    }
    if (part.part === 'dot')
      return { kind: 'shape', outline: circle(DOT_R), grow: false, color: c.color ?? inks.accent };
    if (part.part === 'card')
      return { kind: 'shape', outline: roundedRect(CARD.w, CARD.h, CARD.r), grow: false, color: c.color ?? inks.panel };
    if (part.part === 'line') {
      const dots = parts
        .map((l) => ({ l, p: chartPart(l.id)! }))
        .filter(({ p }) => p.part === 'dot')
        .sort((a, b) => (a.p.i ?? 0) - (b.p.i ?? 0))
        .map(({ l }): Point => [last(l.tracks.x, 0), last(l.tracks.y, 0)]);
      return { kind: 'path', lines: [dots], color: c.color ?? inks.accent, width: c.strokeWidth ?? LINE_W };
    }
  }
  if (layer.kind === 'text')
    return {
      kind: 'text',
      text: c.text ?? '',
      unit: layer.type?.unit ?? 'line',
      fontSize: c.fontSize ?? 72,
      color: c.color ?? inks.ink,
      fill: !!layer.type?.fill,
    };
  // No asset is drawn for these yet: nothing, never a stand-in box in the picture.
  if (layer.kind === 'media' || layer.kind === 'lottie' || layer.kind === 'model') return { kind: 'none' };
  if (layer.kind === 'chart' && layers.some((l) => chartPart(l.id)?.base === layer.id)) return { kind: 'none' };
  const size = c.size ?? (layer.kind === 'icon' ? ICON_SIZE : SHAPE_SIZE);
  if (layer.kind === 'path' || c.shape === 'line') {
    const lines = c.path
      ? parsePath(c.path)
      : layer.kind === 'path'
        ? parsePath(DEFAULT_PATH)
        : [
            [
              [-size.w / 2, 0],
              [size.w / 2, 0],
            ] as Point[],
          ];
    const width = c.strokeWidth ?? (layer.kind === 'path' ? 8 : Math.max(2, Math.min(size.h, 12)));
    const bones = bonesFor(layer, layers, lines.flat());
    const alpha = c.decor ? { alpha: DECOR_OPACITY } : {};
    return { kind: 'path', lines, color: c.stroke ?? c.color ?? inks.accent, width, bones, ...alpha };
  }
  const outline = outlineOf(layer.kind, c);
  return {
    kind: 'shape',
    outline,
    morphTo: layer.tracks.morph?.length
      ? c.morphTo
        ? firstLine(c.morphTo)
        : circle(Math.min(size.w, size.h) / 2)
      : undefined,
    grow: !!layer.tracks.draw?.length,
    color: c.color ?? (c.decor ? inks.accent : inks.panel),
    stroke: c.stroke ? { color: c.stroke, width: c.strokeWidth ?? 4 } : undefined,
    bones: bonesFor(layer, layers, outline),
    ...(c.decor ? { alpha: DECOR_OPACITY } : {}),
  };
}
