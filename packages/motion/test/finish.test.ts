import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  EFFECT_COLOURS,
  EFFECT_FILTERS,
  EFFECT_SCOPES,
  EFFECTS,
  EFFECTS_NOTE,
  effectColour,
  effectParams,
  effectTracks,
  FinishEffect,
  isActive,
  LibraryEffect,
  planEffects,
  type EffectUse,
  VelocityBlurEffect,
} from '../src/effects';
import { DEFAULT_FINISH, FINISHING, FinishChain, finishParams, planFinish } from '../src/finish';
import { layerVelocities, shutterMs } from '../src/motion-blur';
import { frameAt } from '../src/scene';
import { clip, scene } from './fixture';

const use = (effect: EffectUse['effect'], amount = 0.5, o: Partial<EffectUse> = {}): EffectUse => ({
  effect,
  amount,
  scope: 'clip',
  ...o,
});
const look = { light: 'left' as const, palette: ['#0B0B10', '#F5F5F7', '#8B9CFF', '#1A1B2E', '#8E90A0'] };

describe('effects library', () => {
  it('matches the EffectsLibrary frame', () => {
    expect(EFFECTS.map((e) => e.name)).toEqual([
      'Glass',
      'Glow',
      'Bloom',
      'Depth of field',
      'Dither',
      'Distort',
      'Chromatic',
      '3D flip',
      'Light sweep',
      'Grain',
      'Halftone',
      'Blur in',
    ]);
    expect(EFFECTS.map((e) => e.group)).toEqual([
      'Light',
      'Light',
      'Light',
      'Reveal',
      'Texture',
      'Distort',
      'Distort',
      'Distort',
      'Light',
      'Texture',
      'Texture',
      'Reveal',
    ]);
    expect(EFFECT_FILTERS).toEqual(['All', 'Light', 'Texture', 'Distort', 'Reveal']);
    expect(EFFECT_COLOURS.map((c) => c.label)).toEqual(['Glow', 'Light', 'Ink']);
    expect(EFFECT_SCOPES.map((c) => c.label)).toEqual(['This layer', 'This scene', 'Whole clip']);
    const glow = EFFECTS.find((e) => e.id === 'glow')!;
    expect(glow.line).toBe('A soft halo in your look’s light.');
    expect(glow.amount).toBe(0.6);
    expect(EFFECTS_NOTE).toBe(
      'Effects run on this computer. Preview may be lighter on a slow computer; export never is.',
    );
  });

  it('turns a use into shader numbers from its amount and the look', () => {
    expect(effectParams(use('glow', 0.6), look)).toEqual({
      intensity: 1.2,
      threshold: 0.42,
      radius: 16.8,
      colour: '#8B9CFF',
    });
    expect(effectParams(use('chromatic', 1))).toEqual({ offset: 0.006, radial: true });
    expect(effectParams(use('grain', 2))).toEqual(effectParams(use('grain', 1)));
    expect(effectParams(use('grain', Number.NaN))).toEqual({ amount: 0 });
    expect(effectColour('ink', look)).toBe('#F5F5F7');
    expect(effectColour('light')).toBe('#B8C1FF');
    expect(effectColour('light', look)).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('builds library shaders with the params as uniforms', () => {
    const e = new LibraryEffect('dither', effectParams(use('dither', 1)));
    expect(e.uniforms.get('levels')!.value).toBe(4);
    expect(e.uniforms.get('mixAmount')!.value).toBe(1);
    e.clock = 1234;
    expect(e.uniforms.get('clock')!.value).toBe(1234);
    expect(new LibraryEffect('glow', effectParams(use('glow'))).uniforms.get('colour')!.value).toBeInstanceOf(
      THREE.Color,
    );
  });

  it('keeps every shader effect in export and drops only heavy ones from a lighter preview', () => {
    const uses = EFFECTS.map((e) => use(e.id));
    const shaders = EFFECTS.filter((e) => e.kind === 'shader').map((e) => e.id);
    expect(planEffects(uses, { mode: 'export', lighter: true }).map((p) => p.use.effect)).toEqual(shaders);
    expect(planEffects(uses, { mode: 'preview' }).map((p) => p.use.effect)).toEqual(shaders);
    const lighter = planEffects(uses, { mode: 'preview', lighter: true }).map((p) => p.use.effect);
    expect(lighter).not.toContain('glass');
    expect(lighter).not.toContain('depth-of-field');
    expect(lighter).toContain('glow');
  });

  it('shows a use only in its scene or while its layer is on screen', () => {
    const f = frameAt(scene(), 100);
    expect(isActive(use('glow'), 's9', f)).toBe(true);
    expect(isActive(use('glow', 0.5, { scope: 'scene', sceneId: 's1' }), 's2')).toBe(false);
    expect(isActive(use('glow', 0.5, { scope: 'layer', sceneId: 's1', layerId: 'blob' }), 's1', f)).toBe(true);
    expect(isActive(use('glow', 0.5, { scope: 'layer', layerId: 'nope' }), 's1', f)).toBe(false);
  });

  it('writes Blur in as keyframes and leaves 3D flip for a track the recipe lacks', () => {
    expect(effectTracks(use('blur-in', 1))).toEqual({
      blur: [
        { t: 0, v: 24 },
        { t: 600, v: 0 },
      ],
      opacity: [
        { t: 0, v: 0 },
        { t: 360, v: 1 },
      ],
    });
    expect(effectTracks(use('3d-flip'))).toBeNull();
  });
});

describe('finishing', () => {
  it('copies the frame text and is on by default', () => {
    expect(FINISHING.line).toBe('Motion blur, soft light, fine grain and a gentle grade on every export.');
    expect(FINISHING.steps.map((s) => s.name)).toEqual(['Motion blur', 'Soft light', 'Fine grain', 'Gentle grade']);
    expect(DEFAULT_FINISH.on).toBe(true);
  });

  it('maps the recipe amounts to the finish shader', () => {
    expect(finishParams(DEFAULT_FINISH, look)).toEqual({
      vignette: 0.45,
      center: [0.4, 0.55],
      grain: 0.06,
      lift: [0.018, 0.013, 0.01],
      gain: [1.02, 1.005, 0.985],
      saturation: 1.04,
    });
    expect(finishParams(clip().finish)).toMatchObject({ vignette: 0.36, grain: 0.024, saturation: 1.024 });
    const zero = finishParams({ on: true, blur: 0, light: 0, grain: 0, grade: 0 })!;
    expect([zero.vignette, zero.grain, zero.saturation, ...zero.lift, ...zero.gain]).toEqual([
      0, 0, 1, 0, 0, 0, 1, 1, 1,
    ]);
  });

  it('passes the frame through when finishing is off', () => {
    const off = { ...DEFAULT_FINISH, on: false };
    expect(finishParams(off)).toBeNull();
    expect(shutterMs(off, 30)).toBe(0);
    expect(planFinish(off, [], { mode: 'export', fps: 30 })).toEqual({ blur: null, effects: [], finish: null });
  });

  it('builds no finish shader and no blur pass when finishing is off', () => {
    const camera = new THREE.PerspectiveCamera();
    const off = new FinishChain(camera, { ...DEFAULT_FINISH, on: false }, [], {
      mode: 'export',
      fps: 30,
      width: 8,
      height: 8,
    });
    const effects = off.passes.flatMap((p) => (p as unknown as { effects: unknown[] }).effects);
    expect(off.blur).toBeNull();
    expect(off.passes).toHaveLength(1);
    expect(effects.some((e) => e instanceof FinishEffect)).toBe(false);
    expect(effects.some((e) => e instanceof VelocityBlurEffect)).toBe(false);
    const on = new FinishChain(camera, DEFAULT_FINISH, [], { mode: 'export', fps: 30, width: 8, height: 8 });
    expect(
      on.passes.flatMap((p) => (p as unknown as { effects: unknown[] }).effects).some((e) => e instanceof FinishEffect),
    ).toBe(true);
  });

  it('never lightens export; a lighter preview uses fewer blur samples', () => {
    const o = { fps: 60, lighter: true } as const;
    expect(planFinish(DEFAULT_FINISH, [], { ...o, mode: 'export' }).blur).toEqual({ shutterMs: 500 / 60, samples: 12 });
    expect(planFinish(DEFAULT_FINISH, [], { ...o, mode: 'preview' }).blur?.samples).toBe(5);
  });

  it('keeps the T0 finish defaults for the check page', () => {
    const f = new FinishEffect();
    expect(f.uniforms.get('vignette')!.value).toBe(0.7);
    expect((f.uniforms.get('center')!.value as THREE.Vector2).toArray()).toEqual([0.5, 0.5]);
  });
});

describe('motion blur velocity', () => {
  it('is frameAt(t) minus frameAt(t - shutter), the same in any order', () => {
    const shutter = shutterMs(DEFAULT_FINISH, 30);
    const v = layerVelocities(scene(), 1500, shutter);
    const blob = v.find((l) => l.id === 'blob')!;
    const expected =
      frameAt(scene(), 1500).layers.find((l) => l.id === 'blob')!.props.x -
      frameAt(scene(), 1500 - shutter).layers.find((l) => l.id === 'blob')!.props.x;
    expect(blob.delta.x).toBeCloseTo(expected, 9);
    expect(blob.moving).toBe(true);
    expect(JSON.stringify(layerVelocities(scene(), 1500, shutter))).toBe(JSON.stringify(v));
    expect(layerVelocities(scene(), 1500, 0).every((l) => !l.moving)).toBe(true);
  });
});
