import { describe, expect, it } from 'vitest';
import { applyPatch } from './patch';
import { BUNDLED_TRACKS, bundledAsset, chooseMusicEdit, musicSettingEdit } from './music';
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
});
