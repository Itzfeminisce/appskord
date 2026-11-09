import { describe, expect, it } from 'vitest';
import { getSceneTemplate } from '@appskord/scenes/templates/scenes';
import { validateClip, validateScene } from '@appskord/motion/recipe';
import { PACKS_V3, packFinish } from '../../look/packs';
import { buildScene, linkScenes, startAtZero, templateLayers } from './build';
import { TEMPLATES_V3 } from './templates';

const ORDER = [
  'title-hook',
  'big-statement',
  'stat-reveal',
  'chart',
  'quote',
  'list',
  'hero',
  'split',
  'before-after',
  'steps',
  'logo-sting',
  'end-card',
];

describe('v3 templates', () => {
  it('has the 12 templates in frame order, two per new pack and one per redrawn pack', () => {
    expect(TEMPLATES_V3.map((t) => t.id)).toEqual(ORDER);
    const per = Object.fromEntries(PACKS_V3.map((p) => [p.name, TEMPLATES_V3.filter((t) => t.packId === p.id).length]));
    expect(per).toEqual({ Studio: 2, Kinetic: 2, Gloss: 2, Soft: 2, Clean: 1, Bold: 1, Playful: 1, Corporate: 1 });
  });

  it('keeps the v2 slots and word limits, and every card has a 4-beat strip', () => {
    for (const t of TEMPLATES_V3) {
      const v2 = getSceneTemplate(t.id)!;
      expect(v2, t.id).toBeDefined();
      const slotIds = v2.slots.map((s) => s.id);
      for (const p of t.plan.filter((p) => p.slot)) expect(slotIds, `${t.id} ${p.id}`).toContain(p.id);
      for (const [label, limit] of t.slotLabels) {
        const n = /^(\d+) words?/.exec(limit)?.[1];
        if (!n) continue;
        const words = v2.slots.filter((s) => s.words === Number(n));
        expect(words.length, `${t.id} ${label} ${limit}`).toBeGreaterThan(0);
      }
      expect(t.beats, t.id).toHaveLength(4);
      for (const id of Object.keys(t.sample)) expect(slotIds, `${t.id} sample ${id}`).toContain(id);
    }
  });

  it('renders every template in every pack through validateScene', () => {
    for (const t of TEMPLATES_V3)
      for (const pack of PACKS_V3) {
        const scene = buildScene(t, pack, { id: `${t.id}-${pack.id}` });
        const r = validateScene(scene);
        expect(r.ok ? [] : r.errors, `${t.id} in ${pack.name}`).toEqual([]);
        expect(scene.layers.length).toBeGreaterThan(0);
      }
  });

  it('uses the frame camera in its own pack and the pack habit elsewhere', () => {
    const hook = TEMPLATES_V3[0]!;
    const studio = PACKS_V3.find((p) => p.id === 'studio')!;
    const bold = PACKS_V3.find((p) => p.id === 'bold')!;
    expect(buildScene(hook, studio, { id: 's' }).camera).toEqual({ move: 'push-in', amount: 0.04, focus: 'headline' });
    expect(buildScene(hook, bold, { id: 's' }).camera).toEqual({ move: 'pan', amount: 0.5 });
  });

  it('is deterministic and links carries only into a scene that has them', () => {
    const studio = PACKS_V3.find((p) => p.id === 'studio')!;
    const [hook, , , , quote] = TEMPLATES_V3;
    const a = buildScene(hook!, studio, { id: 'a', layers: templateLayers(hook!) });
    expect(buildScene(hook!, studio, { id: 'a', layers: templateLayers(hook!) })).toEqual(a);
    const scenes = linkScenes([a, buildScene(quote!, studio, { id: 'b' }), buildScene(hook!, studio, { id: 'c' })]);
    expect(scenes[0]!.transition).toEqual({ kind: 'crossfade' });
    const clip = { version: 3, scenes, lookGuideId: 'pack-studio', packId: 'studio', fps: 30, finish: packFinish(studio) };
    expect(validateClip(clip).ok).toBe(true);
  });

  it('uses the real count, extrude and soft fields', () => {
    const layers = TEMPLATES_V3.flatMap((t) => buildScene(t, PACKS_V3.find((p) => p.id === t.packId)!, { id: t.id }).layers);
    // The stat's count runs on its number's own text layer: no layer of its own, no sample value.
    expect(layers.some((l) => l.id === 'count')).toBe(false);
    const number = layers.find((l) => l.slotId === 'number')!;
    expect(number.count).toEqual({ from: 0 });
    expect(number.tracks.draw!.map((k) => [k.t, k.v])).toEqual([[100, 0], [1000, 1]]);
    expect(layers.some((l) => l.tracks.extrude?.at(-1)?.v === 18 && l.tracks.extrude[0]!.v === 0)).toBe(true);
    expect(layers.find((l) => l.id === 'quote')!.tracks.soft!.map((k) => k.v)).toEqual([0, 100]);
  });
});

describe('startAtZero', () => {
  it('drops the keys before t=0 and starts with one key where the track was at t=0', () => {
    const track = [
      { t: -400, v: 0 },
      { t: -100, v: 0.3 },
      { t: 200, v: 0.6, curve: { kind: 'bezier' as const, p: [0, 0, 1, 1] as [number, number, number, number] } },
      { t: 500, v: 1 },
    ];
    const out = startAtZero(track);
    expect(out.map((k) => k.t)).toEqual([0, 200, 500]);
    expect(out[0]!.v).toBeCloseTo(0.4, 6);
    expect(out.filter((k) => k.t === 0)).toHaveLength(1);
  });

  it('leaves a track that starts at or after t=0 as it is', () => {
    const track = [
      { t: 0, v: 0 },
      { t: 300, v: 1 },
    ];
    expect(startAtZero(track)).toBe(track);
  });
});
