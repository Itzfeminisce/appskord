/** Opens the side panel on a route from a click in the board tab; as a tab when Chrome won't open the panel. */
import { sendIntent } from '@/lib/capture/intent';

let windowId: number | undefined;
chrome.windows?.getCurrent?.().then((w) => (windowId = w.id)).catch(() => undefined);

export function openPanelSettings(show?: string): void {
  const search = show ? { show } : undefined;
  const asTab = () => void browser.tabs.create({ url: browser.runtime.getURL(`/sidepanel.html#/settings${show ? `?show=${show}` : ''}`) });
  void sendIntent({ route: '/settings', search }).catch((error: unknown) => console.error('Briefkord: could not send the panel request', error));
  // sidePanel.open must run inside the click, before any await.
  if (windowId === undefined || !chrome.sidePanel?.open) return asTab();
  chrome.sidePanel.open({ windowId }).catch(asTab);
}
