import { describe, expect, it, vi } from 'vitest';
import {
  BRAND_KEY,
  KLIPKORD_ID,
  MOTIKORD_ID,
  answerBrand,
  brandStore,
  colourOf,
  emptyKit,
  isBrandKit,
  isBrandRecord,
  MAX_LOGO_LENGTH,
  brandFontFamily,
  BRAND_FONTS,
  DEFAULT_BRAND_FONT,
  logoAssetId,
  offerBrand,
  pullBrand,
  withColour,
  type BrandArea,
  type BrandRecord,
  type BrandRuntime,
} from './index';

function area(initial: Record<string, unknown> = {}): BrandArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (items) => {
      Object.assign(data, items);
    },
  };
}

const kit = (hex = '#2563EB') => withColour(emptyKit(), 'primary', hex);
const record = (updatedAt: number, hex?: string): BrandRecord => ({ kit: kit(hex), updatedAt });

/** Two apps on one computer: each runtime delivers to the other's external listeners. */
function pair() {
  const listeners = new Map<string, Set<Parameters<BrandRuntime['onMessageExternal']['addListener']>[0]>>();
  const runtimeOf = (self: string): BrandRuntime => ({
    sendMessage: (peer, message) =>
      new Promise((resolve, reject) => {
        const set = listeners.get(peer);
        if (!set?.size) return reject(new Error('Could not establish connection. Receiving end does not exist.'));
        for (const l of set) if (l(message, { id: self }, resolve)) return;
        resolve(undefined);
      }),
    onMessageExternal: {
      addListener: (l) => {
        if (!listeners.has(self)) listeners.set(self, new Set());
        listeners.get(self)!.add(l);
      },
      removeListener: (l) => {
        listeners.get(self)?.delete(l);
      },
    },
  });
  return { klipkord: runtimeOf(KLIPKORD_ID), motikord: runtimeOf(MOTIKORD_ID) };
}

describe('brand kit', () => {
  it("keeps Motikord's exact shape and checks it", () => {
    expect(
      isBrandKit({ colours: [{ hex: '#2563EB', role: 'primary' }], headingFont: 'Inter', useForNewClips: true }),
    ).toBe(true);
    expect(isBrandKit({ colours: [{ hex: 'blue', role: 'primary' }], useForNewClips: true })).toBe(false);
    expect(isBrandKit({ colours: [{ hex: '#2563EB', role: 'main' }], useForNewClips: true })).toBe(false);
    expect(isBrandKit({ colours: [] })).toBe(false);
  });

  it("sets a role's colour in place and names the logo as Motikord does", () => {
    const k = withColour(withColour(kit(), 'accent', '#F59E0B'), 'primary', '#111111');
    expect(k.colours).toEqual([
      { hex: '#111111', role: 'primary' },
      { hex: '#F59E0B', role: 'accent' },
    ]);
    expect(colourOf(k, 'text')).toBeUndefined();
    expect(logoAssetId('image/jpeg')).toBe('brand-logo-jpg');
    expect(logoAssetId('image/svg+xml')).toBe('brand-logo-svg');
  });
});

describe('store', () => {
  it('saves, loads and ignores a stored value of the wrong shape', async () => {
    const a = area({ [BRAND_KEY]: { kit: { colours: 'x' }, updatedAt: 1 } });
    const store = brandStore(a);
    expect(await store.load()).toBeNull();
    const seen = vi.fn();
    store.subscribe(seen);
    await store.save(record(5));
    expect(await store.load()).toEqual(record(5));
    expect(seen).toHaveBeenCalledWith(record(5));
  });

  it('keeps only a newer kit', async () => {
    const store = brandStore(area());
    expect(await store.keepNewer(record(5))).toBe(true);
    expect(await store.keepNewer(record(4, '#000000'))).toBe(false);
    expect(await store.keepNewer(record(5, '#000000'))).toBe(false);
    expect(await store.keepNewer(record(6, '#000000'))).toBe(true);
    expect((await store.load())?.kit.colours[0]?.hex).toBe('#000000');
  });
});

describe('sync between Klipkord and Motikord', () => {
  it('offers a kit the peer keeps when newer, and the peer answers with what it keeps', async () => {
    const { klipkord, motikord } = pair();
    const mine = brandStore(area());
    const theirs = brandStore(area());
    answerBrand(motikord, theirs, [KLIPKORD_ID]);
    expect(await offerBrand(klipkord, MOTIKORD_ID, record(10))).toBe(true);
    expect(await theirs.load()).toEqual(record(10));
    await offerBrand(klipkord, MOTIKORD_ID, record(9, '#000000'));
    expect((await theirs.load())?.updatedAt).toBe(10);
    expect(await mine.load()).toBeNull();
  });

  it("pulls the peer's kit only when it is newer", async () => {
    const { klipkord, motikord } = pair();
    const mine = brandStore(area());
    const theirs = brandStore(area());
    answerBrand(motikord, theirs, [KLIPKORD_ID]);
    await theirs.save(record(20, '#0F172A'));
    expect((await pullBrand(klipkord, mine, MOTIKORD_ID))?.updatedAt).toBe(20);
    await mine.save(record(30));
    expect((await pullBrand(klipkord, mine, MOTIKORD_ID))?.updatedAt).toBe(30);
  });

  it('stays local when the peer is not installed', async () => {
    const { klipkord } = pair();
    const mine = brandStore(area());
    await mine.save(record(1));
    expect(await offerBrand(klipkord, MOTIKORD_ID, record(2))).toBe(false);
    expect(await pullBrand(klipkord, mine, MOTIKORD_ID)).toEqual(record(1));
  });

  it('ignores other extensions and messages of the wrong shape', async () => {
    const { motikord } = pair();
    const theirs = brandStore(area());
    answerBrand(motikord, theirs, [KLIPKORD_ID]);
    const reply = vi.fn();
    let listener: Parameters<BrandRuntime['onMessageExternal']['addListener']>[0] | undefined;
    const spy: BrandRuntime = {
      sendMessage: vi.fn(),
      onMessageExternal: {
        addListener: (l) => {
          listener = l;
        },
        removeListener: vi.fn(),
      },
    };
    const off = answerBrand(spy, theirs, [KLIPKORD_ID]);
    expect(listener!({ type: 'appskord/brand/get' }, { id: 'someone-else' }, reply)).toBeUndefined();
    expect(
      listener!({ type: 'appskord/brand/offer', brand: { kit: {}, updatedAt: 1 } }, { id: KLIPKORD_ID }, reply),
    ).toBeUndefined();
    expect(
      listener!(
        { type: 'appskord/brand/offer', brand: { ...record(3), logo: 'https://x' } },
        { id: KLIPKORD_ID },
        reply,
      ),
    ).toBeUndefined();
    expect(reply).not.toHaveBeenCalled();
    off();
    expect(spy.onMessageExternal.removeListener).toHaveBeenCalled();
  });
});

describe('limits and fonts', () => {
  it('refuses a huge logo and more colours than roles', () => {
    expect(isBrandRecord({ ...record(1), logo: 'data:image/png;base64,' + 'A'.repeat(MAX_LOGO_LENGTH) })).toBe(false);
    expect(isBrandRecord({ ...record(1), logo: 'data:image/png;base64,AAAA' })).toBe(true);
    const k = kit();
    expect(isBrandKit({ ...k, colours: [...k.colours, ...k.colours, ...k.colours, ...k.colours, ...k.colours] })).toBe(
      false,
    );
  });

  it('clamps a peer clock in the future to now', async () => {
    const store = brandStore(area());
    const before = Date.now();
    expect(await store.keepNewer(record(Date.now() + 10 ** 12))).toBe(true);
    const saved = (await store.load())!;
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
    expect(saved.updatedAt).toBeLessThanOrEqual(Date.now());
  });

  it('names the bundled fonts, Inter by default', () => {
    expect(BRAND_FONTS).toEqual(['Geist', 'Inter', 'Archivo', 'Archivo Black']);
    expect(DEFAULT_BRAND_FONT).toBe('Inter');
    expect(brandFontFamily('Archivo Black')).toContain("'Archivo Black'");
  });
});
