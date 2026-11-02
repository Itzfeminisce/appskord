import { setPanelRoute, type PanelRoute } from '@/lib/reminders';

// Fetched up front: sidePanel.open must run inside the click, with nothing awaited first.
let windowId: number | undefined;
try {
  browser.windows.getCurrent().then((w) => { windowId = w.id; }, () => undefined);
} catch {
  // Not an extension page (dev frames): the panel cannot open.
}

/** Opens the side panel page in a tab; it takes the route just set. */
const openPanelTab = () => {
  browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') }).catch((error) => console.error('Rekord: could not open the tab', error));
};

/** Opens the side panel on a screen from a Rekord tab; `onRefused` (default: the side panel page in a tab) runs when Chrome says no. */
export function openPanelOn(screen: string, params: PanelRoute['params'] = {}, onRefused: () => void = openPanelTab): void {
  const open = (id: number | undefined) => id !== undefined ? browser.sidePanel.open({ windowId: id }) : Promise.reject(new Error('No window to open the side panel in'));
  const opening = windowId !== undefined ? open(windowId) : browser.windows.getLastFocused().then((w) => open(w.id));
  setPanelRoute(screen, params).catch((error) => console.error('Rekord: could not pass the screen to the side panel', error));
  opening.catch((error) => {
    console.error('Rekord: could not open the side panel', error);
    onRefused();
  });
}
