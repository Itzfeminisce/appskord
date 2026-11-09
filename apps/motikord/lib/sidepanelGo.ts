import { useEffect, useRef } from 'react';
import { send } from './messages';
import type { Provider } from './types';

// "Open Settings" and "Go to your clips" from the editor tab: an open side panel hears the message; one that is just opening reads the key on start.
const KEY = 'sidepanelGo';
export type SidepanelGoal = 'Settings' | 'SettingsV3' | 'Library' | 'PasteKey' | 'PenvConnect' | 'MediaSources' | 'ImageKey';
const GOALS: readonly string[] = ['Settings', 'SettingsV3', 'Library', 'PasteKey', 'PenvConnect', 'MediaSources', 'ImageKey'];

/** Call inside the click (no await before it), so Chrome lets the side panel open. */
export function openSidePanelOn(windowId: number, screen: SidepanelGoal): void {
  browser.storage.session.set({ [KEY]: screen }).catch((error: unknown) => console.error('Motikord: could not remember the side panel screen', error));
  browser.sidePanel.open({ windowId })
    .then(() => send({ type: 'sidepanel/go', screen }))
    .catch((error: unknown) => console.error('Motikord: could not open the side panel', error));
}

/** Opens the side panel on whatever it shows now. Call inside the click, like openSidePanelOn. */
export function openSidePanel(windowId: number | undefined): void {
  if (windowId === undefined) return;
  browser.sidePanel.open({ windowId }).catch((error: unknown) => console.error('Motikord: could not open the side panel', error));
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

const FOR_KEY = 'pasteKeyFor';
const FOR_PROVIDERS: readonly string[] = ['groq', 'openai'];

/** Opens PasteKey for one provider's key (voiceover: OpenAI; captions: the speech provider) without changing the clip-writing provider. */
export function addKeyInSidePanel(windowId: number | undefined, provider: Provider): void {
  if (windowId === undefined) return;
  browser.storage.session.set({ [FOR_KEY]: provider }).catch((error: unknown) => console.error('Motikord: could not remember which key to ask for', error));
  openSidePanelOn(windowId, 'PasteKey');
}

/** The provider the editor wants a key for, once; undefined when PasteKey was opened the ordinary way. */
export async function takePasteKeyFor(): Promise<Provider | undefined> {
  try {
    const v = (await browser.storage.session.get(FOR_KEY))[FOR_KEY];
    if (v === undefined) return undefined;
    await browser.storage.session.remove(FOR_KEY);
    return typeof v === 'string' && FOR_PROVIDERS.includes(v) ? (v as Provider) : undefined;
  } catch (error) {
    console.error('Motikord: could not read which key to ask for', error);
    return undefined;
  }
}
