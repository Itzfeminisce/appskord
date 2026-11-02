import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Match-all patterns that must never be a required host. */
export const BROAD_HOSTS = ['<all_urls>', '*://*/*', 'https://*/*', 'http://*/*', 'file:///*'];

type Manifest = Record<string, unknown>;

/** Chrome's extension id: the first 128 bits of SHA-256 of the public key, written with the letters a to p. */
export function extensionId(publicKey: string): string {
  const hex = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
}

/** The broad patterns in a required-hosts list. */
export function broadHosts(hosts: unknown): string[] {
  return Array.isArray(hosts) ? hosts.filter((h): h is string => BROAD_HOSTS.includes(h)) : [];
}

export interface ManifestChecksOptions {
  /** Loads the app's `wxt.config` default export, e.g. `() => import('./wxt.config')`. */
  load: () => Promise<{ default: unknown }>;
  /** The id the app has shipped with. */
  extensionId: string;
  /** The exact permission list the app asks for at install. */
  permissions: string[];
  /** Folder holding the icon files, relative to the app. Default `public`. Pass `false` to skip the icon check. */
  publicDir?: string | false;
}

/** The shared `wxt.config.test.ts` checks. Each app calls this from its own test file, run from the app folder. */
export function manifestChecks(options: ManifestChecksOptions): void {
  async function manifest(): Promise<Manifest> {
    vi.resetModules();
    return ((await options.load()).default as { manifest: Manifest }).manifest;
  }

  // The first test cold-imports wxt, which can take over 5 s while every app's tests run in parallel.
  describe('manifest', { timeout: 30_000 }, () => {
    afterEach(() => vi.unstubAllEnvs());

    it('has a public key and derives the shipped extension id from it', async () => {
      const key = (await manifest()).key;
      expect(typeof key).toBe('string');
      expect(key).toMatch(/^MIIBIjAN/);
      expect(extensionId(key as string)).toBe(options.extensionId);
    });

    it('puts WXT_EXTENSION_KEY in manifest.key when set', async () => {
      vi.stubEnv('WXT_EXTENSION_KEY', 'test-public-key');
      expect((await manifest()).key).toBe('test-public-key');
    });

    it('asks for exactly the listed permissions', async () => {
      expect((await manifest()).permissions).toEqual(options.permissions);
    });

    it('asks for no broad host at install', async () => {
      const m = await manifest();
      expect(broadHosts(m.host_permissions)).toEqual([]);
      expect(m.permissions).not.toContain('<all_urls>');
    });

    const publicDir = options.publicDir ?? 'public';
    if (publicDir !== false) {
      it('has its icons on disk at the right size, on the toolbar too', async () => {
        const m = await manifest();
        const icons = m.icons as Record<string, string>;
        const action = m.action as { default_icon?: unknown } | undefined;
        if (action?.default_icon) expect(action.default_icon).toEqual(icons);
        for (const [size, path] of Object.entries(icons)) {
          const file = join(publicDir, path);
          expect(existsSync(file)).toBe(true);
          const png = readFileSync(file);
          expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([Number(size), Number(size)]);
        }
      });
    }
  });
}
