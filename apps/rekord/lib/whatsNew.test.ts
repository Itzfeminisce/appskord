import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getSettings, updateSettings } from './settings';
import pkg from '../package.json';
import { compareVersions, handleInstalled, isNewerThanSeen, markWhatsNewSeen, shouldShowWhatsNew } from './whatsNew';

describe('versions', () => {
  it('compares numerically', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
  });
  it('treats no seen version as newer', () => {
    expect(isNewerThanSeen('0.1.0', undefined)).toBe(true);
    expect(isNewerThanSeen('0.1.0', '0.1.0')).toBe(false);
  });
});

describe('what’s new, shown once', () => {
  beforeEach(() => fakeBrowser.reset());

  it('does not show after a fresh install', async () => {
    await handleInstalled('install', '3.0.0');
    expect((await getSettings()).lastSeenVersion).toBe('3.0.0');
    expect(await shouldShowWhatsNew('3.0.0')).toBe(false);
  });

  it('shows once after an update, then never for that version', async () => {
    await updateSettings({ onboarded: true, lastSeenVersion: '2.0.0' });
    await handleInstalled('update', '3.0.0');
    expect(await shouldShowWhatsNew('3.0.0')).toBe(true);
    await markWhatsNewSeen('3.0.0');
    expect(await shouldShowWhatsNew('3.0.0')).toBe(false);
    expect((await getSettings()).lastSeenVersion).toBe('3.0.0');
  });

  it('shows after an update from a version that never recorded one', async () => {
    await updateSettings({ onboarded: true });
    await handleInstalled('update', '3.0.0');
    expect(await shouldShowWhatsNew('3.0.0')).toBe(true);
  });

  it('does not show when the version was already seen', async () => {
    await updateSettings({ onboarded: true, lastSeenVersion: '3.0.0' });
    await handleInstalled('update', '3.0.0');
    expect(await shouldShowWhatsNew('3.0.0')).toBe(false);
  });

  it('waits for onboarding to finish', async () => {
    await handleInstalled('update', '3.0.0');
    expect(await shouldShowWhatsNew('3.0.0')).toBe(false);
  });

  it('marks What’s new pending on the in-place update from 0.1.0 to this version', async () => {
    expect(pkg.version).toBe('0.4.1');
    await updateSettings({ onboarded: true, lastSeenVersion: '0.1.0' });
    await handleInstalled('update', pkg.version);
    expect((await browser.storage.local.get('whatsNewPending')).whatsNewPending).toBe(true);
    expect(await shouldShowWhatsNew(pkg.version)).toBe(true);
  });

  it('does not show for a patch-only update, and records the version as seen', async () => {
    await updateSettings({ onboarded: true, lastSeenVersion: '0.4.0' });
    await handleInstalled('update', '0.4.1');
    expect((await getSettings()).lastSeenVersion).toBe('0.4.1');
    expect(await shouldShowWhatsNew('0.4.1')).toBe(false);
  });

  it('shows for an update from an earlier minor to 0.4.1', async () => {
    await updateSettings({ onboarded: true, lastSeenVersion: '0.3.2' });
    await handleInstalled('update', '0.4.1');
    expect(await shouldShowWhatsNew('0.4.1')).toBe(true);
  });
});
