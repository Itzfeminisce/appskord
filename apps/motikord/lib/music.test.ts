import { describe, expect, it, vi } from 'vitest';
import { applyPatch } from './patch';
import { BUNDLED_TRACKS, bundledAsset, chooseMusicEdit, clock, ensureBundledAsset, fadeLabel, FADE_CHOICES, musicSettingEdit } from './music';
import type { Recipe } from './types';

const recipe = (): Recipe => ({ version: 1, id: 'c', name: 'Promo', type: 'promo', aspect: '9:16', assets: {}, scenes: [{ id: 's1', durationMs: 5000, background: '#fff', layout: 'x', layers: [] }] });
const [first, second] = BUNDLED_TRACKS.map(bundledAsset) as [ReturnType<typeof bundledAsset>, ReturnType<typeof bundledAsset>];

describe('music', () => {
  it('bundled tracks are CC0 with a bundled credit', () => {
    expect(first.credit).toMatchObject({ source: 'bundled', licence: 'cc0' });
  });
  it('choosing a track writes Recipe.music; switching drops the old asset; No music removes it', () => {
    let r = applyPatch(recipe(), chooseMusicEdit(recipe(), first)!.ops).doc;
    expect(r.music).toEqual({ assetId: first.id, volume: 0.7, fadeInMs: 500, fadeOutMs: 1000 });
    r = applyPatch(r, musicSettingEdit(r, 'volume', 0.4)!.ops).doc;
    r = applyPatch(r, chooseMusicEdit(r, second)!.ops).doc;
    expect(r.music).toMatchObject({ assetId: second.id, volume: 0.4 });
    expect(Object.keys(r.assets)).toEqual([second.id]);
    r = applyPatch(r, chooseMusicEdit(r, null)!.ops).doc;
    expect(r.music).toBeUndefined();
    expect(r.assets).toEqual({});
  });
  it('fade and volume edits need a track', () => {
    expect(musicSettingEdit(recipe(), 'fadeInMs', 1000)).toBeUndefined();
  });
  it('uses the frame names, duration lines and fade labels', () => {
    expect(BUNDLED_TRACKS.map((t) => `${t.name}|${t.mood} · ${clock(t.durationMs)} · CC0`)).toEqual([
      'Sunny morning|Upbeat · 0:32 · CC0', 'Slow light|Calm · 0:33 · CC0', 'Big reveal|Bold · 0:34 · CC0', 'Paper clouds|Playful · 0:33 · CC0',
    ]);
    expect(FADE_CHOICES.map(fadeLabel)).toEqual(['Off', '0.5 s', '1 s', '2 s']);
  });
  it('records real bytes whether the file is new or already kept', async () => {
    const put = vi.fn(async () => undefined);
    const fetchTrack = vi.fn(async () => new Blob([new Uint8Array(30)]));
    const kept = await ensureBundledAsset(BUNDLED_TRACKS[0]!, { get: async () => ({ size: 1234 }), fetchTrack, put });
    expect(kept.bytes).toBe(1234);
    expect(fetchTrack).not.toHaveBeenCalled();
    const fresh = await ensureBundledAsset(BUNDLED_TRACKS[0]!, { get: async () => undefined, fetchTrack, put });
    expect(fresh.bytes).toBe(30);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
