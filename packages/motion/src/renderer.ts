/// <reference path="./modules.d.ts" />
import * as THREE from 'three';
import { EffectComposer, RenderPass } from 'postprocessing';
import { CAMERA_DISTANCE } from './camera';
import { applyCamera, scenePose } from './depth';
import type { EffectUse } from './effects';
import { DEFAULT_FINISH, FinishChain } from './finish';
import { disposeLight, GUIDE_LIGHT, keyLight } from './light';
import { ParticlesView } from './particles';
import { applyFrame, buildGraph, frameAt, type FrameState, type MotionGraph, type Quality } from './scene';
import { roundedRect, ShapeMesh } from './shapes';
import { KineticType, type Measure } from './type';
import type { Finish, LayerV3, LookGuide, SceneV3 } from './types';

/** What the app knows about a layer that the v3 recipe does not hold: its words and colour. */
export interface LayerContent {
  text?: string;
  color?: string;
  /** Recipe px. */
  fontSize?: number;
  /** Recipe px, for shapes, media and stickers. */
  size?: { w: number; h: number };
}

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
  private readonly particles = new Map<string, ParticlesView>();
  private readonly shapes: ShapeMesh[] = [];
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
    const ink = look?.palette[1] ?? '#F5F5F7';
    const panel = look?.palette[3] ?? '#1A1B2E';
    for (const layer of scene.layers) this.addContent(layer, ink, panel);
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

  private addContent(layer: LayerV3, ink: string, panel: string): void {
    const group = this.graph.layers.get(layer.id);
    if (!group) return;
    const c = this.options.content?.(layer) ?? {};
    if (layer.kind === 'text') {
      const fontSize = c.fontSize ?? 72;
      const measure = (this.options.measure ?? roughMeasure)(fontSize);
      const k = new KineticType(c.text ?? '', layer.type?.unit ?? 'line', {
        measure,
        fontSize,
        fontUrl: this.options.fontUrl,
        color: c.color ?? ink,
        fill: layer.type?.fill ? { frameWidth: 1080, inset: 80 } : undefined,
      });
      group.add(k);
      this.kinetic.set(layer.id, k);
      return;
    }
    if (layer.kind === 'particles') {
      const bake = layer.particles?.bake;
      if (!bake || !layer.particles) return;
      const view = new ParticlesView(
        bake,
        layer.particles.preset,
        this.options.look?.palette ?? [ink],
        this.options.height,
      );
      group.add(view.points);
      this.particles.set(layer.id, view);
      return;
    }
    const size = c.size ?? { w: 320, h: 200 };
    const mesh = new ShapeMesh(roundedRect(size.w, size.h, 24), c.color ?? panel);
    group.add(mesh);
    this.shapes.push(mesh);
  }

  /** Poses the graph, content, camera and finish for `t` ms into the scene. Pure of GPU work. */
  pose(t: number): FrameState {
    const feel = this.options.look?.feel ?? 'smooth';
    const frame = frameAt(this.scene, t, feel);
    applyFrame(this.graph, frame);
    applyCamera(this.graph, scenePose(this.scene, frame, feel), 1, !!this.options.spread);
    for (const l of frame.layers) {
      this.kinetic.get(l.id)?.update(l.local);
      this.particles.get(l.id)?.update(Math.max(0, l.local));
    }
    this.chain.update({ sceneId: this.scene.id, t, frame, graph: this.graph });
    this.last = frame;
    return frame;
  }

  /** Builds the composer on a WebGL renderer the caller owns (one per canvas). */
  attach(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
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
    for (const s of this.shapes) {
      s.geometry.dispose();
      s.material.dispose();
    }
    if (this.light) disposeLight(this.light);
    this.chain.dispose();
    this.composer?.dispose();
  }
}
