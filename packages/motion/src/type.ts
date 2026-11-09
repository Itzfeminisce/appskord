import * as THREE from 'three';
import { stagger, STAGGER_MS } from './choreo';
import { ease, FEEL } from './curves';
import { lineRise } from './masks';
import { UNIT } from './scene';
import { Text } from './text';
import type { Curve, Unit } from './types';

const clamp01 = (x: number): number => (x > 0 ? (x >= 1 ? 1 : x) : 0);

/** One unit of kinetic type laid out in recipe units: x from the line's left, y down from the first line's top. */
export interface UnitBox {
  text: string;
  line: number;
  x: number;
  y: number;
  width: number;
  /** The unit's first character in its line (UTF-16 index), where the line's typeset carets place it. */
  at?: number;
}

/** Width of a string at the type's size, in recipe units. */
export type Measure = (text: string) => number;

/**
 * Breaks text into lines no wider than `maxWidth`: each word goes after the one before it (and a space) until the
 * next would pass the edge. A word wider than the line keeps a line of its own; fitScale shrinks it into the frame.
 */
export function wrapLines(text: string, measure: Measure, maxWidth = Infinity): string[] {
  const out: string[] = [];
  for (const hard of text.split('\n')) {
    let line = '';
    for (const word of hard.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

/** Lays out text by letter, word or line, wrapped to `maxWidth`, each line centred on x = 0. Unwrapped units match choreo's splitUnits. */
export function layoutUnits(
  text: string,
  unit: Unit,
  measure: Measure,
  lineHeight: number,
  maxWidth = Infinity,
): UnitBox[] {
  const boxes: UnitBox[] = [];
  wrapLines(text, measure, maxWidth).forEach((line, n) => {
    const left = -measure(line) / 2;
    const y = n * lineHeight;
    if (unit === 'line') {
      boxes.push({ text: line, line: n, x: left, y, width: measure(line), at: 0 });
      return;
    }
    const parts = unit === 'letter' ? [...line] : line.split(/(\s+)/);
    let x = left;
    let at = 0;
    for (const part of parts) {
      const width = measure(part);
      if (part && !/^\s+$/.test(part)) boxes.push({ text: part, line: n, x, y, width, at });
      x += width;
      at += part.length;
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
  return stagger(count, unit, stepMs).map((start) =>
    fn(unitMs > 0 ? clamp01((local - start) / unitMs) : local >= start ? 1 : 0),
  );
}

/** Pose of a unit at entrance progress p: letters and words fade up a third of a line; lines rise out of a mask. */
export function unitPose(unit: Unit, p: number, lineHeight: number): { opacity: number; dy: number; clip: boolean } {
  if (unit === 'line') return { opacity: 1, dy: lineRise(p, lineHeight), clip: true };
  return { opacity: clamp01(p), dy: (1 - p) * (lineHeight / 3), clip: false };
}

/** The largest scale at which a block `width` × `height` still fits inside `area`. */
export function fitScale(width: number, height: number, area: { width: number; height: number }): number {
  return Math.min(width > 0 ? area.width / width : Infinity, height > 0 ? area.height / height : Infinity);
}

/** The safe area of a frame `width` × `height` (recipe px): 9:16 7% sides, 10% top, 16% bottom; 1:1 6%; 16:9 5% sides, 6% top and bottom. */
export function safeArea(width: number, height: number): { width: number; height: number } {
  if (height > width) return { width: width * 0.86, height: height * 0.74 };
  if (height === width) return { width: width * 0.88, height: height * 0.88 };
  return { width: width * 0.9, height: height * 0.88 };
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

const WEIGHT_STEP = 10;
const WIDTH_STEP = 2;
const CUT_CACHE = 8;

/** Variable-axis text: re-cuts its glyphs from opentype.js when the weight or width track crosses a step. */
/** The troika Text fields this file sets; the package's typings leave them out. */
type TextProps = Text & { fillOpacity: number; clipRect?: number[] | null };

export class AxisText extends THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
  private readonly axes: FontAxis[];
  private key = '';
  // Insertion order is recency order; the oldest entry is evicted first.
  private readonly cuts = new Map<string, THREE.ShapeGeometry>();

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
    const w = Math.round((userData.weight ?? 400) / WEIGHT_STEP) * WEIGHT_STEP;
    const wd = Math.round((userData.width ?? 100) / WIDTH_STEP) * WIDTH_STEP;
    const key = `${w}|${wd}`;
    if (key !== this.key) {
      let cut = this.cuts.get(key);
      if (cut) this.cuts.delete(key);
      else {
        cut = new THREE.ShapeGeometry(axisShapes(this.font, this.text, this.size, axisCoords(w, wd, this.axes)));
        cut.computeBoundingBox();
        const box = cut.boundingBox as THREE.Box3;
        cut.translate(-(box.min.x + box.max.x) / 2, 0, 0);
      }
      this.cuts.set(key, cut);
      while (this.cuts.size > CUT_CACHE) {
        const [oldKey, old] = this.cuts.entries().next().value as [string, THREE.ShapeGeometry];
        this.cuts.delete(oldKey);
        if (old !== cut) old.dispose();
      }
      this.geometry.dispose();
      this.geometry = cut;
      this.key = key;
    }
    this.material.opacity = userData.opacity ?? 1;
  }

  override dispose(): void {
    for (const g of this.cuts.values()) g.dispose();
    this.cuts.clear();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** What troika reports after a sync, in the text's own world units. */
type Typeset = { blockBounds: number[]; caretPositions?: Float32Array | null } | null;
type Syncing = Text & { _needsSync?: boolean; _isSyncing?: boolean; textRenderInfo?: Typeset };

/** Resolves once `text` has typeset its current props; troika's sync(cb) only calls back when a sync is pending. */
export function synced(text: Text): Promise<void> {
  const t = text as Syncing;
  if (t._needsSync) return new Promise((done) => t.sync(done));
  if (!t._isSyncing) return Promise.resolve();
  return new Promise((done) => {
    const target = t as unknown as THREE.EventDispatcher<{ synccomplete: object }>;
    const once = (): void => {
      target.removeEventListener('synccomplete', once);
      done();
    };
    target.addEventListener('synccomplete', once);
  });
}

/** Kinetic type: one troika text per letter, word or line, staggered from the layer's local time. */
export class KineticType extends THREE.Group {
  readonly boxes: UnitBox[];
  private readonly texts: Text[];
  /** One whole-line text per line, typeset only to read where its carets fall (letter and word units). */
  private readonly lines: Text[];
  private placed = false;
  private readonly lineCount: number;
  private widest = 0;

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
      /** The frame's safe area, recipe px: lines wrap to its width and the block shrinks to fit inside it. */
      area?: { width: number; height: number };
    },
  ) {
    super();
    if (!options.fontUrl.startsWith('/') && !options.fontUrl.startsWith('chrome-extension://'))
      throw new Error(
        `Motikord: fontUrl "${options.fontUrl}" is not extension-local; bundle the font and pass a path starting with "/" or "chrome-extension://".`,
      );
    const lineHeight = options.lineHeight ?? options.fontSize * 1.1;
    const wrap = options.area?.width ?? Infinity;
    const lines = wrapLines(text, options.measure, wrap);
    this.lineCount = lines.length;
    this.boxes = layoutUnits(text, unit, options.measure, lineHeight, wrap);
    const make = (s: string): Text => {
      const t = new Text();
      Object.assign(t, {
        text: s,
        font: options.fontUrl,
        fontSize: options.fontSize * UNIT,
        anchorX: 'left',
        anchorY: 'top',
      });
      return t;
    };
    this.texts = this.boxes.map((box) => {
      const t = make(box.text);
      t.color = (options.color ?? '#111114') as string;
      t.position.set(box.x * UNIT, -this.top(box.y) * UNIT, 0);
      t.sync(() => this.place());
      this.add(t);
      return t;
    });
    this.lines =
      unit === 'line'
        ? []
        : lines.map((line) => {
            const t = make(line);
            t.sync(() => this.place());
            return t;
          });
    this.fit(Math.max(0, ...lines.map((line) => options.measure(line))));
  }

  private get lineHeight(): number {
    return this.options.lineHeight ?? this.options.fontSize * 1.1;
  }

  /** y below the layer's origin, recipe px, of a point `y` below the first line's top: the block is centred. */
  private top(y: number): number {
    return y - (this.lineCount * this.lineHeight) / 2;
  }

  /** Scales to fill when asked, then down until the block fits the safe area. */
  private fit(widest: number): void {
    const { fill, area } = this.options;
    const height = this.lineCount * this.lineHeight;
    this.scale.setScalar(
      Math.min(
        fill ? fillScale(widest, fill.frameWidth, fill.inset) : 1,
        area ? fitScale(widest, height, area) : Infinity,
      ),
    );
    this.widest = widest;
  }

  /** The block's box in recipe px around the layer's origin, scaled as drawn. */
  bounds(): { x: number; y: number; width: number; height: number } {
    const s = this.scale.x;
    const height = this.lineCount * this.lineHeight;
    return { x: (-this.widest / 2) * s, y: (-height / 2) * s, width: this.widest * s, height: height * s };
  }

  /**
   * Re-places every unit from the typeset glyphs once all lines have synced: the estimate from `measure`
   * only holds until then. Widths and the fill scale follow.
   */
  private place(): void {
    const infoOf = (t: Text | undefined): Typeset => (t as Syncing | undefined)?.textRenderInfo ?? null;
    const sources = this.unit === 'line' ? this.texts : this.lines;
    if (!sources.length || sources.some((t) => !infoOf(t))) return;
    let widest = 0;
    this.boxes.forEach((box, i) => {
      const info = infoOf(sources[this.unit === 'line' ? i : box.line])!;
      const [x0 = 0, , x1 = 0] = info.blockBounds;
      const lineWidth = (x1 - x0) / UNIT;
      widest = Math.max(widest, lineWidth);
      const carets = info.caretPositions;
      const at = box.at ?? 0;
      const end = at + box.text.length - 1;
      if (this.unit === 'line' || !carets || carets.length < (end + 1) * 4) {
        box.x = -lineWidth / 2;
        box.width = lineWidth;
      } else {
        box.x = -lineWidth / 2 + (carets[at * 4]! - x0) / UNIT;
        box.width = (carets[end * 4 + 1]! - carets[at * 4]!) / UNIT;
      }
      this.texts[i]!.position.x = box.x * UNIT;
    });
    this.fit(widest);
    this.placed = true;
  }

  /** Resolves once every unit has typeset and been placed from its real glyph widths. */
  async ready(): Promise<void> {
    await Promise.all([...this.texts, ...this.lines].map(synced));
    if (!this.placed) this.place();
  }

  /** Poses every unit at `local` ms from the layer's start, faded by the layer's opacity. */
  update(local: number, opacity = 1): void {
    const { fontSize, unitMs, curve } = this.options;
    const lineHeight = this.options.lineHeight ?? fontSize * 1.1;
    const progress = unitProgress(this.texts.length, this.unit, local, unitMs, curve);
    this.texts.forEach((text, i) => {
      const t = text as TextProps;
      const box = this.boxes[i] as UnitBox;
      const pose = unitPose(this.unit, progress[i] as number, lineHeight);
      t.position.y = -this.top(box.y + pose.dy) * UNIT;
      // clipRect is in the text's own space, so the line's box moves up by the rise.
      const clipRect = pose.clip ? [-1e4, (pose.dy - lineHeight) * UNIT, 1e4, pose.dy * UNIT] : null;
      t.fillOpacity = pose.opacity * opacity;
      // Assigning clipRect re-typesets, so only touch it when its values change.
      const prev = t.clipRect;
      const same = clipRect === null ? !prev : !!prev && clipRect.every((v, k) => v === prev[k]);
      if (!same) t.clipRect = clipRect;
    });
  }

  override dispose(): void {
    for (const t of this.texts) {
      this.remove(t);
      t.dispose();
    }
    for (const t of this.lines) t.dispose();
    this.texts.length = 0;
    this.lines.length = 0;
  }
}

/** A counting number: one troika text centred on the layer, re-typeset only when the shown string changes. */
export class CountText extends THREE.Group {
  private readonly text = new Text() as TextProps;
  private shown = '';

  constructor(fontUrl: string, fontSize: number, color: THREE.ColorRepresentation = '#111114') {
    super();
    Object.assign(this.text, { font: fontUrl, fontSize: fontSize * UNIT, anchorX: 'center', anchorY: 'bottom' });
    this.text.color = color as string;
    this.add(this.text);
  }

  update(value: string, opacity = 1): void {
    if (value !== this.shown) {
      this.text.text = value;
      this.text.sync();
      this.shown = value;
    }
    this.text.fillOpacity = opacity;
  }

  /** Resolves once the shown string has typeset. */
  ready(): Promise<void> {
    return synced(this.text);
  }

  override dispose(): void {
    this.remove(this.text);
    this.text.dispose();
  }
}
