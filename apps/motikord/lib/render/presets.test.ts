import { describe, expect, it } from 'vitest';
import type { Feel, PresetSlot } from '../types';
import { PRESET_IDS, PRESETS, REST, getPreset, isPresetId, layerPose, presetsFor } from './presets';

const FEELS: Feel[] = ['smooth', 'snappy', 'bouncy', 'steady'];
const SLOTS: PresetSlot[] = ['in', 'during', 'out'];

describe('presets', () => {
  it('ids are unique and exported as the typed list', () => {
    expect(new Set(PRESET_IDS).size).toBe(PRESETS.length);
    expect(PRESET_IDS).toEqual(PRESETS.map((p) => p.id));
    expect(isPresetId('rise-in')).toBe(true);
    expect(isPresetId('spin-forever')).toBe(false);
  });

  it.each(SLOTS)('slot %s has at least one preset for every Feel', (slot) => {
    for (const feel of FEELS) expect(presetsFor(slot).some((p) => p.feels.includes(feel))).toBe(true);
  });

  it('the "Comes in" set is the Presets frame tiles, in order', () => {
    expect(presetsFor('in').map((p) => p.label)).toEqual(['Fade', 'Rise', 'Pop', 'Slide', 'Wipe', 'Type on', 'Grow', 'Blur in', 'Drop']);
  });

  it('every preset has a default duration inside the "How long" range', () => {
    for (const p of PRESETS) {
      expect(p.defaultMs).toBeGreaterThanOrEqual(200);
      expect(p.defaultMs).toBeLessThanOrEqual(2000);
    }
  });

  it('every in and out preset is at rest at p = 1', () => {
    for (const p of PRESETS.filter((x) => x.slot !== 'during')) {
      const pose = { ...REST, ...p.pose(1) };
      expect(pose.alpha).toBeCloseTo(1);
      expect(pose.dx).toBeCloseTo(0);
      expect(pose.dy).toBeCloseTo(0);
      expect(pose.scale).toBeCloseTo(1);
      expect(pose.reveal).toBeCloseTo(1);
      expect(pose.typed).toBeCloseTo(1);
      expect(pose.blur).toBeCloseTo(0);
    }
  });
});

describe('layerPose', () => {
  const layer = {
    startMs: 0, endMs: 3000,
    in: { preset: 'fade-in', feel: 'steady' as Feel, durationMs: 600 },
    out: { preset: 'fade-out', feel: 'steady' as Feel, durationMs: 400 },
  };

  it('comes in, rests and goes out', () => {
    expect(layerPose(layer, 0).alpha).toBe(0);
    expect(layerPose(layer, 300).alpha).toBeCloseTo(0.5);
    expect(layerPose(layer, 1500).alpha).toBe(1);
    expect(layerPose(layer, 2800).alpha).toBeCloseTo(0.5);
    expect(layerPose(layer, 3000).alpha).toBe(0);
  });

  it('ignores unknown presets and presets in the wrong slot', () => {
    expect(layerPose({ ...layer, in: { preset: 'nope', feel: 'smooth', durationMs: 500 }, out: undefined }, 0)).toEqual(REST);
    expect(layerPose({ ...layer, in: { preset: 'fade-out', feel: 'smooth', durationMs: 500 }, out: undefined }, 0)).toEqual(REST);
  });

  it('during repeats every cycle', () => {
    const l = { startMs: 0, endMs: 5000, during: { preset: 'bounce', feel: 'smooth' as Feel, durationMs: 800 } };
    expect(layerPose(l, 400).dy).toBeLessThan(0);
    expect(layerPose(l, 400).dy).toBeCloseTo(layerPose(l, 1200).dy);
    expect(getPreset('bounce')?.slot).toBe('during');
  });

  it('scales in and out down so a short layer still reaches full pose', () => {
    const l = { startMs: 0, endMs: 600, in: { preset: 'fade-in', feel: 'steady' as Feel, durationMs: 600 }, out: { preset: 'fade-out', feel: 'steady' as Feel, durationMs: 600 } };
    expect(layerPose(l, 300).alpha).toBeCloseTo(1);
    expect(layerPose(l, 150).alpha).toBeCloseTo(0.5);
  });

  it('ends the out phase at the scene end when the layer runs past it', () => {
    const l = { startMs: 0, endMs: 5000, out: { preset: 'fade-out', feel: 'steady' as Feel, durationMs: 500 } };
    expect(layerPose(l, 1000, 1000).alpha).toBeCloseTo(0);
    expect(layerPose(l, 750, 1000).alpha).toBeCloseTo(0.5);
    expect(layerPose(l, 750).alpha).toBe(1);
  });
});

describe('while on screen presets', () => {
  const DURING = ['bounce', 'pulse', 'float', 'shake', 'slow-zoom', 'glow'];
  const FEEL_LIST: Feel[] = ['smooth', 'snappy', 'bouncy', 'steady'];
  const mk = (preset: string, feel: Feel) => ({ startMs: 0, endMs: 6000, during: { preset, feel, durationMs: 1000 } });
  const dev = (id: string, feel: Feel, t: number) => {
    const p = layerPose(mk(id, feel), t);
    return Math.abs(p.dx) + Math.abs(p.dy) + Math.abs(p.scale - 1) + p.glow;
  };

  it('the "While on screen" set is the frame tiles, in order', () => {
    expect(presetsFor('during').map((p) => p.label)).toEqual(['Bounce', 'Pulse', 'Float', 'Shake', 'Slow zoom', 'Glow']);
    for (const id of DURING) expect(isPresetId(id)).toBe(true);
  });

  it.each(DURING)('%s is zero at the layer in and out boundaries, for every Feel', (id) => {
    for (const feel of FEEL_LIST) {
      expect(dev(id, feel, 0)).toBeCloseTo(0);
      expect(dev(id, feel, 6000)).toBeCloseTo(0);
    }
  });

  it.each(DURING)('%s is periodic and deterministic', (id) => {
    for (const feel of FEEL_LIST) {
      expect(layerPose(mk(id, feel), 2370)).toEqual(layerPose(mk(id, feel), 2370));
      expect(layerPose(mk(id, feel), 2370).dy).toBeCloseTo(layerPose(mk(id, feel), 3370).dy);
      expect(layerPose(mk(id, feel), 2370).scale).toBeCloseTo(layerPose(mk(id, feel), 3370).scale);
      expect(layerPose(mk(id, feel), 2370).glow).toBeCloseTo(layerPose(mk(id, feel), 3370).glow);
    }
  });

  it('each moves its own field', () => {
    expect(layerPose(mk('pulse', 'steady'), 2500).scale).toBeGreaterThan(1);
    expect(layerPose(mk('slow-zoom', 'steady'), 2500).scale).toBeGreaterThan(1);
    expect(layerPose(mk('float', 'steady'), 2250).dy).toBeLessThan(0);
    expect(layerPose(mk('shake', 'steady'), 2000 + 62).dx).not.toBe(0);
    expect(layerPose(mk('glow', 'steady'), 2500).glow).toBeGreaterThan(0.5);
    expect(layerPose(mk('glow', 'steady'), 2500).glow).toBeLessThanOrEqual(1);
  });

  it('Feels change amplitude', () => {
    expect(Math.abs(layerPose(mk('float', 'bouncy'), 2250).dy)).toBeGreaterThan(Math.abs(layerPose(mk('float', 'steady'), 2250).dy));
  });
});
