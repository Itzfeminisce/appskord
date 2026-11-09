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
    await deleteLook('a');
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
    await deleteLook('warm');
    const stored: Clip[] = [];
    const back = await importClip(clipFileText(file), { putLook, putClip: async (c) => void stored.push(c) });
    expect(back).toEqual(clip);
    expect(stored).toEqual([clip]);
    expect(await getLook('warm')).toEqual(look);
    expect(() => readClipFile('{"app":"other"}')).toThrow('It is not a Motikord clip.');
  });
});
