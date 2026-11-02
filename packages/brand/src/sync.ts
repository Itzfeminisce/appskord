import { isBrandRecord, type BrandRecord } from './kit';
import type { BrandStore } from './store';

/** Fixed by each app's public key in its wxt.config.ts. */
export const KLIPKORD_ID = 'iapgbifdchhmidblniddncnagghloepi';
export const MOTIKORD_ID = 'pppjklpibpnndjfddhcedbdicfdalchl';

/** `get` asks for the peer's kit; `offer` hands it ours, kept only when newer. */
export type BrandMessage = { type: 'appskord/brand/get' } | { type: 'appskord/brand/offer'; brand: BrandRecord };
/** The answer to both: the kit the answering app keeps after the message, or null when it has none. */
export interface BrandReply {
  brand: BrandRecord | null;
}

export interface ExternalSender {
  id?: string;
}
type Listener = (
  message: unknown,
  sender: ExternalSender,
  sendResponse: (reply: BrandReply) => void,
) => boolean | undefined;

/** The part of `chrome.runtime` the sync needs; tests pass a fake. */
export interface BrandRuntime {
  sendMessage(extensionId: string, message: BrandMessage): Promise<unknown>;
  onMessageExternal: { addListener(listener: Listener): void; removeListener(listener: Listener): void };
}

const isBrandMessage = (m: unknown): m is BrandMessage => {
  const t = (m as { type?: unknown } | null)?.type;
  return (
    t === 'appskord/brand/get' || (t === 'appskord/brand/offer' && isBrandRecord((m as { brand?: unknown }).brand))
  );
};

/** Sends one message; null when the peer is not installed or answers with something else. */
async function ask(runtime: BrandRuntime, peer: string, message: BrandMessage): Promise<BrandReply | null> {
  try {
    const reply = (await runtime.sendMessage(peer, message)) as { brand?: unknown } | undefined;
    if (!reply || typeof reply !== 'object') return null;
    return { brand: isBrandRecord(reply.brand) ? reply.brand : null };
  } catch {
    // The peer is not installed or not running a listener; the kit stays local.
    return null;
  }
}

/** Hands the peer our kit. True when the peer answered. */
export async function offerBrand(runtime: BrandRuntime, peer: string, brand: BrandRecord): Promise<boolean> {
  return (await ask(runtime, peer, { type: 'appskord/brand/offer', brand })) !== null;
}

/** Reads the peer's kit and keeps it when it is newer; resolves with the kit this app now has. */
export async function pullBrand(runtime: BrandRuntime, store: BrandStore, peer: string): Promise<BrandRecord | null> {
  const reply = await ask(runtime, peer, { type: 'appskord/brand/get' });
  if (reply?.brand) await store.keepNewer(reply.brand);
  return store.load();
}

/** Answers `get` and `offer` from the listed peers only; returns the unsubscribe. */
export function answerBrand(runtime: BrandRuntime, store: BrandStore, peers: readonly string[]): () => void {
  const listener: Listener = (message, sender, sendResponse) => {
    if (!sender.id || !peers.includes(sender.id) || !isBrandMessage(message)) return undefined;
    const done =
      message.type === 'appskord/brand/offer' ? store.keepNewer(message.brand).then(() => store.load()) : store.load();
    done.then(
      (brand) => sendResponse({ brand }),
      (error: unknown) => {
        console.error('Appskord: could not answer the brand kit message', error);
        sendResponse({ brand: null });
      },
    );
    return true;
  };
  runtime.onMessageExternal.addListener(listener);
  return () => runtime.onMessageExternal.removeListener(listener);
}
