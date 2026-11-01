import { on, send as sendMessage, type MessageSender } from '@appskord/platform';
import type { PageInfo, Pick } from './grab/pick';

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
  // Editor tab → side panel, after opening it inside the click: provider-down "Open Settings", key-needed "Paste a key", clip-not-found "Go to your clips", a media source's "Add key".
  'sidepanel/go': { req: { screen: 'Settings' | 'Library' | 'PasteKey' | 'MediaSources' }; res: { shown: boolean } };
  // Export (T11) → service worker: toolbar badge progress, 0 to 100; null clears it.
  'export/progress': { req: { percent: number | null }; res: void };
  // Page picker → side panel: the picks so far (each click), "Done" or Esc (`done`), or "Cancel".
  // Picks carry no picture bytes, only a small `thumb`; each picture's bytes follow once in 'grab/data'.
  'grab/picks': { req: { picks: Pick[]; page: PageInfo; done?: boolean }; res: void };
  'grab/data': { req: { id: string; dataUrl: string }; res: void };
  'grab/cancel': { req: Record<never, never>; res: void };
  // Side panel → page picker (sent to the tab): remove one pick, or stop picking.
  'grab/remove': { req: { id: string }; res: void };
  'grab/stop': { req: Record<never, never>; res: void };
}

/** Session-storage key the editor sets for a side panel that is still loading. */
export const PANEL_GOTO = 'motikordPanelGoto';

export type MessageType = keyof MessageMap;
export type MessageOf<T extends MessageType> = { type: T } & MessageMap[T]['req'];
export type Message = { [T in MessageType]: MessageOf<T> }[MessageType];
export type ResponseOf<T extends MessageType> = MessageMap[T]['res'];

export type Handlers = {
  [T in MessageType]?: (msg: MessageOf<T>, sender: MessageSender) => ResponseOf<T> | Promise<ResponseOf<T>>;
};

/** Sends a runtime message; resolves with the reply, or undefined when nothing is listening. */
export const send = <T extends MessageType>(msg: MessageOf<T>): Promise<ResponseOf<T> | undefined> => sendMessage<MessageOf<T>, ResponseOf<T>>(msg);

/** Listens for the message types in `handlers`; others are left for other listeners. Returns an unsubscribe function. */
export function onMessage(handlers: Handlers): () => void {
  return on<Message>((msg, sender) => {
    const handler = (handlers as Record<string, Function | undefined>)[msg.type];
    if (!handler) return undefined;
    return Promise.resolve()
      .then(() => handler(msg, sender))
      .catch((error: unknown) => {
        console.error(`Motikord: could not answer ${String(msg.type)}`, error);
        return undefined;
      });
  });
}
