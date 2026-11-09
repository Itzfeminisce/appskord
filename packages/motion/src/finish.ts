import * as THREE from 'three';
import { DepthOfFieldEffect, Effect, EffectPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import type { Pass } from 'postprocessing';
import { createEffect, FinishEffect, isActive, LibraryEffect, planEffects } from './effects';
import type { EffectUse, PlannedEffect } from './effects';
import { MotionBlur, shutterMs } from './motion-blur';
import type { FrameState, MotionGraph } from './scene';
import type { Finish, LookGuide } from './types';

/** The Finishing switch and its four steps, copied from the MotionV3 and SettingsV3 frames. */
export const FINISHING = {
  name: 'Finishing',
  line: 'Motion blur, soft light, fine grain and a gentle grade on every export.',
  steps: [
    { name: 'Motion blur', line: 'Fast moves streak like a real shutter.' },
    { name: 'Soft light', line: 'Light falls off gently toward the edges.' },
    { name: 'Fine grain', line: 'Fine texture that stops gradients banding.' },
    { name: 'Gentle grade', line: 'Softer blacks and a slight warm lift.' },
  ],
} as const;

/** On by default; packs set their own amounts. */
export const DEFAULT_FINISH: Finish = { on: true, blur: 0.5, light: 0.5, grain: 0.5, grade: 0.5 };

export interface FinishParams {
  vignette: number;
  center: [number, number];
  grain: number;
  lift: [number, number, number];
  gain: [number, number, number];
  saturation: number;
}

const clamp = (a: number) => (Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 0);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

// Light falls off away from the look's light, so the bright side sits nearer it (uv: y up).
const LIGHT_CENTER: Record<LookGuide['light'], [number, number]> = {
  left: [0.4, 0.55],
  right: [0.6, 0.55],
  top: [0.5, 0.62],
  none: [0.5, 0.5],
};

/** The finish shader's numbers from the recipe's 0..1 amounts; null when finishing is off, so the frame passes through. */
export function finishParams(finish: Finish, look?: Pick<LookGuide, 'light'>): FinishParams | null {
  if (!finish.on) return null;
  const light = clamp(finish.light);
  const grain = clamp(finish.grain);
  const g = clamp(finish.grade);
  return {
    vignette: r3(0.9 * light),
    center: LIGHT_CENTER[look?.light ?? 'none'],
    grain: r3(0.12 * grain),
    lift: [r3(0.035 * g), r3(0.025 * g), r3(0.02 * g)],
    gain: [r3(1 + 0.04 * g), r3(1 + 0.01 * g), r3(1 - 0.03 * g)],
    saturation: r3(1 + 0.08 * g),
  };
}

export interface ChainOptions {
  mode: 'export' | 'preview';
  /** Preview only: drop heavy effects and use fewer blur samples. Export ignores it. */
  lighter?: boolean;
  fps: number;
  look?: Pick<LookGuide, 'light' | 'palette'>;
}

export interface FinishPlan {
  blur: { shutterMs: number; samples: number } | null;
  effects: PlannedEffect[];
  finish: FinishParams | null;
}

/** What the chain draws for a clip. Pure; export always gets every effect at full samples. */
export function planFinish(finish: Finish, uses: readonly EffectUse[], o: ChainOptions): FinishPlan {
  const lighter = o.mode === 'preview' && !!o.lighter;
  const shutter = shutterMs(finish, o.fps);
  return {
    blur: shutter > 0 ? { shutterMs: shutter, samples: lighter ? 5 : 12 } : null,
    effects: planEffects(uses, { mode: o.mode, lighter, look: o.look }),
    finish: finishParams(finish, o.look),
  };
}

interface Built {
  planned: PlannedEffect;
  effect: Effect;
  opacity: number;
}

/**
 * The passes after the scene's RenderPass: motion blur, library effects (one pass per convolution effect),
 * then tone mapping, the merged non-convolution effects and the finish. Uniforms change per frame; shaders never do.
 */
export class FinishChain {
  readonly plan: FinishPlan;
  readonly passes: Pass[] = [];
  readonly blur: MotionBlur | null = null;
  private readonly built: Built[] = [];
  private readonly finish: FinishEffect | null = null;

  constructor(
    camera: THREE.Camera,
    finish: Finish,
    uses: readonly EffectUse[],
    options: ChainOptions & { width: number; height: number },
  ) {
    this.plan = planFinish(finish, uses, options);
    if (this.plan.blur) {
      this.blur = new MotionBlur(this.plan.blur.samples, options.width, options.height);
      this.passes.push(new EffectPass(camera, this.blur.effect));
    }
    const merged: Effect[] = [];
    for (const planned of this.plan.effects) {
      const effect = createEffect(planned, camera);
      this.built.push({ planned, effect, opacity: effect.blendMode.opacity.value });
      if (planned.entry.convolution) this.passes.push(new EffectPass(camera, effect));
      else merged.push(effect);
    }
    const f = this.plan.finish;
    if (f) {
      this.finish = new FinishEffect({
        lift: new THREE.Vector3(...f.lift),
        gain: new THREE.Vector3(...f.gain),
        saturation: f.saturation,
        grain: f.grain,
        vignette: f.vignette,
        center: new THREE.Vector2(...f.center),
      });
    }
    // Tone mapping always runs: bloom and glow produce HDR values even when the finish is off.
    const last: Effect[] = [...merged, new ToneMappingEffect({ mode: ToneMappingMode.AGX })];
    if (this.finish) last.push(this.finish);
    this.passes.push(new EffectPass(camera, ...last));
  }

  /** Sets everything that follows time: effect on/off by scope, moving effects' clock, grain seed, focus. */
  update({
    sceneId,
    t,
    frame,
    graph,
  }: {
    sceneId: string;
    /** ms on the clip's timeline; the grain and moving effects key off it. */
    t: number;
    frame?: FrameState;
    graph?: MotionGraph;
  }): void {
    const ms = Math.round(t);
    for (const b of this.built) {
      b.effect.blendMode.opacity.value = isActive(b.planned.use, sceneId, frame) ? b.opacity : 0;
      if (b.effect instanceof LibraryEffect) b.effect.clock = ms;
      const layer = b.planned.use.layerId && graph?.layers.get(b.planned.use.layerId);
      if (layer && b.effect instanceof DepthOfFieldEffect) {
        b.effect.target = layer.getWorldPosition(b.effect.target ?? new THREE.Vector3());
      }
    }
    if (this.finish) this.finish.frame = ms;
  }

  setSize(width: number, height: number): void {
    this.blur?.setSize(width, height);
  }

  dispose(): void {
    this.blur?.dispose();
    for (const p of this.passes) p.dispose();
  }
}
