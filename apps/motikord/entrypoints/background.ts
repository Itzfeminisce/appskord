import { setBadge } from '../lib/badge';
import { onMessage } from '../lib/messages';

const EDITOR_URL = '/editor.html';

/** Focuses the editor tab already open on this clip, or opens a new one. */
async function openEditor(clipId?: string): Promise<{ tabId: number }> {
  const url = browser.runtime.getURL(EDITOR_URL) + (clipId ? `?clip=${encodeURIComponent(clipId)}` : '');
  // getContexts sees our own tabs without the "tabs" permission.
  const [open] = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB], documentUrls: [url] });
  if (open && open.tabId >= 0) {
    await browser.tabs.update(open.tabId, { active: true });
    if (open.windowId >= 0) await browser.windows.update(open.windowId, { focused: true });
    return { tabId: open.tabId };
  }
  const tab = await browser.tabs.create({ url });
  return { tabId: tab.id ?? -1 };
}

export default defineBackground(() => {
  // The toolbar icon opens the side panel. The machine check stays at /check.html in dev builds.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.error('Motikord: could not set the side panel to open from the toolbar', error);
  });
  onMessage({
    'editor/open': (msg) => openEditor(msg.clipId),
    'export/progress': (msg) => setBadge(msg.percent, chrome.action, browser.runtime.getManifest().action?.default_title ?? 'Motikord'),
  });
});
