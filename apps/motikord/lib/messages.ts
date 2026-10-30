/**
 * Runtime messages between the side panel, the editor tab and the service worker.
 * Each entry is the message's fields (`req`) and what its listener answers (`res`). Later tasks add entries here.
 */
export interface MessageMap {
  // Side panel → service worker: open (or focus) the editor tab on a clip.
  'editor/open': { req: { clipId?: string }; res: { tabId: number } };
  // Editor tab → everyone: a clip was saved to IndexedDB, so lists reload it.
  'clip/saved': { req: { clipId: string }; res: void };
  // Brand kit screen → editor tab: apply the saved brand kit to the open clip as one Change by 'hand'.
  'brand/apply': { req: { clipId?: string }; res: { applied: boolean } };
  // Editor tab → side panel: show PasteKey (the Pexels field), e.g. from "Add a Pexels key".
  'panel/show-paste-key': { req: {}; res: void };
  // Export (T11) → service worker: toolbar badge progress, 0 to 100; null clears it.
  'export/progress': { req: { percent: number | null }; res: void };
}

/** Session-storage key the editor sets for a side panel that is still loading. */
export const PANEL_GOTO = 'motikordPanelGoto';

export type MessageType = keyof MessageMap;
export type MessageOf<T extends MessageType> = { type: T } & MessageMap[T]['req'];
export type Message = { [T in MessageType]: MessageOf<T> }[MessageType];
export type ResponseOf<T extends MessageType> = MessageMap[T]['res'];

export type Handlers = {
  [T in MessageType]?: (msg: MessageOf<T>, sender: Browser.runtime.MessageSender) => ResponseOf<T> | Promise<ResponseOf<T>>;
};

/**
 * Sends a runtime message. Resolves with the listener's response, or undefined when nothing is listening
 * (never throws for "Receiving end does not exist").
 */
export async function send<T extends MessageType>(msg: MessageOf<T>): Promise<ResponseOf<T> | undefined> {
  try {
    return (await browser.runtime.sendMessage(msg)) as ResponseOf<T> | undefined;
  } catch {
    return undefined;
  }
}

/** Listens for the message types in `handlers`; others are left for other listeners. Returns an unsubscribe function. */
export function onMessage(handlers: Handlers): () => void {
  // sendResponse + `return true` works on every Chrome version, unlike returning a promise.
  const listener = (msg: unknown, sender: Browser.runtime.MessageSender, sendResponse: (r?: unknown) => void) => {
    if (!msg || typeof msg !== 'object') return false;
    const type = (msg as { type?: unknown }).type;
    const handler = typeof type === 'string' ? (handlers as Record<string, Function | undefined>)[type] : undefined;
    if (!handler) return false;
    Promise.resolve()
      .then(() => handler(msg, sender))
      .then(sendResponse, (error: unknown) => {
        console.error(`Motikord: could not answer ${String(type)}`, error);
        sendResponse(undefined);
      });
    return true;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
