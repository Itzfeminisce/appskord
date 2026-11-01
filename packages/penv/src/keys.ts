/**
 * API keys by their Penv Cloud names, held in memory only: `chrome.storage.session` is cleared when the browser
 * closes and is never written to disk. Never in `local`, IndexedDB or a log.
 */
import { browser } from 'wxt/browser';

/**
 * Where an app keeps its keys in `chrome.storage.session`; each app keeps the layout it shipped with.
 * `map`: one entry holding a name → value map. `names`: one entry per known key, under the app's own name for it;
 * keys without a name here are dropped.
 */
export type KeyLayout = { kind: 'map'; storageKey: string } | { kind: 'names'; names: Record<string, string> };

export interface KeyStore {
  saveKeys(keys: Record<string, string>): Promise<void>;
  loadKeys(): Promise<Record<string, string>>;
  clearKeys(): Promise<void>;
  /** Adds keys to the ones already in memory; a key that is not in `keys` is left alone. */
  mergeKeys(keys: Record<string, string>): Promise<void>;
}

export function createKeyStore(layout: KeyLayout): KeyStore {
  if (layout.kind === 'map') {
    const { storageKey } = layout;
    const loadKeys = async () =>
      ((await browser.storage.session.get(storageKey))[storageKey] as Record<string, string> | undefined) ?? {};
    const saveKeys = async (keys: Record<string, string>) => {
      await browser.storage.session.set({ [storageKey]: keys });
    };
    return {
      saveKeys,
      loadKeys,
      clearKeys: () => browser.storage.session.remove(storageKey),
      mergeKeys: async (keys) => saveKeys({ ...(await loadKeys()), ...keys }),
    };
  }
  const { names } = layout;
  const saveKeys = async (keys: Record<string, string>) => {
    const items = Object.fromEntries(
      Object.entries(keys).flatMap(([name, value]) => (names[name] ? [[names[name], value]] : [])),
    );
    if (Object.keys(items).length > 0) await browser.storage.session.set(items);
  };
  return {
    saveKeys,
    loadKeys: async () => {
      const stored = await browser.storage.session.get(Object.values(names));
      const out: Record<string, string> = {};
      for (const [name, key] of Object.entries(names)) {
        const value = stored[key];
        if (typeof value === 'string' && value) out[name] = value;
      }
      return out;
    },
    clearKeys: () => browser.storage.session.remove(Object.values(names)),
    // Each key has its own entry, so saving only touches the keys given.
    mergeKeys: saveKeys,
  };
}
