/** What the background or the welcome page asks the side panel to show next, passed in `chrome.storage.session`. */

/** Something right-clicked on a page, waiting for a board. */
export type PendingCapture =
  | { kind: 'image'; tabId: number; src: string; pageUrl?: string; pageTitle?: string }
  | { kind: 'selection'; text: string; pageUrl?: string; pageTitle?: string };

/** A right-click save that did not work, shown in the panel. */
export type Notice =
  | { kind: 'image-blocked'; boardId: string; tabId: number; pageUrl?: string; pageTitle?: string }
  | { kind: 'file-too-big'; name: string; bytes: number }
  | { kind: 'storage-low' };

export interface PanelIntent {
  /** A panel route, such as `/new` or `/settings`, and its search params. */
  route?: string;
  search?: Record<string, string>;
  capture?: PendingCapture;
  notice?: Notice;
}

const KEY = 'panelIntent';

export async function sendIntent(intent: PanelIntent): Promise<void> {
  await browser.storage.session.set({ [KEY]: { ...intent, at: Date.now() } });
}

/** Calls `listener` with the waiting intent, now and each time one arrives, and clears it; returns the unsubscribe. */
export function takeIntents(listener: (intent: PanelIntent) => void): () => void {
  let lastAt = 0;
  const take = async () => {
    const stored = (await browser.storage.session.get(KEY))[KEY] as (PanelIntent & { at: number }) | undefined;
    if (!stored || stored.at === lastAt) return;
    lastAt = stored.at;
    await browser.storage.session.remove(KEY);
    listener(stored);
  };
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'session' && changes[KEY]?.newValue) void take();
  };
  void take().catch((error: unknown) => console.error('Briefkord: could not read the panel request', error));
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
