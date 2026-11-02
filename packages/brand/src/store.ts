import { clampRecord, isBrandRecord, newer, type BrandRecord } from './kit';

/** The part of `chrome.storage.local` the store needs; tests pass a map. */
export interface BrandArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const BRAND_KEY = 'appskord.brand';

export interface BrandStore {
  load(): Promise<BrandRecord | null>;
  save(record: BrandRecord): Promise<void>;
  /** Saves `record` only when it is newer than the one kept; true when it was saved. */
  keepNewer(record: BrandRecord): Promise<boolean>;
  subscribe(onChange: (record: BrandRecord) => void): () => void;
}

/** The brand kit on this computer, in one app's storage. */
export function brandStore(area: BrandArea): BrandStore {
  const listeners = new Set<(record: BrandRecord) => void>();
  const load = async (): Promise<BrandRecord | null> => {
    const value = (await area.get(BRAND_KEY))[BRAND_KEY];
    return isBrandRecord(value) ? value : null;
  };
  const save = async (record: BrandRecord): Promise<void> => {
    await area.set({ [BRAND_KEY]: record });
    listeners.forEach((l) => l(record));
  };
  return {
    load,
    save,
    async keepNewer(record) {
      if (!isBrandRecord(record)) return false;
      const peer = clampRecord(record);
      if (!newer(await load(), peer)) return false;
      await save(peer);
      return true;
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}
