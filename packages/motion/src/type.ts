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
  /** Which of choreo's splitUnits this box enters as; its stagger slot. */
  order: number;
}

/** Width of a string at the type's size, in recipe units. */
export type Measure = (text: string) => number;

/** A wrapped line: `hard` counts the text's non-blank lines, `word` is choreo's index of the line's first word. */
interface Wrapped {
  text: string;
  hard: number;
  word: number;
}

/** Grapheme clusters of `s`, so a broken word never splits an accent or an emoji. */
function graphemes(s: string): string[] {
  if (typeof Intl.Segmenter !== 'function') return [...s];
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (g) => g.segment);
}

function wrap(text: string, measure: Measure, maxWidth: number): Wrapped[] {
  const out: Wrapped[] = [];
  let hard = 0;
  let word = 0;
  for (const raw of text.split('\n')) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let line = '';
    let first = word;
    const push = (): void => {
      if (line) out.push({ text: line, hard, word: first });
      line = '';
    };
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (measure(next) <= maxWidth) {
        if (!line) first = word;
        line = next;
      } else {
        push();
        first = word;
        // A word wider than the line (long words, CJK without spaces) breaks between graphemes.
        for (const g of measure(w) <= maxWidth ? [w] : graphemes(w)) {
          if (line && measure(line + g) > maxWidth) push();
          line += g;
        }
      }
      word++;
    }
    push();
    hard++;
  }
  return out;
}

/**
 * Breaks text into lines no wider than `maxWidth`: each word goes after the one before it (and a space) until the
 * next would pass the edge. A word wider than the line breaks between graphemes.
 */
export function wrapLines(text: string, measure: Measure, maxWidth = Infinity): string[] {
  return wrap(text, measure, maxWidth).map((l) => l.text);
}

/**
 * Lays out text by letter, word or line, wrapped to `maxWidth`, each line centred on x = 0. Each box's `order` is
 * its unit in choreo's splitUnits: the wrapped lines of one hard line, and the pieces of a broken word, share one.
 */
export function layoutUnits(
  text: string,
  unit: Unit,
  measure: Measure,
  lineHeight: number,
  maxWidth = Infinity,
): UnitBox[] {
  const boxes: UnitBox[] = [];
  let letter = 0;
  wrap(text, measure, maxWidth).forEach((wrapped, n) => {
    const line = wrapped.text;
    const left = -measure(line) / 2;
    const y = n * lineHeight;
    if (unit === 'line') {
      boxes.push({ text: line, line: n, x: left, y, width: measure(line), at: 0, order: wrapped.hard });
      return;
    }
    const parts = unit === 'letter' ? [...line] : line.split(/(\s+)/);
    let x = left;
    let at = 0;
    let word = wrapped.word;
    for (const part of parts) {
      const width = measure(part);
      if (part && !/^\s+$/.test(part))
        boxes.push({ text: part, line: n, x, y, width, at, order: unit === 'letter' ? letter++ : word++ });
      x += width;
      at += part.length;
    }
  });
  return boxes;
}

/** How many units the boxes animate as: choreo's splitUnits count. */
export const unitCount = (boxes: readonly UnitBox[]): number => 1 + Math.max(-1, ...boxes.map((b) => b.order));

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

const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

/** The largest scale at which a block `width` × `height` still fits inside `area`. An empty or unknown side never limits it. */
export function fitScale(width: number, height: number, area: { width: number; height: number }): number {
  return Math.min(
    width > 0 && positive(area.width) ? area.width / width : Infinity,
    height > 0 && positive(area.height) ? area.height / height : Infinity,
  );
}

/** A rectangle in recipe px around the frame's centre, y down: `x`, `y` its top-left. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The safe area of a frame `width` × `height` (recipe px) around its centre: 9:16 7% sides, 10% top, 16% bottom;
 * 1:1 6%; 16:9 5% sides, 6% top and bottom. A frame with no size has no limit.
 */
export function safeRect(width: number, height: number): Rect {
  if (!positive(width) || !positive(height)) return { x: -Infinity, y: -Infinity, width: Infinity, height: Infinity };
  const [side, top, bottom] =
    height > width ? [0.07, 0.1, 0.16] : height === width ? [0.06, 0.06, 0.06] : [0.05, 0.06, 0.06];
  return {
    x: -width / 2 + width * side,
    y: -height / 2 + height * top,
    width: width * (1 - 2 * side),
    height: height * (1 - top - bottom),
  };
}

/** A layout box given as fractions of the frame (x, y its top-left) as a Rect in recipe px around its centre. */
export function boxRect(
  box: { x: number; y: number; w: number; h: number },
  frame: { width: number; height: number },
): Rect {
  return {
    x: (box.x - 0.5) * frame.width,
    y: (box.y - 0.5) * frame.height,
    width: box.w * frame.width,
    height: box.h * frame.height,
  };
}

/**
 * The space a text gets in its layout box: the box's width (never wider than the safe area) to wrap to, and its
 * height, at least one line, to shrink into.
 */
export function slotArea(slot: Rect, safe: Rect, lineHeight: number): { width: number; height: number } {
  const width = slot.width > 0 ? Math.min(slot.width, safe.width) : safe.width;
  return { width, height: Math.min(Math.max(slot.height, lineHeight), safe.height) };
}

/** The size of the frame's safe area (see safeRect). */
export function safeArea(width: number, height: number): { width: number; height: number } {
  const { width: w, height: h } = safeRect(width, height);
  return { width: w, height: h };
}

/**
 * Where a block `size` centred at `at` rests so it stays inside `rect`: moved in just far enough, or centred
 * on the rect along a side it is too big for.
 */
export function placeInside(
  at: { x: number; y: number },
  size: { width: number; height: number },
  rect: Rect,
): { x: number; y: number } {
  const axis = (c: number, s: number, lo: number, span: number): number => {
    if (!Number.isFinite(c)) return 0;
    if (!Number.isFinite(span)) return c;
    if (s >= span) return lo + span / 2;
    return Math.min(Math.max(c, lo + s / 2), lo + span - s / 2);
  };
  return { x: axis(at.x, size.width, rect.x, rect.width), y: axis(at.y, size.height, rect.y, rect.height) };
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
      // A sync asked for while one ran (a count's next number) is queued behind it: wait for that one too.
      void synced(text).then(done);
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
  private readonly unitCount: number;
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
      /** The space the block has, recipe px: lines wrap to its width and the block shrinks to fit inside it. */
      area?: { width: number; height: number };
      /** Lines line up on the block's left or right edge; centred when absent. */
      align?: 'left' | 'right';
      /** A further uniform shrink after wrapping and fitting, so the block keeps its lines in a smaller area. */
      shrink?: number;
    },
  ) {
    super();
    if (!options.fontUrl.startsWith('/') && !options.fontUrl.startsWith('chrome-extension://'))
      throw new Error(
        `Motikord: fontUrl "${options.fontUrl}" is not extension-local; bundle the font and pass a path starting with "/" or "chrome-extension://".`,
      );
    const lineHeight = options.lineHeight ?? options.fontSize * 1.1;
    const width = options.area?.width;
    const wrap = width !== undefined && positive(width) ? width : Infinity;
    const lines = wrapLines(text, options.measure, wrap);
    this.lineCount = lines.length;
    this.boxes = layoutUnits(text, unit, options.measure, lineHeight, wrap);
    this.unitCount = unitCount(this.boxes);
    const widths = lines.map((line) => options.measure(line));
    const widest = Math.max(0, ...widths);
    for (const box of this.boxes) box.x += this.alignShift(widths[box.line] ?? 0, widest);
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
    this.fit(widest);
  }

  /** How far a centred line `lineWidth` wide moves to sit on the block's aligned edge. */
  private alignShift(lineWidth: number, widest: number): number {
    const { align } = this.options;
    return align === 'left' ? (lineWidth - widest) / 2 : align === 'right' ? (widest - lineWidth) / 2 : 0;
  }

  private get lineHeight(): number {
    return this.options.lineHeight ?? this.options.fontSize * 1.1;
  }

  /** y below the layer's origin, recipe px, of a point `y` below the first line's top: the block is centred. */
  private top(y: number): number {
    return y - (this.lineCount * this.lineHeight) / 2;
  }

  /** Scales to fill when asked, then down until the block fits its area. Without either the scale is left alone. */
  private fit(widest: number): void {
    const { fill, area } = this.options;
    const shrink = this.options.shrink ?? 1;
    this.widest = widest;
    if (!fill && !area) {
      if (shrink !== 1 && positive(shrink)) this.scale.setScalar(shrink);
      return;
    }
    const height = this.lineCount * this.lineHeight;
    const s = Math.min(
      fill ? fillScale(widest, fill.frameWidth, fill.inset) : 1,
      area ? fitScale(widest, height, area) : Infinity,
    );
    // A degenerate frame or fill never hides the words.
    if (positive(s * shrink)) this.scale.setScalar(s * shrink);
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
    const widthOf = (i: number): number => {
      const [x0 = 0, , x1 = 0] = infoOf(sources[i])!.blockBounds;
      return (x1 - x0) / UNIT;
    };
    const widest = Math.max(0, ...sources.map((_, i) => widthOf(i)));
    this.boxes.forEach((box, i) => {
      const info = infoOf(sources[this.unit === 'line' ? i : box.line])!;
      const [x0 = 0] = info.blockBounds;
      const lineWidth = widthOf(this.unit === 'line' ? i : box.line);
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
      box.x += this.alignShift(lineWidth, widest);
      this.texts[i]!.position.x = box.x * UNIT;
    });
    this.fit(widest);
    this.placed = true;
  }

  /**
   * Shows `shown` in place of `raw` in each unit that holds it (a counting number), keeping the block laid out for
   * the full text so nothing reflows while it counts.
   */
  retext(raw: string, shown: string): void {
    this.texts.forEach((t, i) => {
      const base = this.boxes[i]!.text;
      if (!base.includes(raw)) return;
      const next = base.replace(raw, shown);
      if ((t as TextProps).text !== next) {
        (t as TextProps).text = next;
        t.sync();
      }
    });
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
    // Staggered by choreo's units, so wrapping never makes the entrance longer.
    const progress = unitProgress(this.unitCount, this.unit, local, unitMs, curve);
    this.texts.forEach((text, i) => {
      const t = text as TextProps;
      const box = this.boxes[i] as UnitBox;
      const pose = unitPose(this.unit, progress[box.order] ?? 1, lineHeight);
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
