/// <reference path="./modules.d.ts" />
import * as THREE from 'three';
import { EffectComposer, RenderPass } from 'postprocessing';
import { CAMERA_DISTANCE } from './camera';
import { applyCamera, scenePose } from './depth';
import type { EffectUse } from './effects';
import { bonePoses, drawSpec, formatCount, growOutline, type DrawSpec, type LayerContent } from './draw';
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
import { deformPoints, poseBones, type Bone, type BoneId, type BonePose } from './rigs';
import { bounds, ShapeMesh, triangulate } from './shapes';
import { CountText, KineticType, safeArea, type Measure } from './type';
import type { Finish, LayerV3, LookGuide, SceneV3 } from './types';

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
    this.mesh.material.opacity = props.opacity;
    if (this.edge) this.edge.material.opacity = props.opacity;
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
    for (const s of this.strokes) s.material.opacity = props.opacity;
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
export class V3Renderer {
  readonly graph: MotionGraph;
  readonly three = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly chain: FinishChain;
  private readonly previous: THREE.PerspectiveCamera;
  private readonly kinetic = new Map<string, KineticType>();
  private readonly counts = new Map<string, { view: CountText; count: NonNullable<LayerV3['count']> }>();
  private readonly particles = new Map<string, ParticlesView>();
  private readonly views = new Map<string, View>();
  /** Text boxes for masks, recipe px. */
  private readonly textBoxes = new Map<string, Box>();
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
    for (const layer of scene.layers) this.addContent(layer, inks);
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

  private addContent(layer: LayerV3, inks: { ink: string; panel: string; accent: string }): void {
    const group = this.graph.layers.get(layer.id);
    if (!group) return;
    const content: LayerContent | undefined = this.options.content?.(layer);
    const spec = drawSpec(layer, this.scene.layers, content, inks);
    switch (spec.kind) {
      case 'text': {
        const measure = (this.options.measure ?? roughMeasure)(spec.fontSize);
        const k = new KineticType(spec.text, spec.unit, {
          measure,
          fontSize: spec.fontSize,
          fontUrl: this.options.fontUrl,
          color: spec.color,
          fill: spec.fill ? { frameWidth: 1080, inset: 80 } : undefined,
          area: safeArea(1080, (1080 * this.options.height) / this.options.width),
        });
        group.add(k);
        this.kinetic.set(layer.id, k);
        return;
      }
      case 'count': {
        const view = new CountText(this.options.fontUrl, spec.fontSize, spec.color);
        group.add(view);
        this.counts.set(layer.id, { view, count: spec.count });
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
      case 'shape':
        this.views.set(layer.id, new ShapeView(layer.id, group, spec));
        return;
      case 'path':
        this.views.set(layer.id, new PathView(layer.id, group, spec));
        return;
      case 'none':
        return;
    }
  }

  private readonly propsOf: PropsOf = (id) => this.props.get(id);

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
    applyCamera(this.graph, scenePose(this.scene, frame, feel), 1, !!this.options.spread);
    this.props.clear();
    for (const l of frame.layers) this.props.set(l.id, l.props);
    for (const l of frame.layers) {
      this.kinetic.get(l.id)?.update(l.local, l.props.opacity);
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
