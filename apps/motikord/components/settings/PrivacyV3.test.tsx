// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { mount } from '../../test/mountRouter';
import { press } from '../sidepanel/mountPanel';
import { updateV3 } from './store';

describe('PrivacyV3', () => {
  beforeEach(() => fakeBrowser.reset());

  it('shows the frame copy', async () => {
    const { host } = await mount(sidepanel, 'PrivacyV3');
    for (const text of [
      'Where your data goes', 'Each kind of data, and the only place it goes. Anything not listed stays on this computer.',
      'Stays on this computer', 'Never uploaded', 'Editor, preview and render', 'Library and look guides', 'Your media', 'Photos, videos and music.',
      '3D, effects, particles, animations and fonts', 'Bundled. Nothing is downloaded.',
      'Goes to your AI', 'Groq', 'Prompt and storyboard', 'So the AI can plan and write your clip.', 'Look guide text', 'Palette, type pair, motion feel, light and texture as words.',
      '“Animate this layer” settings', 'Only the layer’s settings, never media.', 'Small frames for the quality check', 'Up to 8 per check pass, only if your model can see images.',
      'Captions', 'Groq or OpenAI', 'Your narration', 'Only when Auto captions is on.', 'Voiceover', 'OpenAI', 'Only the script', 'Only when AI voiceover is on.',
      'Keys', 'Keys come from Penv Cloud or a key you paste. Motikord never shows or logs them.',
    ]) expect(host.textContent, text).toContain(text);
  });

  it('shows captions and voiceover Off by default and On once they are turned on', async () => {
    const off = await mount(sidepanel, 'PrivacyV3');
    expect([...off.host.querySelectorAll('section[aria-label=Captions] span, section[aria-label=Voiceover] span')].filter((s) => s.textContent === 'Off')).toHaveLength(2);
    await updateV3({ captions: true, voiceover: true });
    const on = await mount(sidepanel, 'PrivacyV3');
    expect([...on.host.querySelectorAll('section[aria-label=Captions] span, section[aria-label=Voiceover] span')].filter((s) => s.textContent === 'On')).toHaveLength(2);
  });

  it('Back returns to the screen before', async () => {
    const view = await mount(sidepanel, 'SettingsV3');
    await press(view.host, 'Where your data goes');
    await press(view.host, 'Back');
    expect(view.router.route.screen).toBe('SettingsV3');
  });
});
