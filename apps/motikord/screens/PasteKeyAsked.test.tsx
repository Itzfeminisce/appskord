// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { sidepanel } from '../entrypoints/sidepanel/router';
import { getSettings, updateSettings } from '../lib/settings';
import { mount } from '../test/mountRouter';

describe('PasteKey for a provider the editor asked for', () => {
  beforeEach(async () => { fakeBrowser.reset(); await updateSettings({ provider: 'groq' }); });

  it('asks for the OpenAI key and leaves the clip-writing provider alone', async () => {
    await fakeBrowser.storage.session.set({ pasteKeyFor: 'openai' });
    const { host } = await mount(sidepanel, 'PasteKey');
    expect(host.textContent).toContain('Add your OpenAI key');
    expect(host.textContent).not.toContain('Writing clips with');
    expect((await getSettings()).provider).toBe('groq');
    expect((await fakeBrowser.storage.session.get('pasteKeyFor')).pasteKeyFor).toBeUndefined();
  });

  it('shows the chosen provider when nothing was asked', async () => {
    const { host } = await mount(sidepanel, 'PasteKey');
    expect(host.textContent).toContain('Add your Groq key');
    expect(host.textContent).toContain('Writing clips with');
  });
});
