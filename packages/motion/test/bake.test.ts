import { describe, expect, test } from 'vitest';
import { bakeParticles, PARTICLE_DEFAULTS, PARTICLE_PRESETS, particlesAt } from '../src/particles';
import type { ParticleInput } from '../src/particles';
import { bakeSecondary } from '../src/physics';
import type { SecondaryInput } from '../src/physics';

const input = (over: Partial<ParticleInput> = {}): ParticleInput => ({
  settings: { ...PARTICLE_DEFAULTS, bounce: false },
  seed: 24,
  ms: 2000,
  fps: 30,
  ...over,
});
const words = [{ x: 0, y: 0, w: 800, h: 160 }];

describe('particles bake', () => {
  test.each(PARTICLE_PRESETS)('%s replays the same from the same seed', async (preset) => {
    const i = input({ settings: { ...PARTICLE_DEFAULTS, preset, bounce: false } });
    const a = await bakeParticles(i);
    const b = await bakeParticles(i);
    expect(b).toEqual(a);
    expect(a.counts).toHaveLength(60);
    expect(Math.max(...a.counts)).toBeGreaterThan(0);
  });
  test('a new seed (Shuffle) gives a different bake and key', async () => {
    const a = await bakeParticles(input());
    const b = await bakeParticles(input({ seed: 25 }));
    expect(b.data).not.toBe(a.data);
    expect(b.key).not.toBe(a.key);
  });
  test('bounces off text: rapier bake replays the same and keeps particles out of the words', async () => {
    const i = input({ settings: { ...PARTICLE_DEFAULTS, bounce: true }, colliders: words, ms: 3000 });
    const a = await bakeParticles(i);
    expect(await bakeParticles(i)).toEqual(a);
    const inside = particlesAt(a, 2900).filter((p) => Math.abs(p.x) < 380 && Math.abs(p.y) < 60);
    expect(inside.length).toBeLessThanOrEqual(2);
    const free = await bakeParticles({ ...i, settings: { ...i.settings, bounce: false } });
    expect(free.data).not.toBe(a.data);
  });
  test('frame t reads only the bake, in any order', async () => {
    const bake = await bakeParticles(input());
    const late = particlesAt(bake, 1500);
    particlesAt(bake, 100);
    expect(particlesAt(bake, 1500)).toEqual(late);
    expect(particlesAt(JSON.parse(JSON.stringify(bake)), 1500)).toEqual(late);
    expect(particlesAt(bake, -1)).toEqual([]);
    const p = late[0]!;
    expect(p.size).toBeGreaterThan(3);
    expect(p.alpha).toBeGreaterThan(0);
  });
});

describe('secondary motion bake', () => {
  const spec: SecondaryInput = {
    seed: 7,
    ms: 1500,
    fps: 30,
    gravity: 1800,
    bounce: 0.5,
    colliders: [{ x: 0, y: 300, w: 1080, h: 40 }],
    bodies: [
      { id: 'a', x: -200, y: -600, w: 80, h: 80 },
      { id: 'b', x: 200, y: -700, w: 60, h: 120 },
    ],
  };
  test('replays the same from the same seed and lands on the collider', async () => {
    const a = await bakeSecondary(spec);
    expect(await bakeSecondary(spec)).toEqual(a);
    expect(a.a!.y).toHaveLength(45);
    expect(a.a!.y![0]!.v).toBe(-600);
    expect(a.a!.y!.at(-1)!.v).toBeLessThan(300);
    expect(Math.max(...a.a!.y!.map((k) => k.v))).toBeLessThanOrEqual(241);
    expect(Math.max(...a.a!.y!.map((k) => k.v))).toBeGreaterThan(200);
    expect(await bakeSecondary({ ...spec, seed: 8 })).not.toEqual(a);
  });
});
