import * as THREE from 'three';
import { VelocityBlurEffect } from './effects';
import { applyFrame, frameAt, type FrameState, type MotionGraph } from './scene';
import { frameMs } from './time';
import { DEPTHS, PROPS } from './types';
import type { Feel, Finish, Prop, SceneV3 } from './types';

/** How far back the shutter reaches: blur 1 is a full frame interval, blur 0 or finish off is none. */
export function shutterMs(finish: Finish, fps: number): number {
  return finish.on ? Math.min(1, Math.max(0, finish.blur)) * frameMs(1, fps) : 0;
}

export interface LayerVelocity {
  id: string;
  /** Change of each property across the shutter, in recipe units. */
  delta: Record<Prop, number>;
  moving: boolean;
}

/** Per-layer velocity: frameAt(t) minus frameAt(t - shutter). Pure, so the blur at t depends only on the recipe and t. */
export function layerVelocities(scene: SceneV3, t: number, shutter: number, feel: Feel = 'smooth'): LayerVelocity[] {
  const now = frameAt(scene, t, feel);
  const before = frameAt(scene, Math.max(0, t - shutter), feel);
  return now.layers.map((layer, i) => {
    const prev = before.layers[i]!;
    const delta = {} as Record<Prop, number>;
    let moving = false;
    for (const p of PROPS) {
      delta[p] = layer.props[p] - prev.props[p];
      if (delta[p] !== 0 && p !== 'opacity') moving = true;
    }
    return { id: layer.id, delta, moving };
  });
}

const velocityVertex = /* glsl */ `
uniform mat4 previousModel;
uniform mat4 previousViewProjection;
varying vec4 vNow;
varying vec4 vBefore;
void main() {
  vNow = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vBefore = previousViewProjection * previousModel * vec4(position, 1.0);
  gl_Position = vNow;
}
`;

const velocityFragment = /* glsl */ `
varying vec4 vNow;
varying vec4 vBefore;
void main() {
  gl_FragColor = vec4((vNow.xy / vNow.w - vBefore.xy / vBefore.w) * 0.5, 0.0, 1.0);
}
`;

const viewProjection = (camera: THREE.Camera) => {
  camera.updateMatrixWorld();
  return new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
};

/** The layer's content bounds in its own space, as a matrix that maps the unit cube onto them; null when empty. */
function layerBounds(group: THREE.Object3D): THREE.Matrix4 | null {
  const box = new THREE.Box3();
  const inverse = group.matrixWorld.clone().invert();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh & { isInstancedMesh?: boolean; boundingBox?: THREE.Box3 | null };
    if (!mesh.isMesh || !mesh.geometry) return;
    let b: THREE.Box3 | null;
    if (mesh.isInstancedMesh) {
      if (!mesh.boundingBox) (mesh as unknown as THREE.InstancedMesh).computeBoundingBox();
      b = mesh.boundingBox ?? null;
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      b = mesh.geometry.boundingBox;
    }
    if (b && !b.isEmpty()) box.union(b.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
  });
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(1e-3, 1e-3, 1e-3));
  return new THREE.Matrix4().compose(box.getCenter(new THREE.Vector3()), new THREE.Quaternion(), size);
}

/**
 * The finish's motion blur. Each layer draws its screen velocity (from its pose at t - shutter and at t) into a
 * buffer as a box over its content; the blur shader streaks along it, and along camera motion everywhere else.
 */
export class MotionBlur {
  readonly effect: VelocityBlurEffect;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly proxies = new THREE.Scene();
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly meshes = new Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>>();
  private readonly before = new Map<string, THREE.Matrix4>();

  constructor(samples: number, width: number, height: number) {
    this.target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    // The buffer already spans t - shutter to t, so the shader takes it whole.
    this.effect = new VelocityBlurEffect(samples, 1, this.target.texture);
  }

  /** Poses the graph at the shutter's start, records each layer, then poses it at t. `pose` lets the renderer add camera and parallax. */
  capture(
    graph: MotionGraph,
    before: FrameState,
    now: FrameState,
    pose: (graph: MotionGraph, frame: FrameState) => void = applyFrame,
  ): void {
    pose(graph, before);
    this.before.clear();
    graph.layers.forEach((g, id) => this.before.set(id, g.matrixWorld.clone()));
    pose(graph, now);
  }

  /** Draws the velocity buffer and points the blur at both cameras. Back layers first so front layers win. */
  render(renderer: THREE.WebGLRenderer, graph: MotionGraph, camera: THREE.Camera, previousCamera: THREE.Camera): void {
    const previousViewProjection = viewProjection(previousCamera);
    const seen = new Set<string>();
    let order = 0;
    for (const depth of DEPTHS.slice().reverse()) {
      for (const g of graph.depths[depth].children) {
        const before = this.before.get(g.name);
        const bounds = g.visible ? layerBounds(g) : null;
        if (!before || !bounds) continue;
        const mesh = this.proxy(g.name);
        mesh.matrixWorld.multiplyMatrices(g.matrixWorld, bounds);
        mesh.material.uniforms.previousModel!.value.multiplyMatrices(before, bounds);
        mesh.material.uniforms.previousViewProjection!.value.copy(previousViewProjection);
        mesh.renderOrder = order++;
        mesh.visible = true;
        seen.add(g.name);
      }
    }
    this.meshes.forEach((m, id) => (m.visible = seen.has(id)));

    const target = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.proxies, camera);
    renderer.setRenderTarget(target);
    renderer.setClearColor(clear, alpha);
    this.effect.track(previousCamera, camera);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  private proxy(id: string): THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> {
    let mesh = this.meshes.get(id);
    if (!mesh) {
      mesh = new THREE.Mesh(
        this.box,
        new THREE.ShaderMaterial({
          vertexShader: velocityVertex,
          fragmentShader: velocityFragment,
          uniforms: {
            previousModel: { value: new THREE.Matrix4() },
            previousViewProjection: { value: new THREE.Matrix4() },
          },
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      mesh.frustumCulled = false;
      this.meshes.set(id, mesh);
      this.proxies.add(mesh);
    }
    return mesh;
  }

  dispose(): void {
    this.meshes.forEach((m) => m.material.dispose());
    this.box.dispose();
    this.target.dispose();
    this.effect.dispose();
  }
}
