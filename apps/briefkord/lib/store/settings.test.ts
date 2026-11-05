import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, loadSettings, readSettings, saveSettings } from './settings';

beforeEach(() => fakeBrowser.reset());

describe('settings', () => {
  it('starts from the defaults: no notes, page text included', async () => {
    expect(await loadSettings()).toEqual({ sharingName: '', includeNotes: false, includePageText: true });
  });

  it('saves a change and keeps the rest', async () => {
    await saveSettings({ sharingName: 'Ada', lastBoardId: 'b1', ai: { provider: 'groq', model: 'some-model' } });
    await saveSettings({ includeNotes: true, lastBoardId: undefined });
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, sharingName: 'Ada', includeNotes: true, ai: { provider: 'groq', model: 'some-model' } });
  });

  it('falls back to the default for a field of the wrong type', () => {
    expect(readSettings({ sharingName: 3, includeNotes: 'yes', ai: { provider: 'groq' }, apiKey: 'sk-test' })).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});
