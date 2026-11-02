import { describe, expect, it } from 'vitest';
import { validateRecipe } from '../recipe/validate';
import { MediaCache } from '../render/cache';
import { drawFrame, type Ctx } from '../render/drawFrame';
import type { Aspect, BrandKit, Recipe, Scene, SceneTemplate, SlotValue, TextLayer } from '../types';
import { cutWords, expandScene } from './expand';
import { getPack, insideSafeArea, isBackgroundBox, SCENE_TEMPLATES, STYLE_PACKS } from './scenes';

const ASPECTS: Aspect[] = ['9:16', '1:1', '16:9'];
const words = (n: number, w = 'loaf') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

/** Every slot filled to its limits (most items, longest text). */
function fullSlots(t: SceneTemplate): Record<string, SlotValue> {
  const out: Record<string, SlotValue> = {};
  for (const d of t.slots) {
    const n = d.items?.[1] ?? 1;
    if (d.kind === 'text') out[d.id] = d.id === 'highlight' ? 'word2' : d.scale === 'number' ? '1,200' : words(d.words ?? 3, 'word');
    else if (d.kind === 'items') out[d.id] = Array.from({ length: n }, () => words(d.words ?? 3));
    else if (d.kind === 'chart') out[d.id] = Array.from({ length: n }, (_, i) => ({ label: words(d.words ?? 1, 'm'), value: i + 1 }));
    else out[d.id] = { assetId: d.kind === 'logo' ? 'logo' : 'photo' };
  }
  return out;
}
const scene = (t: SceneTemplate, slots = fullSlots(t), id = 's1'): Scene =>
  ({ id, durationMs: t.defaultMs, background: '#FFFFFF', layout: 'center', layers: [], template: t.id, slots });
const recipe = (scenes: Scene[]): Recipe => ({
  version: 2, id: 'r', name: 'Rise', type: 'promo', aspect: '9:16', scenes, style: 'clean',
  assets: {
    photo: { id: 'photo', kind: 'image', name: 'Loaf', mime: 'image/jpeg', bytes: 10, opfsPath: 'media/photo.jpg' },
    logo: { id: 'logo', kind: 'logo', name: 'logo.png', mime: 'image/png', bytes: 10, opfsPath: 'media/logo.png' },
  },
});
function fakeCtx(): Ctx {
  const target: Record<string, unknown> = { canvas: { width: 1080, height: 1920 }, measureText: (s: string) => ({ width: s.length * 20 }) };
  return new Proxy(target, { get: (t, k) => (k in t ? t[k as string] : () => {}), set: () => true }) as unknown as Ctx;
}

describe('expandScene', () => {
  for (const t of SCENE_TEMPLATES) {
    it(`${t.name} expands in every pack at all 3 sizes inside the safe area`, () => {
      for (const pack of STYLE_PACKS) {
        const s = expandScene(scene(t), pack);
        expect(s.layers.length).toBeGreaterThanOrEqual(t.slots.filter((d) => d.id !== 'highlight').length);
        expect(validateRecipe(recipe([s]))).toEqual([]);
        for (const l of s.layers) {
          expect(l.id).toContain(`slot:${l.slot}`);
          for (const a of ASPECTS) {
            const b = l.boxes![a]!;
            if (isBackgroundBox(b)) continue;
            expect(insideSafeArea(b, a), `${pack.id} ${l.id} at ${a}: ${JSON.stringify(b)}`).toBe(true);
          }
        }
        for (const a of ASPECTS) expect(() => drawFrame(fakeCtx(), recipe([s]), a, t.defaultMs / 2, new MediaCache())).not.toThrow();
      }
    });
  }

  it('cuts over-long text at a word boundary and keeps the full text', () => {
    const t = SCENE_TEMPLATES.find((x) => x.id === 'title-hook')!;
    const long = 'Fresh sourdough, baked here at 5am every single day';
    const s = expandScene(scene(t, { kicker: 'New', headline: long }), getPack('clean')!);
    expect(s.slots!.headline).toBe('Fresh sourdough, baked here at 5am');
    expect(s.original).toEqual({ headline: long });
    expect((s.layers.find((l) => l.slot === 'headline') as TextLayer).text).toBe('Fresh sourdough, baked here at 5am');
    // Expanding again (a style change) keeps the original.
    expect(expandScene(s, getPack('bold')!).original).toEqual({ headline: long });
    expect(cutWords('one two, three', 2)).toBe('one two');
    const list = SCENE_TEMPLATES.find((x) => x.id === 'list')!;
    const l = expandScene(scene(list, { title: 'Our loaves', items: ['a', 'b', 'c', 'd', 'e', 'f'] }), getPack('clean')!);
    expect(l.slots!.items).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('sets the look from the pack: fonts by role, numbers in Space Grotesk, highlight in accent, stagger, background', () => {
    const stat = SCENE_TEMPLATES.find((x) => x.id === 'stat-reveal')!;
    const s = expandScene(scene(stat), getPack('corporate')!);
    const text = (id: string) => s.layers.find((l) => l.slot === id) as TextLayer;
    expect(text('number').font).toBe('Space Grotesk');
    expect(text('label').font).toBe('Source Serif 4');
    expect(text('source').font).toBe('IBM Plex Sans');
    expect(s.bg).toEqual(getPack('corporate')!.background);
    expect(s.background).toBe('#0F2A4A');
    const big = SCENE_TEMPLATES.find((x) => x.id === 'big-statement')!;
    const b = expandScene(scene(big, { statement: 'Real bread takes 36 hours. We never rush it.', highlight: 'never' }), getPack('bold')!);
    const st = b.layers[0] as TextLayer;
    expect(b.layers).toHaveLength(1);
    expect(st.highlight).toEqual({ word: 6, colour: '#FACC15' });
    expect(st.stagger).toBe('line');
    expect(st.in).toEqual({ preset: 'rise-in', feel: 'snappy', durationMs: 250 });
  });

  it('lets the brand kit replace colours, fonts and logo', () => {
    const end = SCENE_TEMPLATES.find((x) => x.id === 'end-card')!;
    const brand: BrandKit = { logoAssetId: 'logo', headingFont: 'Brand Sans', useForNewClips: true,
      colours: [{ hex: '#BE185D', role: 'primary' }, { hex: '#111114', role: 'text' }, { hex: '#FDF2F8', role: 'background' }] };
    const s = expandScene(scene(end, { cta: 'Order today', handle: 'rise.bakery' }), getPack('clean')!, brand);
    const cta = s.layers.find((l) => l.slot === 'cta') as TextLayer;
    expect([cta.font, cta.colour, s.background]).toEqual(['Brand Sans', '#111114', '#FDF2F8']);
    expect(s.bg!.colours).toEqual(['#FDF2F8', '#FDF2F8']);
    expect(s.layers.find((l) => l.slot === 'logo')).toMatchObject({ type: 'image', assetId: 'logo', fit: 'contain' });
    expect(validateRecipe(recipe([s]))).toEqual([]);
  });

  it('leaves a v1 scene alone', () => {
    const v1: Scene = { id: 'a', durationMs: 1000, background: '#000000', layout: 'center', layers: [] };
    expect(expandScene(v1, getPack('clean')!)).toBe(v1);
  });
});

describe('title hook kicker and sizes (FormatsV2)', () => {
  const hook = (style: string) => expandScene({ id: 's', durationMs: 3000, background: '#000000', layout: 'center', layers: [], template: 'title-hook', slots: { kicker: 'Rise Bakery', headline: 'Fresh sourdough' } }, getPack(style)!);
  const slot = (s: Scene, id: string) => s.layers.find((l): l is TextLayer => l.type === 'text' && l.slot === id)!;

  it('draws the kicker as an uppercase line at weight 600 and 0.12 em, teal in Playful', () => {
    for (const p of STYLE_PACKS) {
      const k = slot(hook(p.id), 'kicker');
      expect([k.text, k.weight, k.letterSpacing]).toEqual(['RISE BAKERY', 600, 0.12]);
    }
    expect(slot(hook('playful'), 'kicker').colour).toBe('#0F766E');
    expect(hook('bold').slots?.kicker).toBe('Rise Bakery');
  });

  it('gives Bold at 1:1 the full 0.35 side panel, and starts the headline at the top of its box', () => {
    const s = hook('bold');
    const xs = s.bg!.shapes!['1:1']!.map((p) => p[0]);
    expect(1 - Math.min(...xs)).toBeCloseTo(0.35, 3);
    expect(slot(s, 'headline').valign).toBe('top');
    expect(slot(s, 'headline').scaleAt).toEqual({ '1:1': 0.68 });
  });
});
