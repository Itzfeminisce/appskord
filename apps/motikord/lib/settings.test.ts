import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearKey, DEFAULT_SETTINGS, getKey, getSettings, mergeSettings, onSettingsChanged, setKey, updateSettings } from './settings';

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('has the v1 defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      ai: 'cloud',
      keySource: null,
      provider: 'groq',
      models: {},
      defaultAspect: '9:16',
      defaultExport: { kind: 'mp4', quality: '1080p' },
      smoothPreview: true,
      media: { on: {}, custom: [], allLicences: false },
      onboarded: false,
      voiceOn: true,
      voiceLang: '',
    });
  });

  it('migrates settings from before voice prompts to mic on, Chrome language', () => {
    expect(mergeSettings({ onboarded: true } as never)).toMatchObject({ voiceOn: true, voiceLang: '' });
    expect(mergeSettings({ voiceOn: false, voiceLang: 'fr-FR' })).toMatchObject({ voiceOn: false, voiceLang: 'fr-FR' });
    expect(mergeSettings({ voiceOn: 'no', voiceLang: '<x>' } as never)).toMatchObject({ voiceOn: true, voiceLang: '' });
  });

  it('gives settings from before providers Groq and no model pick', () => {
    const s = mergeSettings({ ai: 'cloud', keySource: 'paste', onboarded: true } as never);
    expect(s).toMatchObject({ provider: 'groq', models: {}, keySource: 'paste', onboarded: true });
    expect(mergeSettings({ provider: 'mistral', models: { openai: 'gpt-4.1', x: 'y', groq: '' } } as never)).toMatchObject({ provider: 'groq', models: { openai: 'gpt-4.1' } });
  });

  it('keeps one model per provider', async () => {
    await updateSettings({ provider: 'anthropic', models: { anthropic: 'claude-x' } });
    const s = await updateSettings({ models: { openai: 'gpt-4.1' } });
    expect(s.provider).toBe('anthropic');
    expect(s.models).toEqual({ anthropic: 'claude-x', openai: 'gpt-4.1' });
  });

  it('returns defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('fills missing nested fields from the defaults', () => {
    const s = mergeSettings({ ai: 'local', media: { allLicences: true } });
    expect(s.ai).toBe('local');
    expect(s.media).toEqual({ on: {}, custom: [], allLicences: true });
    expect(s.defaultExport).toEqual(DEFAULT_SETTINGS.defaultExport);
  });

  it('moves the old libraries into Media sources', () => {
    const s = mergeSettings({ libraries: { openverse: false, pexels: true, allLicences: true } });
    expect(s.media).toEqual({ on: { openverse: false, pexels: true }, custom: [], allLicences: true });
    expect('libraries' in s).toBe(false);
    // Once media is saved, it wins over anything old.
    expect(mergeSettings({ libraries: { openverse: false }, media: { on: { openverse: true } } }).media.on.openverse).toBe(true);
  });

  it('merges media.on per source and keeps custom sources', async () => {
    const src = { id: 'c1', name: 'Bakery', url: 'https://photos.example.com/wp-json/wp/v2/media?search={query}', kinds: ['image' as const], format: 'wordpress' as const, on: true };
    await updateSettings({ media: { on: { museums: true }, custom: [src] } });
    const s = await updateSettings({ media: { on: { ccmixter: true } } });
    expect(s.media.on).toEqual({ museums: true, ccmixter: true });
    expect(s.media.custom).toEqual([src]);
  });

  it('updates one level deep and tells listeners', async () => {
    const seen = vi.fn();
    const stop = onSettingsChanged(seen);
    const next = await updateSettings({ onboarded: true, defaultExport: { kind: 'gif' } });
    expect(next.defaultExport).toEqual({ kind: 'gif', quality: '1080p' });
    expect(await getSettings()).toEqual(next);
    expect(seen).toHaveBeenCalledWith(next);
    stop();
  });

  it('keeps keys in session storage only', async () => {
    await setKey('groq', 'gsk_test');
    expect(await getKey('groq')).toBe('gsk_test');
    expect(await browser.storage.local.get(null)).toEqual({});
    await clearKey('groq');
    expect(await getKey('groq')).toBeUndefined();
  });
});
