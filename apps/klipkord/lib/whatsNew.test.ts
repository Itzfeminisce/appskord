import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getSettings, updateSettings } from './settings';
import { handleInstalled, markWhatsNewSeen, showWhatsNew } from './whatsNew';

const shows = async () => showWhatsNew(await getSettings());

describe('whatsNew', () => {
  beforeEach(() => fakeBrowser.reset());

  it('shows once after an update from 3.0.0', async () => {
    await handleInstalled('update', '3.0.0');
    expect(await shows()).toBe(true);
    await markWhatsNewSeen();
    expect(await shows()).toBe(false);
  });

  it('keeps the v3 download for people on local, not for others', async () => {
    await handleInstalled('update', '3.0.0');
    expect((await getSettings()).localModelAsked).toBe(true);
    fakeBrowser.reset();
    await updateSettings({ transcripts: { provider: 'groq', model: 'whisper-large-v3-turbo' } });
    await handleInstalled('update', '3.0.0');
    expect((await getSettings()).localModelAsked).toBeFalsy();
  });

  it('never shows on a new install', async () => {
    await handleInstalled('install', undefined);
    expect(await shows()).toBe(false);
  });

  it('does not show again on 3.1.0 -> 3.1.1', async () => {
    await handleInstalled('update', '3.0.0');
    await markWhatsNewSeen();
    await handleInstalled('update', '3.1.0');
    expect(await shows()).toBe(false);
  });

  it('does not show on a patch update that never had it due', async () => {
    await handleInstalled('update', '3.1.0');
    expect(await shows()).toBe(false);
  });
});
