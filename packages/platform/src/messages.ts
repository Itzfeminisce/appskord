/** Typed runtime messages between an app's surfaces; each app declares its own message union. */
import { browser, type Browser } from 'wxt/browser';

export type MessageSender = Browser.runtime.MessageSender;

/**
 * Sends a runtime message. Resolves with the listener's response, or undefined when nothing is listening
 * (never throws for "Receiving end does not exist").
 */
export async function send<T extends { type: string }, R = unknown>(msg: T): Promise<R | undefined> {
  try {
    return (await browser.runtime.sendMessage(msg)) as R | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Listens for runtime messages. Return a value (or a promise) from the handler to reply; return undefined to ignore.
 * Returns an unsubscribe function.
 */
export function on<T extends { type: string }>(handler: (msg: T, sender: MessageSender) => unknown): () => void {
  // sendResponse + `return true` works on every Chrome version, unlike returning a promise.
  const listener = (msg: unknown, sender: MessageSender, sendResponse: (r?: unknown) => void) => {
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return false;
    const result = handler(msg as T, sender);
    if (result === undefined) return false;
    Promise.resolve(result).then(sendResponse, () => sendResponse(undefined));
    return true;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
