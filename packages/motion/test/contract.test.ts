import { describe, expect, it } from 'vitest';
import { EFFECTS } from '../src/effects';
import { PARTICLE_DEFAULTS, PARTICLE_PRESETS } from '../src/particles';
import { EFFECT_IDS, PARTICLE_PRESET_IDS, validateClip, validateScene } from '../src/recipe';
import { frameAt } from '../src/scene';
import type { ClipV3, SceneV3 } from '../src/types';
import { clip, scene } from './fixture';

const errors = (x: unknown) => {
  const r = validateScene(x);
  return r.ok ? [] : r.errors;
};

describe('v3 contract additions (T6)', () => {
  it('keeps the validator id lists equal to the engine lists', () => {
    expect([...PARTICLE_PRESET_IDS]).toEqual([...PARTICLE_PRESETS]);
    expect([...EFFECT_IDS]).toEqual(EFFECTS.map((e) => e.id));
  });

  it('accepts start, particles with a bake, rotateY, scene effects, depth blur and shadows', () => {
    const s: SceneV3 = scene();
    s.layers[2]!.start = 120;
    s.layers[2]!.particles = { ...PARTICLE_DEFAULTS, bake: { key: 'k', fps: 30, counts: [0, 2], data: '' } };
    s.layers[0]!.tracks.rotateY = [
      { t: 0, v: 90 },
      { t: 400, v: 0 },
    ];
    s.effects = [
      { effect: 'glow', amount: 0.6, colour: 'glow', scope: 'layer', layerId: 'headline' },
      { effect: '3d-flip', amount: 0.5, scope: 'scene', sceneId: 's1' },
    ];
    s.depthBlur = 'soft';
    s.depthShadows = true;
    expect(errors(s)).toEqual([]);
    const c: ClipV3 = { ...clip(), effects: [{ effect: 'grain', amount: 0.3, scope: 'clip' }] };
    expect(validateClip(c).ok).toBe(true);
  });

  it('rotateY turns the layer and defaults to 0', () => {
    const s = scene();
    s.layers[0]!.tracks.rotateY = [
      { t: 0, v: 90 },
      { t: 360, v: 0 },
    ];
    const f = frameAt(s, 0);
    expect(f.layers[0]!.props.rotateY).toBe(90);
    expect(f.layers[1]!.props.rotateY).toBe(0);
  });

  it('rejects bad particles, effects and depth settings naming the key and the fix', () => {
    const s = scene() as unknown as Record<string, unknown> & { layers: Record<string, unknown>[] };
    s.layers[2]!.particles = { ...PARTICLE_DEFAULTS, preset: 'rain', gravity: 'yes' };
    s.effects = [
      { effect: 'sparkle', amount: 2, scope: 'layer' },
      { effect: 'glow', amount: 0.5, scope: 'layer', layerId: 'nope', colour: 'red' },
    ];
    s.depthBlur = 'heavy';
    s.depthShadows = 1;
    const es = errors(s);
    expect(es).toContain(
      'layers[2].particles.preset: "rain" is not a particle preset. Use one of confetti, sparks, dust, bubbles, snow, text-burst.',
    );
    expect(es).toContain('layers[2].particles.gravity: is not true or false. Set it to true or false.');
    expect(es.some((e) => e.startsWith('effects[0].effect: "sparkle" is not a known effect.'))).toBe(true);
    expect(es).toContain('effects[0].amount: must be a number from 0 to 1. Set it to a number in that range.');
    expect(es).toContain('effects[0].layerId: is missing for a layer effect. Set it to the layer the effect is on.');
    expect(es).toContain('effects[1].layerId: "nope" is not a layer id in this scene. Use a layer id from layers.');
    expect(es).toContain('effects[1].colour: "red" is not a known effect colour. Use one of glow, light, ink.');
    expect(es).toContain('depthBlur: "heavy" is not a depth blur. Use one of nothing, soft.');
    expect(es).toContain('depthShadows: is not true or false. Set it to true or false.');
    const c = { ...clip(), effects: [{ effect: 'glow', amount: 0.5, scope: 'world' }] };
    const r = validateClip(c);
    expect(r.ok ? [] : r.errors).toEqual([
      'effects[0].scope: "world" is not a known effect scope. Use one of layer, scene, clip.',
    ]);
  });
});
