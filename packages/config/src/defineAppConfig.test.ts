import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineAppConfig } from './defineAppConfig';

const FAKE_KEY = 'MIIBIjANfake-public-key-for-tests';
const ICONS = { 16: 'icon/16.png', 48: 'icon/48.png' };
const base = { name: 'Demo', description: 'A demo app', publicKey: FAKE_KEY, icons: ICONS, permissions: ['storage'] };
const manifestOf = (c: unknown) => (c as { manifest: Record<string, unknown> }).manifest;

describe('defineAppConfig', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('builds the manifest from the app facts', () => {
    const m = manifestOf(defineAppConfig({ ...base, optionalHostPermissions: ['https://example.com/*'] }));
    expect(m).toMatchObject({
      key: FAKE_KEY,
      name: 'Demo',
      description: 'A demo app',
      icons: ICONS,
      permissions: ['storage'],
      optional_host_permissions: ['https://example.com/*'],
      action: { default_title: 'Open Demo', default_icon: ICONS },
    });
    expect(m.host_permissions).toBeUndefined();
  });

  it('lets WXT_EXTENSION_KEY override the key', () => {
    vi.stubEnv('WXT_EXTENSION_KEY', 'test-public-key');
    expect(manifestOf(defineAppConfig(base)).key).toBe('test-public-key');
  });

  it('leaves the key out of a store build', () => {
    vi.stubEnv('APPSKORD_STORE', '1');
    expect('key' in manifestOf(defineAppConfig(base))).toBe(false);
  });

  it('keeps extra manifest fields but never lets them replace the shared ones', () => {
    const m = manifestOf(defineAppConfig({ ...base, manifest: { commands: { go: {} }, key: 'other', name: 'Other' } }));
    expect(m.commands).toEqual({ go: {} });
    expect(m.key).toBe(FAKE_KEY);
    expect(m.name).toBe('Demo');
  });

  it('can leave the toolbar icon out and set the tooltip', () => {
    const m = manifestOf(defineAppConfig({ ...base, actionIcon: false, actionTitle: 'Record' }));
    expect(m.action).toEqual({ default_title: 'Record' });
  });

  it('drops dev-only entrypoints from a release build only', async () => {
    const infos = () => [{ name: 'check' }, { name: 'sidepanel' }] as never[];
    const run = async (argv: string[]) => {
      const original = process.argv;
      process.argv = argv;
      try {
        const config = defineAppConfig({ ...base, devOnlyEntrypoints: ['check'] });
        const list = infos();
        await (config.hooks as Record<string, (...a: unknown[]) => unknown>)['entrypoints:found']?.({}, list);
        return list.map((i: { name: string }) => i.name);
      } finally {
        process.argv = original;
      }
    };
    expect(await run(['node', 'wxt', 'build'])).toEqual(['check', 'sidepanel']);
    expect(await run(['node', 'wxt', 'zip'])).toEqual(['sidepanel']);
  });

  it("runs the app's own entrypoints:found hook after the shared one", async () => {
    const seen: string[] = [];
    const config = defineAppConfig({
      ...base,
      wxt: { hooks: { 'entrypoints:found': (_w, list) => void seen.push(...list.map((i) => i.name)) } },
    });
    await (config.hooks as Record<string, (...a: unknown[]) => unknown>)['entrypoints:found']?.({}, [{ name: 'a' }]);
    expect(seen).toEqual(['a']);
  });
});
