import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { broadHosts, extensionId, manifestChecks } from './checks';
import { defineAppConfig } from './defineAppConfig';

// A fake key: valid base64 that starts like a real public key. Never a real key.
const FAKE_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCfake-key-for-tests-only';

function pngOf(size: number): Buffer {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(size, 16);
  png.writeUInt32BE(size, 20);
  return png;
}

const dir = mkdtempSync(join(tmpdir(), 'appskord-config-'));
mkdirSync(join(dir, 'icon'));
writeFileSync(join(dir, 'icon/16.png'), pngOf(16));
writeFileSync(join(dir, 'icon/48.png'), pngOf(48));

const demo = () =>
  defineAppConfig({
    name: 'Demo',
    description: 'A demo app',
    publicKey: FAKE_KEY,
    icons: { 16: 'icon/16.png', 48: 'icon/48.png' },
    permissions: ['storage', 'activeTab'],
    optionalHostPermissions: ['https://*/*'],
    hostPermissions: ['https://huggingface.co/*'],
  });

describe('helpers', () => {
  it('derives an id of 32 letters a to p, stable per key', () => {
    const id = extensionId(FAKE_KEY);
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(extensionId(FAKE_KEY)).toBe(id);
    expect(extensionId(`${FAKE_KEY}x`)).not.toBe(id);
  });

  it('finds broad hosts and ignores specific ones', () => {
    expect(broadHosts(['<all_urls>', 'https://a.com/*', 'http://*/*'])).toEqual(['<all_urls>', 'http://*/*']);
    expect(broadHosts(undefined)).toEqual([]);
  });
});

// The shared checks run against a fake app, the way an app calls them.
manifestChecks({
  load: async () => ({ default: demo() }),
  extensionId: extensionId(FAKE_KEY),
  permissions: ['storage', 'activeTab'],
  publicDir: dir,
});
