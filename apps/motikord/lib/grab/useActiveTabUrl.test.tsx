// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { useActiveTabUrl } from './access';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useActiveTabUrl', () => {
  it('calls onChange when the active tab’s page changes, not on the first read of the same page', async () => {
    fakeBrowser.reset();
    const onChange = vi.fn();
    const Probe = () => { useActiveTabUrl(onChange); return null; };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => { root.render(<Probe />); });
    const tab = await fakeBrowser.tabs.create({ url: 'https://a.example/', active: true });
    await act(async () => { await fakeBrowser.tabs.onActivated.trigger({ tabId: tab.id!, windowId: tab.windowId! }); });
    await act(async () => { await fakeBrowser.tabs.update(tab.id!, { url: 'https://b.example/' }); });
    expect(onChange).toHaveBeenCalled();
    act(() => root.unmount());
  });
});
