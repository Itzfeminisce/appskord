// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { mount } from '../../test/mountRouter';
import { press } from './mountPanel';
import { compareVersions, markWhatsNewSeen, recordInstall, sameMinor, shouldShowWhatsNew } from './whatsNew';

describe('WhatsNewV3', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ version: '3.0.0' } as never);
  });

  it('shows the frame copy', async () => {
    const { host } = await mount(sidepanel, 'WhatsNewV3');
    for (const text of [
      'What’s new', 'MOTIKORD 3', 'What’s new in Motikord 3', 'Clips that move like they were made today. Still free, still on this computer.',
      'Check the key frames', 'Approve one still per scene before any motion is added. No AI cost.',
      'Look guide', 'Palette, type, motion feel, light and texture, kept in every scene. Your brand kit still wins.',
      'Motion that feels made', 'Springs, kinetic type, camera moves and depth. Each part lands just after the last.',
      'Effects, animations and 3D', 'Glass, glow, depth of field, ready-made animations, particles and 3D text.',
      'Captions and voice', 'Off by default', 'Auto captions and AI voiceover with your own Groq or OpenAI key.',
      'Your v2 clips keep their look. Open one and choose “Restyle with v3 motion”.', 'Make a clip',
    ]) expect(host.textContent, text).toContain(text);
  });

  it('marks the version seen and Make a clip goes home', async () => {
    const view = await mount(sidepanel, 'WhatsNewV3');
    expect((await browser.storage.local.get('motikordWhatsNewSeen')).motikordWhatsNewSeen).toBe('3.0.0');
    await press(view.host, 'Make a clip');
    expect(view.router.route.screen).toBe('HomeV3');
  });

  it('shows once after an update, never after a fresh install or a patch bump', async () => {
    expect(await shouldShowWhatsNew('3.0.0', false)).toBe(false); // new install: recorded, nothing to announce
    expect(await shouldShowWhatsNew('3.0.0', true)).toBe(false);
    expect(await shouldShowWhatsNew('3.0.1', true)).toBe(false); // patch bump: a fix, skipped
    expect(await shouldShowWhatsNew('3.1.0', true)).toBe(true);
    await markWhatsNewSeen('3.1.0');
    expect(await shouldShowWhatsNew('3.1.0', true)).toBe(false);
    fakeBrowser.reset();
    expect(await shouldShowWhatsNew('3.0.0', true)).toBe(true); // a v2 install with no record
    expect(compareVersions('3.0.0', '2.0.1')).toBe(1);
    expect(sameMinor('3.0.0', '3.0.4')).toBe(true);
    expect(sameMinor('3.0.0', '2.0.4')).toBe(false);
  });

  it('runtime.onInstalled: an update to v3 shows What’s new once; an install or a patch update does not', async () => {
    await recordInstall({ reason: 'install' }, '2.0.1');
    expect(await shouldShowWhatsNew('2.0.1', true)).toBe(false);
    await recordInstall({ reason: 'update', previousVersion: '2.0.1' }, '2.0.2');
    expect(await shouldShowWhatsNew('2.0.2', true)).toBe(false);
    await recordInstall({ reason: 'update', previousVersion: '2.0.2' }, '3.0.0');
    expect(await shouldShowWhatsNew('3.0.0', true)).toBe(true);
    await markWhatsNewSeen('3.0.0');
    expect(await shouldShowWhatsNew('3.0.0', true)).toBe(false);
    await recordInstall({ reason: 'chrome_update' }, '3.0.0');
    expect(await shouldShowWhatsNew('3.0.0', true)).toBe(false);
  });
});
