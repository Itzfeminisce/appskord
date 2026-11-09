import * as THREE from 'three';
import { stagger, STAGGER_MS } from './choreo';
import { ease, FEEL } from './curves';
import { lineRise } from './masks';
import { UNIT } from './scene';
import { Text } from './text';
import type { Curve, Unit } from './types';

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** One unit of kinetic type laid out in recipe units: x from the line's left, y down from the first line's top. */
export interface UnitBox {
  text: string;
  line: number;
  x: number;
  y: number;
  width: number;
}

/** Width of a string at the type's size, in recipe units. */
export type Measure = (text: string) => number;

/** Lays out text by letter, word or line, each line centred on x = 0. Units match choreo's splitUnits. */
export function layoutUnits(text: string, unit: Unit, measure: Measure, lineHeight: number): UnitBox[] {
  const boxes: UnitBox[] = [];
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  lines.forEach((line, n) => {
    const left = -measure(line) / 2;
    const y = n * lineHeight;
    if (unit === 'line') {
      boxes.push({ text: line, line: n, x: left, y, width: measure(line) });
      return;
    }
    const parts = unit === 'letter' ? [...line] : line.split(/(\s+)/);
    let x = left;
    for (const part of parts) {
      const width = measure(part);
      if (part && !/^\s+$/.test(part)) boxes.push({ text: part, line: n, x, y, width });
      x += width;
    }
  });
  return boxes;
}

/** Eased entrance progress of each of `count` units at `local` ms, staggered as in MotionV3. Springs may pass 1. */
export function unitProgress(
  count: number,
  unit: Unit,
  local: number,
  unitMs: number = FEEL.smooth.ms,
  curve: Curve = FEEL.smooth.curve,
  stepMs: number = STAGGER_MS[unit],
): number[] {
  const fn = ease(curve);
  return stagger(count, unit, stepMs).map((start) => fn(clamp01((local - start) / unitMs)));
}

/** Pose of a unit at entrance progress p: letters and words fade up a third of a line; lines rise out of a mask. */
export function unitPose(unit: Unit, p: number, lineHeight: number): { opacity: number; dy: number; clip: boolean } {
  if (unit === 'line') return { opacity: 1, dy: lineRise(p, lineHeight), clip: true };
  return { opacity: clamp01(p), dy: (1 - p) * (lineHeight / 3), clip: false };
}

/** Scale to fill: the factor that makes a line `textWidth` wide span the frame between insets. */
export function fillScale(textWidth: number, frameWidth = 1080, inset = 0): number {
  return textWidth > 0 ? Math.max(0, frameWidth - 2 * inset) / textWidth : 1;
}

/** The axis ranges MotionV3 draws: weight 300 → 800, width 62 → 125. Fonts with narrower axes clamp further. */
export const AXIS_RANGE = {
  weight: { tag: 'wght', min: 300, max: 800 },
  width: { tag: 'wdth', min: 62, max: 125 },
} as const;

export interface FontAxis {
  tag: string;
  min: number;
  default: number;
  max: number;
}
export interface PathCommand {
  type: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}
/** The parts of an opentype.js 2 Font that variable type uses. */
export interface AxisFont {
  tables: { fvar?: { axes: { tag: string; minValue: number; defaultValue: number; maxValue: number }[] } };
  getPath(
    text: string,
    x: number,
    y: number,
    size: number,
    options?: { variation?: Record<string, number> },
  ): { commands: PathCommand[] };
  getAdvanceWidth(text: string, size: number, options?: { variation?: Record<string, number> }): number;
}

/** A font's variable axes from its fvar table; none for a static font. */
export function fontAxes(font: AxisFont): FontAxis[] {
  return (font.tables.fvar?.axes ?? []).map((a) => ({
    tag: a.tag,
    min: a.minValue,
    default: a.defaultValue,
    max: a.maxValue,
  }));
}

/** opentype.js variation coords for the layer's weight and width tracks, clamped to MotionV3's range and the font's axes. */
export function axisCoords(weight: number, width: number, axes: readonly FontAxis[]): Record<string, number> {
  const coords: Record<string, number> = {};
  for (const [name, value] of [
    ['weight', weight],
    ['width', width],
  ] as const) {
    const range = AXIS_RANGE[name];
    const axis = axes.find((a) => a.tag === range.tag);
    if (!axis) continue;
    const lo = Math.max(range.min, axis.min);
    const hi = Math.min(range.max, axis.max);
    coords[range.tag] = Math.round(Math.min(hi, Math.max(lo, value)));
  }
  return coords;
}

/** Evenly spaced axis values from min to max, as MotionV3's axis strips show (300, 425, 550, 675, 800). */
export function axisSteps(min: number, max: number, count: number): number[] {
  if (count < 2) return [min];
  return Array.from({ length: count }, (_, i) => Math.round(min + ((max - min) * i) / (count - 1)));
}

/** Text width in recipe units with opentype.js, at the given axes. */
export function measureWith(font: AxisFont, size: number, coords: Record<string, number> = {}): Measure {
  return (text) => font.getAdvanceWidth(text, size, { variation: coords });
}

/** Glyph outlines at the given axes as three.js shapes (holes resolved), in world units, y up. */
export function axisShapes(font: AxisFont, text: string, size: number, coords: Record<string, number>): THREE.Shape[] {
  const path = new THREE.ShapePath();
  const s = (v: number | undefined): number => (v ?? 0) * UNIT;
  for (const c of font.getPath(text, 0, 0, size, { variation: coords }).commands) {
    if (c.type === 'M') path.moveTo(s(c.x), -s(c.y));
    else if (c.type === 'L') path.lineTo(s(c.x), -s(c.y));
    else if (c.type === 'Q') path.quadraticCurveTo(s(c.x1), -s(c.y1), s(c.x), -s(c.y));
    else if (c.type === 'C') path.bezierCurveTo(s(c.x1), -s(c.y1), s(c.x2), -s(c.y2), s(c.x), -s(c.y));
  }
  return path.toShapes();
}

/** Variable-axis text: re-cuts its glyphs from opentype.js when the weight or width track moves. */
export class AxisText extends THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
  private readonly axes: FontAxis[];
  private key = '';

  constructor(
    private readonly font: AxisFont,
    readonly text: string,
    readonly size: number,
    color: THREE.ColorRepresentation = '#111114',
  ) {
    super(new THREE.ShapeGeometry([]), new THREE.MeshBasicMaterial({ color, transparent: true }));
    this.axes = fontAxes(font);
    this.update({});
  }

  update(userData: { weight?: number; width?: number; opacity?: number }): void {
    const coords = axisCoords(userData.weight ?? 400, userData.width ?? 100, this.axes);
    const key = JSON.stringify(coords);
    if (key !== this.key) {
      this.geometry.dispose();
      this.geometry = new THREE.ShapeGeometry(axisShapes(this.font, this.text, this.size, coords));
      this.geometry.computeBoundingBox();
      const box = this.geometry.boundingBox as THREE.Box3;
      this.geometry.translate(-(box.min.x + box.max.x) / 2, 0, 0);
      this.key = key;
    }
    this.material.opacity = userData.opacity ?? 1;
  }
}

/** Kinetic type: one troika text per letter, word or line, staggered from the layer's local time. */
export class KineticType extends THREE.Group {
  readonly boxes: UnitBox[];
  private readonly texts: Text[];

  constructor(
    text: string,
    readonly unit: Unit,
    readonly options: {
      measure: Measure;
      fontSize: number;
      fontUrl: string;
      lineHeight?: number;
      color?: THREE.ColorRepresentation;
      unitMs?: number;
      curve?: Curve;
      fill?: { frameWidth: number; inset: number };
    },
  ) {
    super();
    const lineHeight = options.lineHeight ?? options.fontSize * 1.1;
    this.boxes = layoutUnits(text, unit, options.measure, lineHeight);
    this.texts = this.boxes.map((box) => {
      const t = new Text();
      Object.assign(t, {
        text: box.text,
        font: options.fontUrl,
        fontSize: options.fontSize * UNIT,
        anchorX: 'left',
        anchorY: 'top',
      });
      t.color = (options.color ?? '#111114') as string;
      t.position.set(box.x * UNIT, -box.y * UNIT, 0);
      t.sync();
      this.add(t);
      return t;
    });
    if (options.fill) {
      const widest = Math.max(0, ...text.split('\n').map((line) => options.measure(line)));
      this.scale.setScalar(fillScale(widest, options.fill.frameWidth, options.fill.inset));
    }
  }

  /** Poses every unit at `local` ms from the layer's start. */
  update(local: number): void {
    const { fontSize, unitMs, curve } = this.options;
    const lineHeight = this.options.lineHeight ?? fontSize * 1.1;
    const progress = unitProgress(this.texts.length, this.unit, local, unitMs, curve);
    this.texts.forEach((t, i) => {
      const box = this.boxes[i] as UnitBox;
      const pose = unitPose(this.unit, progress[i] as number, lineHeight);
      t.position.y = -(box.y + pose.dy) * UNIT;
      // clipRect is in the text's own space, so the line's box moves up by the rise.
      const clipRect = pose.clip ? [-1e4, (pose.dy - lineHeight) * UNIT, 1e4, pose.dy * UNIT] : null;
      Object.assign(t, { fillOpacity: pose.opacity, clipRect });
    });
  }
}
