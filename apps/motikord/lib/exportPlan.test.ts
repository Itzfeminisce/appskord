import { describe, expect, it } from 'vitest';
import { about, creditsBox, endCardScene, estimateLine, exportButton, exportRecipe, formatBytes, frameClock, frameSize, planExport, secondsLeft, timeLeft } from './exportPlan';
import { bundledAsset, BUNDLED_TRACKS } from './music';
import type { Asset, Recipe } from './types';

const ccby: Asset = { id: 'a', kind: 'image', name: 'Loaf', mime: 'image/jpeg', bytes: 1, opfsPath: 'media/a.jpg', credit: { title: 'Loaf on a wooden board', author: 'Ada', source: 'openverse', url: 'https://x.test/a', licence: 'cc-by' } };
const sunny = bundledAsset(BUNDLED_TRACKS[0]!);
const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  version: 1, id: 'r', name: 'Sourdough promo', type: 'promo', aspect: '9:16', assets: {},
  scenes: [{ id: 's', durationMs: 15000, background: '#fff', layout: 'center', layers: [] }], ...over,
});

describe('export plan', () => {
  it('plans sizes inside kinds at 30 fps, 1080p on the short side', () => {
    const items = planExport(recipe(), { kinds: ['mp4'], aspects: ['9:16', '16:9'], quality: '1080p' });
    expect(items.map((i) => [i.file, i.width, i.height, i.frames, i.label])).toEqual([
      ['sourdough-promo-9x16.mp4', 1080, 1920, 450, '9:16 · MP4 · 1080p'],
      ['sourdough-promo-16x9.mp4', 1920, 1080, 450, '16:9 · MP4 · 1080p'],
    ]);
    expect(items[0]!.audio).toBe(false);
  });
  it('keeps GIFs small at 15 fps with no sound, and see-through keeps alpha', () => {
    const r = recipe({ assets: { [sunny.id]: sunny }, music: { assetId: sunny.id, volume: 1, fadeInMs: 0, fadeOutMs: 0 } });
    const [gif] = planExport(r, { kinds: ['gif'], aspects: ['9:16'], quality: '1080p' });
    expect([gif!.width, gif!.height, gif!.fps, gif!.frames, gif!.audio]).toEqual([270, 480, 15, 225, false]);
    expect(frameSize('1:1', 'gif', '720p')).toEqual({ w: 480, h: 480 });
    const [alpha] = planExport(r, { kinds: ['webm-alpha'], aspects: ['1:1'], quality: '720p' });
    expect([alpha!.seeThrough, alpha!.audio, alpha!.width]).toEqual([true, true, 720]);
  });
  it('adds the 2 s credits end card only at export time', () => {
    const r = recipe({ assets: { a: ccby }, creditsEndCard: true, scenes: [{ id: 's', durationMs: 3000, background: '#fff', layout: 'center', layers: [{ id: 'l', name: 'l', type: 'image', assetId: 'a', fit: 'cover', startMs: 0, endMs: 3000, opacity: 1, box: { x: 0, y: 0, w: 1, h: 1 } }] }] });
    const drawn = exportRecipe(r);
    expect(drawn.scenes).toHaveLength(2);
    expect(r.scenes).toHaveLength(1);
    const card = endCardScene(r)!;
    expect(card.durationMs).toBe(2000);
    expect(card.layers.map((l) => (l.type === 'text' ? l.text : ''))).toEqual(['Credits', 'Photo: “Loaf on a wooden board” by Ada, CC BY']);
    expect(planExport(r, { kinds: ['mp4'], aspects: ['9:16'], quality: '720p' })[0]!.frames).toBe(150);
  });
  it('locks the credits box for CC BY media', () => {
    expect(creditsBox(recipe({ assets: { a: ccby }, scenes: [{ id: 's', durationMs: 1000, background: '#fff', layout: 'center', layers: [{ id: 'l', name: 'l', type: 'image', assetId: 'a', fit: 'cover', startMs: 0, endMs: 1000, opacity: 1, box: { x: 0, y: 0, w: 1, h: 1 } }] }] }), false)).toEqual({ locked: true, on: true });
    expect(creditsBox(recipe(), true)).toEqual({ locked: false, on: true });
    expect(creditsBox(recipe())).toEqual({ locked: false, on: false });
  });
  it('estimates from the T0 budget and words it like the frame', () => {
    const items = planExport(recipe(), { kinds: ['mp4'], aspects: ['9:16'], quality: '1080p' });
    expect(estimateLine(items)).toBe('About 30 seconds on this computer. Nothing is uploaded.');
    expect(exportButton(1)).toBe('Export 1 video');
    expect(exportButton(3)).toBe('Export 3 videos');
    expect(about(16)).toBe('About 20 seconds');
    expect(about(7.2)).toBe('About 8 seconds');
    expect(about(130)).toBe('About 3 minutes');
    expect(Math.round(secondsLeft(10000, 200, 450, []))).toBe(13);
  });
  it('words time left like the time-left state', () => {
    expect(timeLeft(13)).toBe('Less than a minute left');
    expect(timeLeft(75)).toBe('About 1 minute left');
    expect(timeLeft(130)).toBe('About 2 minutes left');
  });
  it('formats sizes and clocks', () => {
    expect(formatBytes(4.2 * 1024 * 1024)).toBe('4.2 MB');
    expect(formatBytes(300)).toBe('1 KB');
    expect(frameClock(6900)).toBe('0:06.9');
  });
});
