import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateLookGuide } from '@appskord/motion/recipe';
import type { BrandKit, Clip } from '../types';
import { restyle } from '../restyle/restyle';
import { brandLook } from './brand';
import { clipFileText, exportClip, importClip, readClipFile } from './bundle';
import { V3_FONTS } from './fonts';
import { getPackV3, PACKS_V3, packFinish, packLook } from './packs';
import { closeLookDB, deleteLook, getLook, listLooks, LOOK_DB_NAME, putLook, type SavedLook } from './store';

const PUBLIC = join(__dirname, '../../public');
const guide = (id: string, updatedAt: number): SavedLook => ({
  guide: { ...packLook(getPackV3('studio')), id, name: 'Fieldnote brand' },
  packId: 'studio',
  updatedAt,
});

describe('packs and fonts', () => {
  it('has the 8 packs in frame order with fonts from the 13 bundled OFL fonts', () => {
    expect(PACKS_V3.map((p) => p.name)).toEqual([
      'Clean',
      'Bold',
      'Playful',
      'Corporate',
      'Studio',
      'Kinetic',
      'Gloss',
      'Soft',
    ]);
    expect(V3_FONTS.map((f) => f.family).join(' · ')).toBe(
      'Inter · Archivo Black · Archivo · Fredoka · Nunito · Source Serif 4 · IBM Plex Sans · Geist · Geist Mono · Bricolage Grotesque · Outfit · Fraunces · Space Grotesk',
    );
    const families = new Set(V3_FONTS.map((f) => f.family));
    for (const p of PACKS_V3) {
      expect(families.has(p.fonts.display.family), p.name).toBe(true);
      expect(families.has(p.fonts.text.family), p.name).toBe(true);
      expect(validateLookGuide(packLook(p)).ok, p.name).toBe(true);
    }
    expect(packFinish(getPackV3('bold'))).toEqual({ on: true, blur: 1, light: 0, grain: 0.25, grade: 0.5 });
  });

  it('ships every font file with its OFL licence', () => {
    for (const f of V3_FONTS) {
      expect(existsSync(join(PUBLIC, f.file)), f.file).toBe(true);
      expect(readFileSync(join(PUBLIC, f.licenceFile), 'utf8'), f.family).toContain('SIL Open Font License');
    }
    const axes = (family: string) => V3_FONTS.find((f) => f.family === family)!.axes.map((a) => a.tag);
    expect(axes('Bricolage Grotesque')).toEqual(['wght', 'wdth']);
    expect(axes('Archivo')).toEqual(['wght', 'wdth']);
    expect(axes('Fraunces')).toContain('SOFT');
  });
});

describe('brand kit wins', () => {
  it('replaces colours by role, fonts and logo; keeps feel, light and camera', () => {
    const kit: BrandKit = {
      colours: [
        { hex: '#101820', role: 'background' },
        { hex: '#FEE715', role: 'primary' },
      ],
      headingFont: 'Outfit',
      logoAssetId: 'brand-logo-png',
      useForNewClips: true,
    };
    const base = packLook(getPackV3('studio'));
    const { guide: g, logoAssetId } = brandLook(base, kit);
    expect(g.palette).toEqual(['#101820', '#F5F5F7', '#FEE715']);
    expect(g.type).toEqual({ display: 'Outfit', text: 'Geist Mono' });
    expect([g.feel, g.light, g.camera]).toEqual([base.feel, base.light, base.camera]);
    expect(logoAssetId).toBe('brand-logo-png');
    expect(brandLook(base, undefined).guide).toBe(base);
  });
});

describe('look guide store', () => {
  afterEach(async () => {
    await closeLookDB();
    indexedDB.deleteDatabase(LOOK_DB_NAME);
  });

  it('round-trips, lists newest first, deletes and refuses a bad guide', async () => {
    await putLook(guide('a', 1));
    await putLook(guide('b', 2));
    expect(await getLook('a')).toEqual(guide('a', 1));
    expect((await listLooks()).map((l) => l.guide.id)).toEqual(['b', 'a']);
    await deleteLook('a', new Set());
    expect(await getLook('a')).toBeUndefined();
    const bad = guide('c', 3);
    bad.guide.feel = 'wobbly' as never;
    await expect(putLook(bad)).rejects.toThrow('feel: "wobbly" is not a motion feel');
  });

  it('includes the clip’s look guide in export and stores it on import', async () => {
    const v2: Clip = {
      id: 'c1',
      recipe: { version: 2, id: 'c1', name: 'Morning shift', type: 'promo', aspect: '9:16', scenes: [], assets: {} },
      history: [],
      createdAt: 1,
      updatedAt: 1,
    };
    v2.recipe.scenes = [
      { id: 's1', durationMs: 3000, background: '#000000', layout: 'center', layers: [], template: 'title-hook' },
    ];
    const look = guide('warm', 5);
    await putLook(look);
    const clip = restyle(v2, { packId: 'studio', lookGuide: look.guide, now: 9, changeId: 'ch1' });
    const file = await exportClip(clip, { getLook });
    expect(file.lookGuides).toEqual([look]);
    await expect(deleteLook('warm', new Set(['warm']))).rejects.toThrow('A clip uses it');
    await deleteLook('warm', new Set());
    const stored: Clip[] = [];
    const deps = { putLook, putClip: async (c: Clip) => void stored.push(c), hasClip: async () => false };
    const back = await importClip(clipFileText(file), deps);
    expect(back).toEqual(clip);
    expect(stored).toEqual([clip]);
    expect(await getLook('warm')).toEqual(look);
    expect(() => readClipFile('{"app":"other"}')).toThrow('It is not a Motikord clip.');
  });

  it('carries the voice track’s audio and the Auto captions style through export and import', async () => {
    const v2: Clip = {
      id: 'c9',
      recipe: {
        version: 2, id: 'c9', name: 'Say it', type: 'promo', aspect: '9:16', assets: {},
        scenes: [{ id: 's1', durationMs: 3000, background: '#000000', layout: 'center', layers: [], template: 'title-hook' }],
      },
      history: [], createdAt: 1, updatedAt: 1,
    };
    const restyled = restyle(v2, { packId: 'studio', now: 9, changeId: 'ch9' });
    const clip = {
      ...restyled, autoCaptions: 'pop',
      recipe: { ...restyled.recipe, voice: { assetId: 'voice-1', volume: 1, source: 'narration' as const }, assets: { 'voice-1': { id: 'voice-1', kind: 'audio' as const, name: 'take.mp3', mime: 'audio/mpeg', bytes: 3, opfsPath: 'media/voice-1.mp3' } } },
    } as Clip;
    const file = await exportClip(clip, { getLook, readMedia: async (p) => (p === 'media/voice-1.mp3' ? new Blob([new Uint8Array([7, 8, 9])], { type: 'audio/mpeg' }) : undefined) });
    expect(file.media?.['voice-1']?.mime).toBe('audio/mpeg');
    const put = new Map<string, Blob>();
    const back = await importClip(clipFileText(file), { putLook, putClip: async () => undefined, hasClip: async () => false, putMedia: async (p, b) => void put.set(p, b) });
    expect((back as Clip & { autoCaptions?: string }).autoCaptions).toBe('pop');
    expect(back.recipe.voice).toEqual(clip.recipe.voice);
    expect([...new Uint8Array(await put.get('media/voice-1.mp3')!.arrayBuffer())]).toEqual([7, 8, 9]);
    const odd = JSON.parse(clipFileText(file)) as { clip: { autoCaptions: string } };
    odd.clip.autoCaptions = 'shout';
    expect(() => readClipFile(JSON.stringify(odd))).toThrow('clip.autoCaptions');
  });

  it('imports voice audio only to a path made from the asset id, never the file’s own path, and drops an unreadable voice on export', async () => {
    const v2: Clip = { id: 'c9', recipe: { version: 2, id: 'c9', name: 'Say it', type: 'promo', aspect: '9:16', assets: {}, scenes: [{ id: 's1', durationMs: 3000, background: '#000000', layout: 'center', layers: [], template: 'title-hook' }] }, history: [], createdAt: 1, updatedAt: 1 };
    const restyled = restyle(v2, { packId: 'studio', now: 9, changeId: 'ch9' });
    const clip = { ...restyled, recipe: { ...restyled.recipe, voice: { assetId: 'voice-1', volume: 1, source: 'narration' as const }, assets: { 'voice-1': { id: 'voice-1', kind: 'audio' as const, name: 'take.mp3', mime: 'audio/mpeg', bytes: 3, opfsPath: 'media/voice-1.mp3' } } } } as Clip;
    const file = await exportClip(clip, { getLook, readMedia: async () => new Blob([new Uint8Array([7, 8, 9])], { type: 'audio/mpeg' }) });
    const evil = JSON.parse(clipFileText(file)) as { clip: Clip };
    evil.clip.recipe.assets['voice-1']!.opfsPath = 'media/other-clip-photo.png';
    const put = new Map<string, Blob>();
    const back = await importClip(JSON.stringify(evil), { putLook, putClip: async () => undefined, hasClip: async () => false, putMedia: async (p, b) => void put.set(p, b) });
    expect([...put.keys()]).toEqual(['media/voice-1.mp3']);
    expect(back.recipe.assets['voice-1']!.opfsPath).toBe('media/voice-1.mp3');
    const dup = await importClip(clipFileText(file), { putLook, putClip: async () => undefined, hasClip: async () => true, putMedia: async (p, b) => void put.set(p, b) });
    expect(dup.recipe.assets['voice-1']!.opfsPath).not.toBe('media/voice-1.mp3');
    const dropped = await exportClip(clip, { getLook, readMedia: async () => undefined });
    expect(dropped.clip.recipe.voice).toBeUndefined();
    expect(dropped.clip.recipe.assets['voice-1']).toBeUndefined();
    await expect(exportClip(clip, { getLook, readMedia: async () => ({ size: 16 * 1024 * 1024 }) as Blob })).rejects.toThrow('too big');
    evil.clip.recipe.assets['voice-1']!.opfsPath = 'media/voice-1.mp3';
    const badB64 = JSON.parse(clipFileText(file)) as { media: Record<string, { data: string }> };
    badB64.media['voice-1']!.data = '!!!not base64';
    expect(() => readClipFile(JSON.stringify(badB64))).toThrow('media.voice-1');
  });

  it('refuses a clip file that is too big or malformed, naming the key and fix', async () => {
    const v2: Clip = {
      id: 'c1',
      recipe: { version: 2, id: 'c1', name: 'n', type: 'promo', aspect: '9:16', scenes: [], assets: {} },
      history: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const clip = restyle(
      { ...v2, recipe: { ...v2.recipe, scenes: [{ id: 's1', durationMs: 3000, background: '#000000', layout: 'center', layers: [], template: 'title-hook' }] } },
      { packId: 'studio', now: 9, changeId: 'ch1' },
    );
    const wrap = (c: unknown, lookGuides: unknown[] = []) => JSON.stringify({ app: 'motikord', kind: 'clip', version: 3, clip: c, lookGuides });
    const mut = (f: (c: Record<string, any>) => void) => {
      const c = structuredClone(clip) as unknown as Record<string, any>;
      f(c);
      return c;
    };
    expect(() => readClipFile('x'.repeat(25 * 1024 * 1024 + 1))).toThrow('over 25 MB');
    expect(() => readClipFile(wrap(mut((c) => (c.recipe.scenes = 'no'))))).toThrow('clip.recipe.scenes');
    expect(() => readClipFile(wrap(mut((c) => (c.recipe.assets = []))))).toThrow('clip.recipe.assets');
    expect(() => readClipFile(wrap(mut((c) => (c.history = {}))))).toThrow('clip.history');
    expect(() => readClipFile(wrap(mut((c) => delete c.v2Version)))).toThrow('v3 and v2Version go together');
    expect(() => readClipFile(wrap(mut((c) => delete c.v3)))).toThrow('v3 and v2Version go together');
    expect(() => readClipFile(wrap(mut((c) => (c.v3.fps = 24))))).toThrow('fps');
    const ok = guide('g', 1);
    expect(() => readClipFile(wrap(clip, [{ ...ok, updatedAt: 'now' }]))).toThrow('lookGuides[0].updatedAt');
    expect(() => readClipFile(wrap(clip, [{ ...ok, packId: 3 }]))).toThrow('lookGuides[0].packId');
    expect(() => readClipFile(wrap(clip, [{ ...ok, guide: { ...ok.guide, feel: 'wobbly' } }]))).toThrow('feel');
    expect(() => readClipFile(wrap(clip, [7]))).toThrow('lookGuides[0]');
  });

  it('imports under a new id when the clip id already exists', async () => {
    const clip: Clip = {
      id: 'c1',
      recipe: { version: 2, id: 'c1', name: 'n', type: 'promo', aspect: '9:16', scenes: [], assets: {} },
      history: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const stored: Clip[] = [];
    const text = clipFileText(await exportClip(clip, { getLook }));
    const back = await importClip(text, { putLook, putClip: async (c) => void stored.push(c), hasClip: async (id) => id === 'c1' });
    expect(back.id).not.toBe('c1');
    expect(back.recipe.id).toBe(back.id);
    expect(stored.map((c) => c.id)).toEqual([back.id]);
  });

  it('refuses to export a clip whose saved look guide is missing', async () => {
    const v2: Clip = {
      id: 'c1',
      recipe: { version: 2, id: 'c1', name: 'n', type: 'promo', aspect: '9:16', scenes: [{ id: 's1', durationMs: 3000, background: '#000000', layout: 'center', layers: [], template: 'title-hook' }], assets: {} },
      history: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const clip = restyle(v2, { packId: 'studio', lookGuide: guide('gone', 1).guide, now: 9, changeId: 'ch1' });
    await expect(exportClip(clip, { getLook })).rejects.toThrow('look guide "gone" is missing');
    await expect(exportClip(restyle(v2, { packId: 'studio', now: 9, changeId: 'c2' }), { getLook })).resolves.toBeTruthy();
  });
});
