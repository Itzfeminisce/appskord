import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addKeyInSidePanel, takePasteKeyFor, takeSidePanelGoal } from './sidepanelGo';

describe('addKeyInSidePanel', () => {
  beforeEach(() => { fakeBrowser.reset(); (fakeBrowser as unknown as { sidePanel: unknown }).sidePanel = { open: vi.fn(async () => undefined) }; vi.stubGlobal('browser', fakeBrowser); });

  it('opens PasteKey for the provider asked, once', async () => {
    addKeyInSidePanel(7, 'openai');
    await vi.waitFor(async () => expect(await takeSidePanelGoal()).toBe('PasteKey'));
    expect(await takePasteKeyFor()).toBe('openai');
    expect(await takePasteKeyFor()).toBeUndefined();
  });

  it('does nothing without a window', async () => {
    addKeyInSidePanel(undefined, 'openai');
    expect(await takePasteKeyFor()).toBeUndefined();
  });
});
