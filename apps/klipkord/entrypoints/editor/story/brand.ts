import { useEffect, useState } from 'react';
import type { Cut } from '@/lib/project/types';
import { brandStore, MOTIKORD_ID, offerBrand, pullBrand, type BrandRecord, type BrandRuntime, type BrandStore } from '@appskord/brand';

/** Motikord, the app this kit is shared with. */
export const BRAND_PEER = MOTIKORD_ID;

export interface BrandEnv { store: BrandStore; runtime: BrandRuntime }

let env: BrandEnv | null = null;

/** Klipkord's kit in `chrome.storage.local`, synced with Motikord over external messages. */
export function brandEnv(): BrandEnv {
  env ??= { store: brandStore(browser.storage.local), runtime: browser.runtime as unknown as BrandRuntime };
  return env;
}

/** Tests pass a fake store and runtime. */
export function setBrandEnv(next: BrandEnv | null): void {
  env = next;
}

/** The kit an export draws cards with; none when the cut has no cards or the kit can't be read. */
export async function loadBrand(cut: Pick<Cut, 'cards'>): Promise<BrandRecord | null> {
  if (!cut.cards.length) return null;
  try {
    return await brandEnv().store.load();
  } catch (error) {
    console.error('Klipkord: could not read the brand kit', error);
    return null;
  }
}

/** Saves the kit here and offers it to Motikord when it is installed. */
export async function saveBrand(record: BrandRecord): Promise<void> {
  const { store, runtime } = brandEnv();
  await store.save(record);
  await offerBrand(runtime, BRAND_PEER, record);
}

/** The kit on this computer: the local one at once, then Motikord's when it is newer. */
export function useBrand(): BrandRecord | null {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  useEffect(() => {
    const { store, runtime } = brandEnv();
    let live = true;
    const off = store.subscribe((r) => { if (live) setBrand(r); });
    store.load()
      .then((r) => { if (live) setBrand(r); return pullBrand(runtime, store, BRAND_PEER); })
      .then((r) => { if (live) setBrand(r); })
      .catch((error: unknown) => console.error('Klipkord: could not read the brand kit', error));
    return () => { live = false; off(); };
  }, []);
  return brand;
}

/** The kit on this computer as the store holds it, for drawing; it never asks Motikord. */
export function useStoredBrand(): BrandRecord | null {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  useEffect(() => {
    const { store } = brandEnv();
    let live = true;
    const off = store.subscribe((r) => { if (live) setBrand(r); });
    store.load()
      .then((r) => { if (live) setBrand(r); })
      .catch((error: unknown) => console.error('Klipkord: could not read the brand kit', error));
    return () => { live = false; off(); };
  }, []);
  return brand;
}
