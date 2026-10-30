import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const V1_PERMISSIONS = ['sidePanel', 'storage', 'unlimitedStorage', 'activeTab', 'scripting'];
const OPTIONAL_HOSTS = [
  'https://penv.cloud/*',
  'https://api.groq.com/*',
  'https://api.openverse.org/*',
  'https://api.pexels.com/*',
  'https://images.pexels.com/*',
  'https://videos.pexels.com/*',
];
const OPENVERSE_MEDIA_HOSTS = ['https://*.staticflickr.com/*', 'https://upload.wikimedia.org/*', 'https://cdn.freesound.org/*', 'https://*.jamendo.com/*', 'https://ccmixter.org/*'];

async function manifest() {
  vi.resetModules();
  // Typed loosely: the config's manifest field also allows a function form.
  return ((await import('./wxt.config')).default as { manifest: Record<string, unknown> }).manifest;
}

/** Chrome's extension id: the first 128 bits of SHA-256 of the public key, as letters a to p. */
function extensionId(publicKey: string): string {
  const hex = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
}

describe('manifest', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('fixes the extension id with Motikord\'s public key', async () => {
    expect(extensionId((await manifest()).key as string)).toBe('pppjklpibpnndjfddhcedbdicfdalchl');
  });

  it('puts the extension key in manifest.key', async () => {
    vi.stubEnv('WXT_EXTENSION_KEY', 'test-public-key');
    expect((await manifest()).key).toBe('test-public-key');
  });

  it('asks only for the v1 permissions and no required hosts', async () => {
    const m = await manifest();
    expect(m.permissions).toEqual(V1_PERMISSIONS);
    expect(m.host_permissions).toBeUndefined();
  });

  it('lists every library, AI and media host as optional', async () => {
    const hosts = (await manifest()).optional_host_permissions as string[];
    expect(hosts).toEqual([...OPTIONAL_HOSTS, ...OPENVERSE_MEDIA_HOSTS]);
    expect(hosts).not.toContain('<all_urls>');
  });

  it('has the Icon frame at 16, 48 and 128 px, on the toolbar too', async () => {
    const m = await manifest();
    const icons = m.icons as Record<string, string>;
    expect(Object.keys(icons)).toEqual(['16', '48', '128']);
    expect((m.action as { default_icon: unknown }).default_icon).toEqual(icons);
    for (const [size, path] of Object.entries(icons)) {
      const file = `public/${path}`;
      expect(existsSync(file)).toBe(true);
      const png = readFileSync(file);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([Number(size), Number(size)]);
    }
  });
});
