/// <reference path="./modules.d.ts" />
import * as THREE from 'three';
import { EffectComposer, RenderPass } from 'postprocessing';
import { CAMERA_DISTANCE, type CameraPose } from './camera';
import { applyCamera, scenePose } from './depth';
import { bounds as outlineBounds } from './shapes';
import type { EffectUse } from './effects';
import {
  bonePoses,
  chartPart,
  countedNumber,
  drawSpec,
  formatCount,
  growOutline,
  SHAPE_SIZE,
  textNumber,
  type Count,
  type DrawSpec,
  type LayerContent,
  type TextNumber,
} from './draw';
import { DEFAULT_FINISH, FinishChain } from './finish';
import { disposeLight, GUIDE_LIGHT, keyLight } from './light';
import { ParticlesView } from './particles';
import {
  applyFrame,
  buildGraph,
  frameAt,
  type FrameState,
  type LayerFrame,
  type MotionGraph,
  type Quality,
  UNIT,
} from './scene';
import { applyMask, type Box } from './masks';
import { morphRing } from './morph';
import { StrokeMesh, type Point } from './paths';
import { freeSpot, mapSlot, travelSafe } from './placement';
import { deformPoints, poseBones, type Bone, type BoneId, type BonePose } from './rigs';
import { bounds, roundedRect, ShapeMesh, triangulate } from './shapes';
import { boxRect, CountText, KineticType, placeInside, safeRect, slotArea, type Measure, type Rect } from './type';
import type { Depth, Finish, LayerV3, LookGuide, SceneV3 } from './types';

export type { LayerContent } from './draw';

export interface RendererOptions {
  width: number;
  height: number;
  quality: Quality;
  fps: number;
  fontUrl: string;
  finish?: Finish;
  /** Clip and scene effect uses; the scene's own are added. */
  effects?: readonly EffectUse[];
  look?: LookGuide;
  content?: (layer: LayerV3) => LayerContent | undefined;
  measure?: (fontSize: number) => Measure;
  /** "Show depth": pulls the depth groups apart. */
  spread?: boolean;
  /** Editor only, never export or stills: a faint outline where a layer with no drawn asset (media, lottie, model) sits. */
  hints?: boolean;
}

/** A WebGL2 renderer for one preview or export canvas; throws where WebGL is missing. */
export function createCanvasRenderer(canvas: HTMLCanvasElement | OffscreenCanvas): THREE.WebGLRenderer {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  r.setPixelRatio(1);
  return r;
}

type Props = LayerFrame['props'];
type Joints = Partial<Record<BoneId, Point[]>>;
type Poses = Partial<Record<BoneId, BonePose>>;
type PropsOf = (id: string) => Props | undefined;

/** One layer's content under its group, posed from the layer's props each frame. */
interface View {
  readonly id: string;
  /** Local bounds for the mask, recipe px. */
  readonly box: Box;
  update(l: LayerFrame, props: PropsOf): void;
  dispose(): void;
}

const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

const samePoses = (bones: readonly Bone[], a: Poses | undefined, b: Poses): boolean =>
  !!a &&
  bones.every(({ id }) => {
    const p = a[id];
    const q = b[id];
    return p === q || (!!p && !!q && p.rotate === q.rotate && p.y === q.y && p.scale === q.scale);
  });

/** A host's bones: re-posed (forward kinematics) only on frames where a bone layer moved. */
class RigPose {
  private readonly rest: Joints;
  private joints: Joints;
  private last?: Poses;

  constructor(
    private readonly host: string,
    private readonly bones: readonly Bone[],
  ) {
    this.rest = poseBones(bones, {});
    this.joints = this.rest;
  }

  /** True when the bones moved since the last frame. */
  update(props: PropsOf): boolean {
    const poses = bonePoses(this.host, this.bones, props);
    if (samePoses(this.bones, this.last, poses)) return false;
    this.last = poses;
    this.joints = poseBones(this.bones, poses);
    return true;
  }

  deform(points: readonly Point[]): Point[] {
    return deformPoints(points, this.rest, this.joints);
  }
}

class ShapeView implements View {
  readonly box: Box;
  private readonly mesh: ShapeMesh;
  private readonly edge?: StrokeMesh;
  private readonly at?: (t: number) => Point[];
  /** Morph triangles cut at each end; the nearer end's are used (ring point counts match). */
  private readonly ends?: [THREE.BufferAttribute, THREE.BufferAttribute];
  private readonly rig?: RigPose;
  /** Recipe y of the outline's bottom edge, the pivot the draw track grows from. */
  private readonly bottom: number;
  private points: readonly Point[];
  private morph = Number.NaN;
  private draw = Number.NaN;

  constructor(
    readonly id: string,
    group: THREE.Group,
    private readonly spec: Extract<DrawSpec, { kind: 'shape' }>,
  ) {
    if (spec.morphTo) {
      this.at = morphRing(spec.outline, spec.morphTo);
      const [a, b] = [this.at(0), this.at(1)];
      if (a.length === b.length && a.length >= 3)
        this.ends = [
          new THREE.Uint32BufferAttribute(triangulate(a), 1),
          new THREE.Uint32BufferAttribute(triangulate(b), 1),
        ];
    }
    this.points = this.at ? this.at(0) : spec.outline;
    this.mesh = new ShapeMesh(this.points, spec.color);
    group.add(this.mesh);
    if (spec.stroke && spec.outline.length >= 2) {
      this.edge = new StrokeMesh(closed(this.points), spec.stroke.width, spec.stroke.color);
      group.add(this.edge);
    }
    if (spec.bones) this.rig = new RigPose(id, spec.bones);
    this.bottom = Math.max(...spec.outline.map((p) => p[1]));
    this.box = bounds(spec.morphTo ? [...spec.outline, ...spec.morphTo] : spec.outline);
  }

  update({ props }: LayerFrame, propsOf: PropsOf): void {
    const { spec } = this;
    const morph = this.at ? clamp01(props.morph) : 0;
    const draw = spec.grow ? clamp01(props.draw) : 1;
    const moved = this.rig?.update(propsOf) ?? false;
    const reshaped = moved || morph !== this.morph;
    if (reshaped) {
      let points = this.at ? this.at(morph) : spec.outline;
      if (this.rig) points = this.rig.deform(points);
      if (!this.mesh.movePoints(points)) this.mesh.setPoints(points);
      else if (this.ends) this.mesh.geometry.setIndex(this.ends[morph < 0.5 ? 0 : 1]);
      this.points = points;
      this.morph = morph;
    }
    if (draw !== this.draw) {
      // Grow from the bottom edge: scale about it rather than re-cutting the outline.
      this.mesh.scale.y = draw;
      this.mesh.position.y = -this.bottom * UNIT * (1 - draw);
    }
    if (this.edge && (reshaped || draw !== this.draw)) {
      const edge = spec.grow ? growOutline(this.points, draw) : this.points;
      this.edge.setPoints(closed(edge), 1);
    }
    this.draw = draw;
    const opacity = props.opacity * (spec.alpha ?? 1);
    this.mesh.material.opacity = opacity;
    if (this.edge) this.edge.material.opacity = opacity;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.edge?.geometry.dispose();
    this.edge?.material.dispose();
  }
}

const closed = (points: readonly Point[]): Point[] => (points.length ? [...points, points[0]!] : []);

class PathView implements View {
  readonly box: Box;
  private readonly strokes: StrokeMesh[];
  private readonly lines: Point[][];
  private readonly rig?: RigPose;
  private draw = Number.NaN;

  constructor(
    readonly id: string,
    group: THREE.Group,
    private readonly spec: Extract<DrawSpec, { kind: 'path' }>,
  ) {
    this.lines = spec.lines.filter((l) => l.length > 1);
    this.strokes = this.lines.map((l) => new StrokeMesh(l, spec.width, spec.color));
    for (const s of this.strokes) group.add(s);
    if (spec.bones) this.rig = new RigPose(id, spec.bones);
    const b = bounds(spec.lines.flat());
    const pad = spec.width / 2;
    this.box = { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
  }

  update({ props }: LayerFrame, propsOf: PropsOf): void {
    const moved = this.rig?.update(propsOf) ?? false;
    if (moved || props.draw !== this.draw) {
      this.draw = props.draw;
      this.strokes.forEach((s, i) => {
        const line = this.lines[i]!;
        s.setPoints(this.rig ? this.rig.deform(line) : line, props.draw);
      });
    }
    for (const s of this.strokes) s.material.opacity = props.opacity * (this.spec.alpha ?? 1);
  }

  dispose(): void {
    for (const s of this.strokes) {
      s.geometry.dispose();
      s.material.dispose();
    }
  }
}

/** Width before troika has typeset the line; KineticType re-places units from the real glyphs once it has. */
const roughMeasure =
  (fontSize: number): Measure =>
  (s) =>
    s.length * fontSize * 0.55;

/**
 * Draws one v3 scene: the motion graph (buildGraph/applyFrame), each layer's content (kinetic type, shapes,
 * saved particles), the camera and depth, the look's key light, and the finish chain with motion blur.
 * `pose` is pure and needs no GPU; `attach` and `render` draw. Preview passes quality 'reduced'.
 */
interface Rest {
  x: number;
  y: number;
  slot?: Rect;
  align?: 'left' | 'right';
  valign?: 'top';
}

/** The centre of a block `size` in its rest: on its slot's aligned edges, else the rest itself. */
function restAt(rest: Rest, size: { width: number; height: number }, out: { x: number; y: number }): typeof out {
  const { slot } = rest;
  out.x =
    slot && rest.align === 'left'
      ? slot.x + size.width / 2
      : slot && rest.align === 'right'
        ? slot.x + slot.width - size.width / 2
        : rest.x;
  out.y = slot && rest.valign === 'top' ? slot.y + size.height / 2 : rest.y;
  return out;
}

const rect0 = (): Rect => ({ x: 0, y: 0, width: 0, height: 0 });
const ORIGIN: Rest = { x: 0, y: 0 };
/** Layers whose asset is not drawn yet: the editor outlines them faintly. */
const UNDRAWN: ReadonlySet<LayerV3['kind']> = new Set(['media', 'lottie', 'model']);
const HINT_ALPHA = 0.25;

/** Padding round the text a backing panel sits behind, as a share of the frame's short side. */
const BACKING_PAD = 0.04;
/** An accent bar's thickness and its gap below the text it underlines, as shares of that text block's height. */
const UNDER = { width: 0.07, gap: 0.1 } as const;

export class V3Renderer {
  readonly graph: MotionGraph;
  readonly three = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly chain: FinishChain;
  private readonly previous: THREE.PerspectiveCamera;
  private readonly kinetic = new Map<string, KineticType>();
  private readonly counts = new Map<string, { view: CountText; count: Count }>();
  /** Text layers whose own number counts up in place, from `from`. */
  private readonly counted = new Map<string, { n: TextNumber; where: { unit: number; at: number }; from: number }>();
  private readonly particles = new Map<string, ParticlesView>();
  private readonly views = new Map<string, View>();
  /** Text boxes for masks, recipe px. */
  private readonly textBoxes = new Map<string, Box>();
  /**
   * Where layers rest, recipe px from the frame's centre; their x and y tracks move them from there. Text rests in its
   * layout box (`slot`), lined up by `align` and `valign` once its size is known.
   */
  private readonly rests = new Map<string, Rest>();
  /** Text where it rests, recipe px, as last placed: backing panels sit behind these. */
  private readonly blocks = new Map<string, Rect>();
  /** Backing panels, by layer id: the text layers each sits behind, and the size its outline was cut at. */
  private readonly backing = new Map<string, { ids: string[]; width: number; height: number }>();
  /** Accent bars, by layer id: the text layers each underlines, and the length its line was cut at. */
  private readonly under = new Map<string, { ids: string[]; width: number }>();
  /** The camera's pose at each end of the scene's move: text rests inside the safe area shrunk by it. */
  private readonly ends: CameraPose[];
  /** Where text at each depth rests: the safe area less the camera's travel, so the move never carries it out. */
  private readonly textSafe: Record<Depth, Rect>;
  private readonly depthOf: Map<string, Depth>;
  /** Scratch for placing rests each frame, so posing allocates nothing for them. */
  private readonly spot = { x: 0, y: 0 };
  private readonly size = { width: 0, height: 0 };
  private readonly joined = rect0();
  /** Recipe px the text layout boxes take, which the layers a template adds are placed around. */
  private readonly taken: Rect[] = [];
  private readonly masked: LayerV3[];
  private readonly props = new Map<string, Props>();
  private readonly light: THREE.DirectionalLight | null;
  private composer: EffectComposer | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private last: FrameState | null = null;

  constructor(
    readonly scene: SceneV3,
    readonly options: RendererOptions,
  ) {
    const { width, height, look } = options;
    this.graph = buildGraph(scene);
    this.three.add(this.graph.root);
    this.three.background = new THREE.Color(look?.palette[0] ?? '#0B0B10');
    this.camera = new THREE.PerspectiveCamera(
      2 * Math.atan(10 / (width / height) / 2 / CAMERA_DISTANCE) * (180 / Math.PI),
      width / height,
      0.1,
      60,
    );
    this.camera.position.set(0, 0, CAMERA_DISTANCE);
    this.previous = this.camera.clone();
    this.three.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dot = GUIDE_LIGHT[look?.light ?? 'none'];
    this.light = dot ? keyLight(dot, !!scene.depthShadows) : null;
    if (this.light) this.three.add(this.light);
    const inks = {
      ink: look?.palette[1] ?? '#F5F5F7',
      accent: look?.palette[2] ?? '#8B9CFF',
      panel: look?.palette[3] ?? '#1A1B2E',
    };
    const feel = look?.feel ?? 'smooth';
    const start = frameAt(scene, 0, feel);
    this.ends = [0, 1].map((progress) => scenePose(scene, { ...start, camera: { ...start.camera, progress } }, feel));
    const safe = this.safe;
    this.textSafe = {
      front: travelSafe(safe, this.ends, 'front'),
      middle: travelSafe(safe, this.ends, 'middle'),
      back: travelSafe(safe, this.ends, 'back'),
    };
    this.depthOf = new Map(scene.layers.map((l) => [l.id, l.depth]));
    const contents = new Map(scene.layers.map((l) => [l.id, options.content?.(l)]));
    for (const l of scene.layers) {
      const box = contents.get(l.id)?.box;
      if (l.kind === 'text' && box) this.taken.push(boxRect(box, this.page));
    }
    for (const layer of scene.layers) this.addContent(layer, inks, contents.get(layer.id));
    this.layerOrder();
    this.masked = scene.layers.filter((l) => l.tracks.mask?.length);
    const scale = options.quality === 'full' ? 1 : 0.5;
    const uses = [...(options.effects ?? []), ...(scene.effects ?? [])];
    this.chain = new FinishChain(this.camera, options.finish ?? DEFAULT_FINISH, uses, {
      mode: options.quality === 'full' ? 'export' : 'preview',
      lighter: options.quality === 'reduced',
      fps: options.fps,
      look,
      width: width * scale,
      height: height * scale,
    });
  }

  private addContent(
    layer: LayerV3,
    inks: { ink: string; panel: string; accent: string },
    content: LayerContent | undefined,
  ): void {
    const group = this.graph.layers.get(layer.id);
    if (!group) return;
    const spec = this.placeAdded(layer, drawSpec(layer, this.scene.layers, content, inks), content);
    switch (spec.kind) {
      case 'text': {
        const measure = (this.options.measure ?? roughMeasure)(spec.fontSize);
        const safe = this.safe;
        const inner = this.textSafe[layer.depth];
        const full = content?.box && boxRect(content.box, this.page);
        // The layout shrinks into the area the camera's travel leaves: boxes move in, and text keeps its lines but
        // draws smaller, so boxes keep clear of each other.
        const slot = full && mapSlot(full, safe, inner);
        const shrink = Number.isFinite(safe.width) ? Math.min(inner.width / safe.width, inner.height / safe.height) : 1;
        // Text in a layout box wraps and shrinks to it; without one, to the safe area at the frame's centre.
        const area = full ? slotArea(full, safe, spec.fontSize * 1.1) : { width: safe.width, height: safe.height };
        if (slot)
          this.rests.set(layer.id, {
            x: slot.x + slot.width / 2,
            y: slot.y + slot.height / 2,
            slot,
            align: content?.align,
            valign: content?.valign,
          });
        const k = new KineticType(spec.text, spec.unit, {
          measure,
          fontSize: spec.fontSize,
          fontUrl: this.options.fontUrl,
          color: spec.color,
          fill: spec.fill ? (slot ? { frameWidth: area.width, inset: 0 } : { frameWidth: 1080, inset: 80 }) : undefined,
          area,
          align: slot ? content?.align : undefined,
          shrink,
        });
        group.add(k);
        this.kinetic.set(layer.id, k);
        // Letter units animate one character each: a number spread over several has no one unit to count in.
        const n = layer.count && spec.unit !== 'letter' ? textNumber(spec.text) : undefined;
        const where = n && k.unitOf(n.index, n.raw.length);
        if (n && where) this.counted.set(layer.id, { n, where, from: layer.count!.from });
        return;
      }
      case 'count': {
        const view = new CountText(this.options.fontUrl, spec.fontSize, spec.color);
        group.add(view);
        this.counts.set(layer.id, { view, count: spec.count });
        // Kept inside its depth's text safe area like text, so the camera's move never carries it out.
        if (!this.rests.has(layer.id)) this.rests.set(layer.id, { x: 0, y: 0 });
        this.textBoxes.set(layer.id, {
          x: -spec.fontSize * 3,
          y: -spec.fontSize,
          width: spec.fontSize * 6,
          height: spec.fontSize,
        });
        return;
      }
      case 'particles': {
        const p = layer.particles!;
        const view = new ParticlesView(
          p.bake!,
          p.preset,
          this.options.look?.palette ?? [inks.ink],
          this.options.height,
        );
        group.add(view.points);
        this.particles.set(layer.id, view);
        return;
      }
      case 'shape': {
        this.views.set(layer.id, new ShapeView(layer.id, group, spec));
        const slot = content?.box && boxRect(content.box, this.page);
        if (slot) this.rests.set(layer.id, { x: slot.x + slot.width / 2, y: slot.y + slot.height / 2 });
        return;
      }
      case 'path':
        this.views.set(layer.id, new PathView(layer.id, group, spec));
        return;
      case 'none':
        if (this.options.hints && UNDRAWN.has(layer.kind)) this.addHint(layer, group, inks.ink, content);
        return;
    }
  }

  private readonly propsOf: PropsOf = (id) => this.props.get(id);

  /** An outline, no fill and no words, the size of the layer's box, so the user sees where its asset will go. */
  private addHint(layer: LayerV3, group: THREE.Group, ink: string, content: LayerContent | undefined): void {
    const box = content?.box && boxRect(content.box, this.page);
    const w = box?.width ?? content?.size?.w ?? SHAPE_SIZE.w;
    const h = box?.height ?? content?.size?.h ?? SHAPE_SIZE.h;
    const [x, y] = [w / 2, h / 2];
    const line: Point[] = [
      [-x, -y],
      [x, -y],
      [x, y],
      [-x, y],
      [-x, -y],
    ];
    this.views.set(
      layer.id,
      new PathView(layer.id, group, { kind: 'path', lines: [line], color: ink, width: 2, alpha: HINT_ALPHA }),
    );
    if (box) this.rests.set(layer.id, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }

  /**
   * A layer the template adds (no layout box, not a chart part): rests in the safe area where it covers the text
   * boxes least, shrunk to clear them when it can. Text, chart parts and boxed layers keep their spec.
   */
  private placeAdded(layer: LayerV3, spec: DrawSpec, content: LayerContent | undefined): DrawSpec {
    if (content?.backs && spec.kind === 'shape') return this.placeBacking(layer, spec, content.backs);
    if (content?.under && spec.kind === 'path') return this.placeUnder(layer, spec, content.under);
    if (content?.box || chartPart(layer.id) || !this.taken.length) return spec;
    const size =
      spec.kind === 'count'
        ? { width: spec.fontSize * 6, height: spec.fontSize }
        : spec.kind === 'shape'
          ? outlineBounds(spec.morphTo ? [...spec.outline, ...spec.morphTo] : spec.outline)
          : spec.kind === 'path'
            ? outlineBounds(spec.lines.flat())
            : undefined;
    if (!size) return spec;
    // A rigged outline keeps its size: its bones were cut for it.
    // A rigged outline keeps its size too: its bones were cut for it.
    const rigged = (spec.kind === 'shape' || spec.kind === 'path') && !!spec.bones?.length;
    const spot = freeSpot(size, this.taken, this.safe, rigged || content?.decor ? [1] : undefined);
    // A count draws above its origin (anchored at its baseline), so its origin sits half a line below the spot.
    const drop = spec.kind === 'count' ? (spec.fontSize * spot.scale) / 2 : 0;
    this.rests.set(layer.id, { x: spot.x, y: spot.y + drop });
    // The layer's own box stays clear for the next one placed.
    const w = size.width * spot.scale;
    const h = size.height * spot.scale;
    this.taken.push({ x: spot.x - w / 2, y: spot.y - h / 2, width: w, height: h });
    const k = spot.scale;
    if (k === 1) return spec;
    const at = (p: Point): Point => [p[0] * k, p[1] * k];
    if (spec.kind === 'count') return { ...spec, fontSize: spec.fontSize * k };
    if (spec.kind === 'shape') return { ...spec, outline: spec.outline.map(at), morphTo: spec.morphTo?.map(at) };
    if (spec.kind === 'path') return { ...spec, lines: spec.lines.map((l) => l.map(at)) };
    return spec;
  }

  /**
   * A backing panel: a rounded rect the size of the text block of the slots it backs plus BACKING_PAD, resting
   * behind it (re-centred on the block each frame). With none of those layers it is drawn as specified.
   */
  private placeBacking(layer: LayerV3, spec: Extract<DrawSpec, { kind: 'shape' }>, slots: readonly string[]): DrawSpec {
    const ids = this.slotText(slots);
    const rect = this.blockUnion(ids, rect0(), (id, out) => this.restBlock(id, 1, out));
    if (!rect) return spec;
    const pad = this.backingPad;
    const w = rect.width + 2 * pad;
    const h = rect.height + 2 * pad;
    this.backing.set(layer.id, { ids, width: w, height: h });
    this.followText(layer.id, ids[0]!);
    const outline = roundedRect(w, h, Math.min(w, h) * 0.12);
    return { ...spec, outline, morphTo: spec.morphTo && roundedRect(w, h, Math.min(w, h) / 2), bones: undefined };
  }

  /**
   * An accent bar: a line as wide as the slot's text block, resting just under it (re-placed on the block each frame,
   * so it follows a counting number). With no such layer it is drawn as specified.
   */
  private placeUnder(layer: LayerV3, spec: Extract<DrawSpec, { kind: 'path' }>, slot: string): DrawSpec {
    const ids = this.slotText([slot]);
    const rect = this.blockUnion(ids, rect0(), (id, out) => this.restBlock(id, 1, out));
    if (!rect || rect.width <= 0) return spec;
    this.under.set(layer.id, { ids, width: rect.width });
    this.followText(layer.id, ids[0]!);
    const half = rect.width / 2;
    return {
      ...spec,
      lines: [
        [
          [-half, 0],
          [half, 0],
        ],
      ],
      width: Math.max(4, rect.height * UNDER.width),
      bones: undefined,
    };
  }

  /** The text layers of these slots. */
  private slotText(slots: readonly string[]): string[] {
    return this.scene.layers
      .filter((l) => l.slotId && slots.includes(l.slotId) && this.kinetic.has(l.id))
      .map((l) => l.id);
  }

  /** Moves a layer to the depth of the text it sits with, so parallax never slides it off; it still draws behind. */
  private followText(id: string, text: string): void {
    const front = this.depthOf.get(text)!;
    const group = this.graph.layers.get(id);
    if (group) this.graph.depths[front].add(group);
  }

  /** Back to front: each depth after the one behind it, and within a depth the words over the shapes. */
  private layerOrder(): void {
    const rank = { back: 0, middle: 2, front: 4 } as const;
    for (const layer of this.scene.layers) {
      const group = this.graph.layers.get(layer.id);
      if (!group) continue;
      const words = this.kinetic.has(layer.id) || this.counts.has(layer.id) ? 1 : 0;
      group.traverse((o) => {
        o.renderOrder = rank[layer.depth] + words;
      });
    }
  }

  /** The frame's size in recipe px: 1080 wide; square when the size is unknown. */
  private get page(): { width: number; height: number } {
    const { width, height } = this.options;
    return { width: 1080, height: width > 0 && height > 0 ? (1080 * height) / width : 1080 };
  }

  private get backingPad(): number {
    return Math.min(this.page.width, this.page.height) * BACKING_PAD;
  }

  private get safe(): Rect {
    return safeRect(this.page.width, this.page.height);
  }

  /**
   * Moves each layer to where it rests; text lines up in its box by align and valign and is kept inside the safe
   * area at the size it is drawn.
   */
  private placeRests(): void {
    for (const [id, rest] of this.rests) {
      const group = this.graph.layers.get(id);
      if (!group) continue;
      let rect = this.blocks.get(id);
      if (!rect) this.blocks.set(id, (rect = rect0()));
      const block = this.restBlock(id, group.scale.x, rect);
      if (!block) this.blocks.delete(id);
      group.position.x += (block ? this.spot.x : rest.x) * UNIT;
      group.position.y -= (block ? this.spot.y : rest.y) * UNIT;
    }
    const pad = this.backingPad;
    for (const [id, backs] of this.backing) {
      const group = this.graph.layers.get(id);
      const rect = this.blockUnion(backs.ids, this.joined, this.placed);
      if (!group || !rect) continue;
      group.position.x += (rect.x + rect.width / 2) * UNIT;
      group.position.y -= (rect.y + rect.height / 2) * UNIT;
      // Typeset widths replace the measured ones once fonts load: the panel follows the block's real size.
      group.scale.x *= (rect.width + 2 * pad) / backs.width;
      group.scale.y *= (rect.height + 2 * pad) / backs.height;
    }
    for (const [id, under] of this.under) {
      const group = this.graph.layers.get(id);
      const rect = this.blockUnion(under.ids, this.joined, this.placed);
      if (!group || !rect) continue;
      group.position.x += (rect.x + rect.width / 2) * UNIT;
      group.position.y -= (rect.y + rect.height * (1 + UNDER.gap)) * UNIT;
      group.scale.x *= rect.width / under.width;
    }
  }

  /** A text layer's block as last placed, copied into `out`. */
  private readonly placed = (id: string, out: Rect): Rect | undefined => {
    const r = this.blocks.get(id);
    return r && Object.assign(out, r);
  };

  /** The box round the blocks of `ids`, written into `out`; undefined when none of them has one. */
  private blockUnion(
    ids: readonly string[],
    out: Rect,
    blockOf: (id: string, out: Rect) => Rect | undefined,
  ): Rect | undefined {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const id of ids) {
      const r = blockOf(id, out);
      if (!r) continue;
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.width);
      y1 = Math.max(y1, r.y + r.height);
    }
    if (x0 > x1) return undefined;
    out.x = x0;
    out.y = y0;
    out.width = x1 - x0;
    out.height = y1 - y0;
    return out;
  }

  /**
   * Where a text or count layer rests at scale `s`: lined up in its box and kept inside its depth's text safe area.
   * Writes its block into `out` and the point it rests at into `spot`; undefined when it has no block.
   */
  private restBlock(id: string, s: number, out: Rect): Rect | undefined {
    const rest = this.rests.get(id) ?? ORIGIN;
    const b = this.kinetic.get(id)?.bounds() ?? (this.counts.has(id) ? this.textBoxes.get(id) : undefined);
    if (!b) return undefined;
    const size = this.size;
    size.width = b.width * s;
    size.height = b.height * s;
    // The block's centre sits off the layer's origin (a count draws above its baseline).
    const cx = (b.x + b.width / 2) * s;
    const cy = (b.y + b.height / 2) * s;
    const at = restAt(rest, size, this.spot);
    at.x += cx;
    at.y += cy;
    placeInside(at, size, this.textSafe[this.depthOf.get(id) ?? 'front'], at);
    at.x -= cx;
    at.y -= cy;
    out.x = at.x + b.x * s;
    out.y = at.y + b.y * s;
    out.width = size.width;
    out.height = size.height;
    return out;
  }

  /** A text layer's box for its mask, from where its units now sit (typeset widths once synced). */
  private textBox(id: string): Box | undefined {
    const k = this.kinetic.get(id);
    return k ? k.bounds() : this.textBoxes.get(id);
  }

  /** Poses the graph, content, camera and finish for `t` ms into the scene. Pure of GPU work. */
  pose(t: number): FrameState {
    const feel = this.options.look?.feel ?? 'smooth';
    const frame = frameAt(this.scene, t, feel);
    applyFrame(this.graph, frame);
    this.placeRests();
    applyCamera(this.graph, scenePose(this.scene, frame, feel), 1, !!this.options.spread);
    this.props.clear();
    for (const l of frame.layers) this.props.set(l.id, l.props);
    for (const l of frame.layers) {
      const k = this.kinetic.get(l.id);
      const own = this.counted.get(l.id);
      if (k && own) k.retext(own.where, own.n.raw.length, countedNumber(own.n, own.from, l.props.draw));
      k?.update(l.local, l.props.opacity);
      const c = this.counts.get(l.id);
      c?.view.update(formatCount(c.count, l.props.draw), l.props.opacity);
      this.particles.get(l.id)?.update(Math.max(0, l.local));
      this.views.get(l.id)?.update(l, this.propsOf);
    }
    for (const layer of this.masked) {
      const group = this.graph.layers.get(layer.id);
      const box = this.views.get(layer.id)?.box ?? this.textBox(layer.id);
      if (group && box) applyMask(group, box);
    }
    this.chain.update({ sceneId: this.scene.id, t, frame, graph: this.graph });
    this.last = frame;
    return frame;
  }

  /** Builds the composer on a WebGL renderer the caller owns (one per canvas). */
  attach(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    // Masks clip with per-material planes.
    renderer.localClippingEnabled = true;
    const scale = this.options.quality === 'full' ? 1 : 0.5;
    renderer.setSize(this.options.width * scale, this.options.height * scale, false);
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.three, this.camera));
    for (const p of this.chain.passes) this.composer.addPass(p);
  }

  /** Draws `t`; the motion blur reads the layers' poses from the frame before. */
  render(t: number): void {
    if (!this.renderer || !this.composer) throw new Error('Motikord: attach a renderer before render');
    this.pose(t);
    this.chain.blur?.render(this.renderer, this.graph, this.camera, this.previous);
    this.composer.render();
    this.previous.copy(this.camera);
  }

  /**
   * Resolves once every text has typeset what the last pose asked for (troika typesets asynchronously, so a
   * plain render can show the previous string) and kinetic type sits on its real glyph widths.
   */
  async ready(): Promise<void> {
    await Promise.all([
      ...[...this.kinetic.values()].map((k) => k.ready()),
      ...[...this.counts.values()].map((c) => c.view.ready()),
    ]);
  }

  /** The export path: poses `t`, waits for its text to typeset, then draws it. Preview keeps the sync render. */
  async renderReady(t: number): Promise<void> {
    this.pose(t);
    await this.ready();
    this.render(t);
  }

  get frame(): FrameState | null {
    return this.last;
  }

  dispose(): void {
    for (const k of this.kinetic.values()) k.dispose();
    for (const p of this.particles.values()) p.dispose();
    for (const c of this.counts.values()) c.view.dispose();
    for (const v of this.views.values()) v.dispose();
    if (this.light) disposeLight(this.light);
    this.chain.dispose();
    this.composer?.dispose();
  }
}
