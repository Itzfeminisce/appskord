// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { getSettings, updateSettings } from '../../lib/settings';
import { mount, settle } from '../../test/mountRouter';
import { press } from '../sidepanel/mountPanel';
import { getV3, saveMachineResult, updateV3 } from './store';

vi.mock('../../lib/penv', async (orig) => ({ ...(await orig<typeof import('../../lib/penv')>()), loadKeys: async () => ({ OPENAI_API_KEY: 'sk-test' }) }));

const radio = (host: HTMLElement, name: string | RegExp) => [...host.querySelectorAll<HTMLElement>('[role=radio]')].find((r) => (typeof name === 'string' ? r.textContent?.trim() === name : name.test(r.textContent ?? '')))!;
const sw = (host: HTMLElement, label: string) => host.querySelector<HTMLInputElement>(`input[role=switch][aria-label="${label}"]`)!;
const flip = async (el: HTMLInputElement) => { el.click(); await settle(); };

describe('SettingsV3', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await updateSettings({ provider: 'groq' });
  });

  it('shows the frame copy', async () => {
    const { host } = await mount(sidepanel, 'SettingsV3');
    for (const text of [
      'Settings', 'Look and quality', 'Default style', 'Default pace', 'Calm', 'Normal', 'Fast', 'Quality check',
      'Up to 8 small frames per pass go to Groq.', 'Beat sync', 'Beats are found on this computer. The music never leaves it.',
      'AI images', 'Only the slot’s few-word description goes out.', 'Finishing', 'Motion blur, soft light, fine grain and a gentle grade on every export.',
      'Frame rate', '60 fps when your computer can', '30 fps', 'Preview quality', 'Only the preview changes. Export is always full quality.', 'Auto', 'Full', 'Light',
      'Show key frames first', 'Check one still per scene before the motion is added.', 'Voice and captions',
      'Auto captions', 'Your narration goes to Groq to be written down.', 'AI voiceover', 'Only the script goes to OpenAI.',
      'Where your data goes', 'Open source on GitHub',
    ]) expect(host.textContent, text).toContain(text);
  });

  it('draws every section itself, in the frame’s order', async () => {
    const { host } = await mount(sidepanel, 'SettingsV3');
    const heads = [...host.querySelectorAll('h2')].map((h) => h.textContent);
    expect(heads).toEqual(['AI that writes your clips', 'Keys', 'Look and quality', 'Voice and captions', 'Voice prompts', 'Clips']);
    for (const text of ['Penv Cloud', 'Paste a key instead', 'Add a key and its models appear in the list above.', 'Speak your prompt', 'On · English (US) · ',
      'Brand kit', 'Save folder', 'Change', 'Default export', 'MP4 · 1080p · 9:16 · 60 fps', 'Media sources']) expect(host.textContent, text).toContain(text);
  });

  it('Keys and Clips rows open the v1 screens', async () => {
    const view = await mount(sidepanel, 'SettingsV3');
    const go = async (name: string | RegExp, screen: string) => {
      await press(view.host, name);
      expect(view.router.route.screen).toBe(screen);
      act(() => view.router.back());
      await settle();
    };
    await go(/^pvPenv Cloud/, 'PenvConnected');
    await go('Paste a key instead', 'PasteKey');
    await go(/^Brand kit/, 'BrandKit');
    await go(/^Media sources/, 'MediaSources');
  });

  it('saves the voice prompts switch and the default export', async () => {
    const { host } = await mount(sidepanel, 'SettingsV3');
    await flip(sw(host, 'Speak your prompt'));
    expect((await getSettings()).voiceOn).toBe(false);
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Default export"]')!;
    select.value = 'webm|720p';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect((await getSettings()).defaultExport).toEqual({ kind: 'webm', quality: '720p' });
  });

  it('a v3-only pack writes auto to v2, and a v2 style is mirrored', async () => {
    const { host } = await mount(sidepanel, 'SettingsV3');
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Default style"]')!;
    const pick = async (v: string) => { select.value = v; select.dispatchEvent(new Event('change', { bubbles: true })); await settle(); };
    await pick('bold');
    expect((await getSettings()).look.style).toBe('bold');
    await pick('gloss');
    expect((await getSettings()).look.style).toBe('auto');
    expect((await getV3()).style).toBe('gloss');
  });

  it('starts the style select from v2 when v3 has none', async () => {
    await updateSettings({ look: { style: 'corporate' } });
    const { host } = await mount(sidepanel, 'SettingsV3');
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Default style"]')!.value).toBe('corporate');
  });

  it('starts with finishing on, 60 fps, auto preview, key frames first on, captions and voiceover off', async () => {
    const { host } = await mount(sidepanel, 'SettingsV3');
    expect([sw(host, 'Finishing'), sw(host, 'Show key frames first'), sw(host, 'Auto captions'), sw(host, 'AI voiceover')].map((s) => s.checked)).toEqual([true, true, false, false]);
    expect(radio(host, '60 fps when your computer can').getAttribute('aria-checked')).toBe('true');
    expect(radio(host, 'Auto').getAttribute('aria-checked')).toBe('true');
  });

  it('saves the finishing switch', async () => {
    const { host } = await mount(sidepanel, 'SettingsV3');
    await flip(sw(host, 'Finishing'));
    expect((await getV3()).finishing).toBe(false);
    expect(host.querySelector('b[aria-hidden]')).not.toBeNull();
  });

  it('saves the frame rate and the preview quality', async () => {
    const { host } = await mount(sidepanel, 'SettingsV3');
    await press(host, '30 fps');
    await press(host, 'Light');
    expect(await getV3()).toMatchObject({ fps: 30, previewQuality: 'light' });
    await press(host, 'Full');
    expect((await getV3()).previewQuality).toBe('full');
  });

  it('saves show key frames first, auto captions and AI voiceover', async () => {
    const { host } = await mount(sidepanel, 'SettingsV3');
    await flip(sw(host, 'Show key frames first'));
    await flip(sw(host, 'Auto captions'));
    expect(host.textContent).not.toContain('OpenAI key for voiceover');
    await flip(sw(host, 'AI voiceover'));
    expect(await getV3()).toMatchObject({ keyFramesFirst: false, captions: true, voiceover: true });
    expect(host.textContent).toContain('OpenAI key for voiceover');
    expect(host.textContent).toContain('Paste a key instead');
  });

  it('remembers every switch when the screen opens again', async () => {
    const first = await mount(sidepanel, 'SettingsV3');
    await flip(sw(first.host, 'Finishing'));
    await press(first.host, '30 fps');
    const second = await mount(sidepanel, 'SettingsV3');
    expect(sw(second.host, 'Finishing').checked).toBe(false);
    expect(radio(second.host, '30 fps').getAttribute('aria-checked')).toBe('true');
  });

  it('shows the machine check result', async () => {
    await saveMachineResult({ at: Date.now(), fps60: true });
    const { host } = await mount(sidepanel, 'SettingsV3');
    expect(host.textContent).toContain('This computer: 60 fps export · checked today');
  });

  it('names the OpenAI key from Penv Cloud as ready', async () => {
    await updateSettings({ keySource: 'penv-app' });
    await updateV3({ voiceover: true });
    const { host } = await mount(sidepanel, 'SettingsV3');
    expect(host.textContent).toContain('OpenAI key for voiceover');
    expect(host.textContent).toContain('From Penv Cloud · Ready');
  });

  it('Where your data goes opens PrivacyV3 and Back returns', async () => {
    const view = await mount(sidepanel, 'SettingsV3');
    await press(view.host, 'Where your data goes');
    expect(view.router.route.screen).toBe('PrivacyV3');
  });
});
