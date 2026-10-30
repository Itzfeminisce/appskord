import { useEffect, useRef } from 'react';
import { send } from './messages';

// "Open Settings" and "Go to your clips" from the editor tab: an open side panel hears the message; one that is just opening reads the key on start.
const KEY = 'sidepanelGo';
export type SidepanelGoal = 'Settings' | 'Library' | 'PasteKey';
const GOALS: readonly string[] = ['Settings', 'Library', 'PasteKey'];

/** Call inside the click (no await before it), so Chrome lets the side panel open. */
export function openSidePanelOn(windowId: number, screen: SidepanelGoal): void {
  browser.storage.session.set({ [KEY]: screen }).catch((error: unknown) => console.error('Motikord: could not remember the side panel screen', error));
  browser.sidePanel.open({ windowId })
    .then(() => send({ type: 'sidepanel/go', screen }))
    .catch((error: unknown) => console.error('Motikord: could not open the side panel', error));
}

/** The screen the editor asked the side panel to show, once; undefined when there is none. */
export async function takeSidePanelGoal(): Promise<SidepanelGoal | undefined> {
  try {
    const v = (await browser.storage.session.get(KEY))[KEY];
    if (v === undefined) return undefined;
    await browser.storage.session.remove(KEY);
    return typeof v === 'string' && GOALS.includes(v) ? (v as SidepanelGoal) : undefined;
  } catch (error) {
    console.error('Motikord: could not read the side panel screen', error);
    return undefined;
  }
}

/** This tab's window, known before any click so the side panel can open inside it. */
export function useWindowId() {
  const id = useRef<number>(undefined);
  useEffect(() => { void browser.windows.getCurrent().then((w) => { id.current = w.id; }).catch(() => undefined); }, []);
  return id;
}

/** Opens the side panel on `screen` from a click in an editor tab. */
export function goInSidePanel(windowId: number | undefined, screen: SidepanelGoal): void {
  if (windowId === undefined) return;
  openSidePanelOn(windowId, screen);
}
