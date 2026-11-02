import { setPanelRoute, type PanelRoute } from '@/lib/reminders';

// Fetched up front: sidePanel.open must run inside the click, with nothing awaited first.
let windowId: number | undefined;
try {
  browser.windows.getCurrent().then((w) => { windowId = w.id; }, () => undefined);
} catch {
  // Not an extension page (dev frames): the panel cannot open.
}

/** Opens the side panel on a screen from a Rekord tab; `onRefused` runs when Chrome says no. */
export function openPanelOn(screen: string, params: PanelRoute['params'] = {}, onRefused?: () => void): void {
  const opening = windowId !== undefined ? browser.sidePanel.open({ windowId }) : Promise.reject(new Error('No window to open the side panel in'));
  setPanelRoute(screen, params).catch((error) => console.error('Rekord: could not pass the screen to the side panel', error));
  opening.catch((error) => {
    console.error('Rekord: could not open the side panel', error);
    onRefused?.();
  });
}
