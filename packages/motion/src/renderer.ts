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
} from './scene';
import { applyMask, type Box } from './masks';
import { morpher } from './morph';
import { StrokeMesh, type Point } from './paths';
import { deformPoints, poseBones, type Bone, type BoneId } from './rigs';
import { bounds, ShapeMesh } from './shapes';
import { CountText, KineticType, type Measure } from './type';
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

/** One layer's content under its group, posed from the layer's props each frame. */
interface View {
  readonly id: string;
  /** Local bounds for the mask, recipe px. */
  readonly box: Box;
  update(l: LayerFrame, joints: JointsOf): void;
  dispose(): void;
}
type JointsOf = (host: string, bones: readonly Bone[]) => Joints;

const restOf = (bones: readonly Bone[]): Joints => poseBones(bones, {});
const jointsKey = (j: Joints | undefined): string =>
  j
    ? Object.values(j)
        .map((ps) => ps!.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' '))
        .join('|')
    : '';

class ShapeView implements View {
  readonly box: Box;
  private readonly mesh: ShapeMesh;
  private readonly edge?: StrokeMesh;
  private readonly at?: (t: number) => Point[];
  private readonly rest?: Joints;
  private drawn: readonly Point[];
  private key = '';

  constructor(
    readonly id: string,
    group: THREE.Group,
    private readonly spec: Extract<DrawSpec, { kind: 'shape' }>,
  ) {
    this.mesh = new ShapeMesh(spec.outline, spec.color);
    this.drawn = spec.outline;
    group.add(this.mesh);
    if (spec.stroke) {
      this.edge = new StrokeMesh([...spec.outline, spec.outline[0]!], spec.stroke.width, spec.stroke.color);
      group.add(this.edge);
    }
    if (spec.morphTo) this.at = morpher(spec.outline, spec.morphTo);
    if (spec.bones) this.rest = restOf(spec.bones);
    this.box = bounds(spec.morphTo ? [...spec.outline, ...spec.morphTo] : spec.outline);
  }

  update({ props }: LayerFrame, joints: JointsOf): void {
    const { spec } = this;
    const morph = this.at ? Math.min(1, Math.max(0, props.morph)) : 0;
    const draw = spec.grow ? Math.min(1, Math.max(0, props.draw)) : 1;
    const posed = spec.bones ? joints(this.id, spec.bones) : undefined;
    const key = `${morph}|${draw}|${jointsKey(posed)}`;
    if (key !== this.key) {
      this.key = key;
      let points = this.at ? this.at(morph) : spec.outline;
      if (spec.grow) points = growOutline(points, draw);
      if (posed && this.rest) points = deformPoints(points, this.rest, posed);
      if (points !== this.drawn) {
        this.mesh.setPoints(points);
        this.edge?.setPoints([...points, points[0]!], 1);
        this.drawn = points;
      }
    }
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

class PathView implements View {
  readonly box: Box;
  private readonly strokes: StrokeMesh[];
  private readonly lines: Point[][];
  private readonly rest?: Joints;
  private key = '';

  constructor(
    readonly id: string,
    group: THREE.Group,
    private readonly spec: Extract<DrawSpec, { kind: 'path' }>,
  ) {
    this.lines = spec.lines.filter((l) => l.length > 1);
    this.strokes = this.lines.map((l) => new StrokeMesh(l, spec.width, spec.color));
    for (const s of this.strokes) group.add(s);
    if (spec.bones) this.rest = restOf(spec.bones);
    const b = bounds(spec.lines.flat());
    const pad = spec.width / 2;
    this.box = { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
  }

  update({ props }: LayerFrame, joints: JointsOf): void {
    const posed = this.spec.bones ? joints(this.id, this.spec.bones) : undefined;
    const key = `${props.draw}|${jointsKey(posed)}`;
    if (key !== this.key) {
      this.key = key;
      this.strokes.forEach((s, i) => {
        const line = this.lines[i]!;
        s.setPoints(posed && this.rest ? deformPoints(line, this.rest, posed) : line, props.draw);
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
        });
        group.add(k);
        this.kinetic.set(layer.id, k);
        const lineHeight = spec.fontSize * 1.1;
        const lines = 1 + Math.max(0, ...k.boxes.map((b) => b.line));
        const x0 = Math.min(0, ...k.boxes.map((b) => b.x));
        const x1 = Math.max(0, ...k.boxes.map((b) => b.x + b.width));
        this.textBoxes.set(layer.id, { x: x0, y: 0, width: x1 - x0, height: lines * lineHeight });
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

  /** A rigged host's joints this frame, posed from its hidden bone layers. */
  private readonly joints: JointsOf = (host, bones) =>
    poseBones(
      bones,
      bonePoses(host, bones, (id) => this.props.get(id)),
    );

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
      this.views.get(l.id)?.update(l, this.joints);
    }
    for (const layer of this.masked) {
      const group = this.graph.layers.get(layer.id);
      const box = this.views.get(layer.id)?.box ?? this.textBoxes.get(layer.id);
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
