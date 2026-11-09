/// <reference path="./modules.d.ts" />
import * as THREE from 'three';
import {
  BloomEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { Text } from './text';
import BezierEasing from 'bezier-easing';
import {
  BatchedRenderer,
  ColorOverLife,
  ColorRange,
  ConstantValue,
  Gradient,
  IntervalValue,
  ParticleSystem,
  RenderMode,
  SizeOverLife,
  PiecewiseBezier,
  Bezier,
  SphereEmitter,
  ApplyForce,
  Vector3 as QVector3,
  Vector4,
} from 'three.quarks';
import { FinishEffect, VelocityBlurEffect } from './effects';
import { seeded, withRandom } from './seed';
import { layerStarts } from './choreo';
import { FEEL, valueAt } from './curves';
import { progress } from './time';
import { DEPTHS, PARALLAX, PROPS } from './types';
import type { CameraMove, Depth, Feel, Prop, SceneV3 } from './types';

export type Quality = 'full' | 'reduced';
export interface SceneOptions {
  width: number;
  height: number;
  seconds: number;
  seed: number;
  quality: Quality;
  fontUrl: string;
}

const STEP = 1 / 120;
const enter = BezierEasing(0.16, 1, 0.3, 1);

function dotTexture(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const a = Math.max(0, 1 - d) ** 2;
      data.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4);
    }
  const t = new THREE.DataTexture(data, n, n);
  t.needsUpdate = true;
  return t;
}

/** The seeded v3 test scene: 3D text, particles, DOF, bloom, velocity motion blur and the finish. Frame t depends only on t. */
export class TestScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly previousCamera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly blur: VelocityBlurEffect;
  private readonly finish = new FinishEffect();
  private readonly batch = new BatchedRenderer();
  private readonly particles: ParticleSystem;
  private readonly title = new Text();
  private readonly subtitle = new Text();
  private readonly cubes: THREE.InstancedMesh;
  private readonly cubeSpin: { axis: THREE.Vector3; speed: number; pos: THREE.Vector3 }[] = [];
  private random: () => number;
  private simTime = 0;

  constructor(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    private readonly options: SceneOptions,
  ) {
    const { width, height, quality, seed } = options;
    const scale = quality === 'full' ? 1 : 0.5;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width * scale, height * scale, false);
    this.scene.background = new THREE.Color(0x07060f);
    this.scene.fog = new THREE.Fog(0x07060f, 8, 26);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 60);
    this.previousCamera = this.camera.clone();

    const rand = seeded(seed);
    this.scene.add(new THREE.AmbientLight(0x6670ff, 0.35));
    const key = new THREE.DirectionalLight(0xffe2c8, 2.2);
    key.position.set(3, 6, 5);
    this.scene.add(key);
    const rim = new THREE.PointLight(0xff3d7f, 30, 20);
    rim.position.set(-3, 1, -2);
    this.scene.add(rim);

    const count = quality === 'full' ? 90 : 50;
    this.cubes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.4, 0.4, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x8a7dff, roughness: 0.35, metalness: 0.4, emissive: 0x1a0f40 }),
      count,
    );
    for (let i = 0; i < count; i++) {
      this.cubeSpin.push({
        axis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
        speed: 0.3 + rand() * 1.2,
        pos: new THREE.Vector3((rand() - 0.5) * 9, (rand() - 0.5) * 16, -2 - rand() * 18),
      });
    }
    this.scene.add(this.cubes);

    for (const [text, size, y] of [
      [this.title, 0.6, 0.4],
      [this.subtitle, 0.2, -0.3],
    ] as const) {
      text.font = options.fontUrl;
      text.fontSize = size;
      text.anchorX = 'center';
      text.anchorY = 'middle';
      text.position.set(0, y, 0);
      this.scene.add(text);
    }
    this.title.text = 'MOTIKORD';
    this.title.color = 0xffffff;
    this.title.letterSpacing = 0.02;
    this.subtitle.text = 'THREE D CHECK 2026';
    this.subtitle.color = 0xffb86b;

    this.random = seeded(seed ^ 0x9e3779b9);
    this.particles = new ParticleSystem({
      duration: 5,
      looping: true,
      shape: new SphereEmitter({ radius: 0.6, thickness: 1 }),
      startLife: new IntervalValue(1.2, 2.6),
      startSpeed: new IntervalValue(1.5, 4),
      startSize: new IntervalValue(0.05, 0.16),
      startColor: new ColorRange(new Vector4(1, 0.7, 0.35, 1), new Vector4(1, 0.3, 0.6, 1)),
      emissionOverTime: new ConstantValue(quality === 'full' ? 260 : 120),
      material: new THREE.MeshBasicMaterial({
        map: dotTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      renderMode: RenderMode.BillBoard,
      behaviors: [
        new ApplyForce(new QVector3(0, -1, 0), new ConstantValue(1.2)),
        new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.8, 0.4, 0), 0]])),
        new ColorOverLife(
          new Gradient(
            [
              [new QVector3(1, 1, 1), 0],
              [new QVector3(1, 0.5, 0.8), 1],
            ],
            [
              [1, 0],
              [0, 1],
            ],
          ),
        ),
      ],
    });
    this.particles.emitter.position.set(0, 0, -0.5);
    this.scene.add(this.particles.emitter);
    this.batch.addSystem(this.particles);
    this.scene.add(this.batch);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.blur = new VelocityBlurEffect(quality === 'full' ? 12 : 5);
    this.composer.addPass(new EffectPass(this.camera, this.blur));
    const dof = new DepthOfFieldEffect(this.camera, {
      focusDistance: 7,
      focusRange: 3,
      bokehScale: quality === 'full' ? 3 : 1.5,
      resolutionScale: 0.5,
    });
    this.composer.addPass(new EffectPass(this.camera, dof));
    const bloom = new BloomEffect({
      intensity: 1.4,
      luminanceThreshold: 0.55,
      luminanceSmoothing: 0.2,
      mipmapBlur: true,
    });
    this.composer.addPass(
      new EffectPass(this.camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.AGX }), this.finish),
    );
    this.composer.setSize(width * scale, height * scale, false);
  }

  /** Resolves when both text meshes are typeset (fonts parsed, SDF glyphs built). */
  ready(): Promise<void> {
    return Promise.all([this.title, this.subtitle].map((t) => new Promise<void>((done) => t.sync(done)))).then(
      () => undefined,
    );
  }

  /** Draws the frame at `t` seconds; `interval` is the frame interval the motion blur spans. Seeking back replays the particles from 0. */
  render(t: number, interval: number): void {
    if (t < this.simTime) {
      this.random = seeded(this.options.seed ^ 0x9e3779b9);
      this.particles.restart();
      this.simTime = 0;
    }
    withRandom(this.random, () => {
      while (this.simTime + STEP <= t + 1e-9) {
        this.batch.update(STEP);
        this.simTime += STEP;
      }
    });

    const k = enter(Math.min(1, t / 1.6));
    this.title.scale.setScalar(0.6 + 0.4 * k);
    this.title.rotation.y = Math.sin(t * 0.8) * 0.5 * k;
    this.title.position.z = -3 * (1 - k);
    this.subtitle.position.y = -0.3 - 0.8 * (1 - enter(Math.min(1, Math.max(0, (t - 0.4) / 1.4))));
    this.subtitle.rotation.y = this.title.rotation.y * 0.6;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.cubeSpin.forEach((c, i) => {
      q.setFromAxisAngle(c.axis, t * c.speed);
      m.compose(
        new THREE.Vector3(c.pos.x, c.pos.y + Math.sin(t * 0.4 + i) * 0.4, c.pos.z),
        q,
        new THREE.Vector3(1, 1, 1),
      );
      this.cubes.setMatrixAt(i, m);
    });
    this.cubes.instanceMatrix.needsUpdate = true;

    this.place(this.previousCamera, t - interval);
    this.place(this.camera, t);
    this.blur.track(this.previousCamera, this.camera);
    this.finish.frame = Math.round(t * 1000);
    this.composer.render(0);
  }

  private place(camera: THREE.PerspectiveCamera, t: number): void {
    const orbit = t / this.options.seconds;
    camera.position.set(Math.sin(t * 1.3) * 2.4, Math.sin(t * 0.9) * 0.6, 9 - 2.5 * Math.sin(orbit * Math.PI));
    camera.lookAt(0, 0, 0);
  }

  dispose(): void {
    this.title.dispose();
    this.subtitle.dispose();
    this.particles.dispose();
    this.composer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }
}

/** What every animatable property is when its layer has no track for it. */
export const REST: Readonly<Record<Prop, number>> = {
  x: 0,
  y: 0,
  z: 0,
  scale: 1,
  rotate: 0,
  opacity: 1,
  blur: 0,
  weight: 400,
  width: 100,
  draw: 1,
  morph: 0,
  mask: 1,
  rotateY: 0,
};

export interface LayerFrame {
  id: string;
  start: number;
  /** ms since the layer started; negative before it starts. */
  local: number;
  props: Record<Prop, number>;
}
export interface FrameState {
  t: number;
  layers: LayerFrame[];
  /** Progress 0..1 of the scene's camera move; T3 turns it into a camera. */
  camera: { move: CameraMove; amount: number; focus?: string; progress: number };
}

/** The state of a v3 scene at `t` ms. Pure: depends only on the recipe and t. */
export function frameAt(scene: SceneV3, t: number, feel: Feel = 'smooth'): FrameState {
  const starts = layerStarts(scene.layers);
  const fallback = FEEL[feel].curve;
  const layers = scene.layers.map((layer, i) => {
    const start = starts[i] as number;
    const local = t - start;
    const props = { ...REST };
    for (const prop of PROPS) {
      const track = layer.tracks[prop];
      if (track?.length) props[prop] = valueAt(track, local, fallback);
    }
    if (layer.z) props.z += layer.z;
    return { id: layer.id, start, local, props };
  });
  const { move, amount, focus } = scene.camera;
  return { t, layers, camera: { move, amount, focus, progress: progress(t, 0, scene.ms) } };
}

/** World units per recipe unit: recipe x/y are in a 1080-wide frame, the graph is 10 units wide. */
export const UNIT = 10 / 1080;

/** A three.js graph for a v3 scene: one group per layer under a depth group with its parallax. */
export interface MotionGraph {
  root: THREE.Group;
  depths: Record<Depth, THREE.Group>;
  layers: Map<string, THREE.Group>;
}

/** Builds the scene graph for a SceneV3. Layer content (type, paths, media) is added by later tasks under each layer group. */
export function buildGraph(scene: SceneV3): MotionGraph {
  const root = new THREE.Group();
  root.name = scene.id;
  const depths = {} as Record<Depth, THREE.Group>;
  for (const depth of DEPTHS) {
    const g = new THREE.Group();
    g.name = `depth:${depth}`;
    g.userData.parallax = PARALLAX[depth];
    depths[depth] = g;
    root.add(g);
  }
  const layers = new Map<string, THREE.Group>();
  for (const layer of scene.layers) {
    const g = new THREE.Group();
    g.name = layer.id;
    g.userData.kind = layer.kind;
    depths[layer.depth].add(g);
    layers.set(layer.id, g);
  }
  return { root, depths, layers };
}

/** Puts a frame's state onto the graph. Opacity, blur and the type axes go to userData for the layer's content to read. */
export function applyFrame(graph: MotionGraph, frame: FrameState): void {
  for (const { id, props, local } of frame.layers) {
    const g = graph.layers.get(id);
    if (!g) continue;
    g.position.set(props.x * UNIT, -props.y * UNIT, props.z * UNIT);
    g.scale.setScalar(props.scale);
    g.rotation.set(0, (props.rotateY * Math.PI) / 180, (-props.rotate * Math.PI) / 180);
    g.visible = local >= 0 && props.opacity > 0;
    Object.assign(g.userData, {
      opacity: props.opacity,
      blur: props.blur,
      weight: props.weight,
      width: props.width,
      draw: props.draw,
      morph: props.morph,
      mask: props.mask,
    });
  }
  graph.root.updateMatrixWorld(true);
}
