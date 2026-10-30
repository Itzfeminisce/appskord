import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearKey, DEFAULT_SETTINGS, getKey, getSettings, mergeSettings, onSettingsChanged, setKey, updateSettings } from './settings';

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('has the v1 defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      ai: 'cloud',
      keySource: null,
      defaultAspect: '9:16',
      defaultExport: { kind: 'mp4', quality: '1080p' },
      smoothPreview: true,
      libraries: { openverse: true, pexels: true, allLicences: false },
      onboarded: false,
    });
  });

  it('returns defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('fills missing nested fields from the defaults', () => {
    const s = mergeSettings({ ai: 'local', libraries: { pexels: false } });
    expect(s.ai).toBe('local');
    expect(s.libraries).toEqual({ openverse: true, pexels: false, allLicences: false });
    expect(s.defaultExport).toEqual(DEFAULT_SETTINGS.defaultExport);
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
