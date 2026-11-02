import { manifestChecks } from '@appskord/config/checks';
import { describe, expect, it, vi } from 'vitest';

const V1_PERMISSIONS = ['sidePanel', 'desktopCapture', 'storage', 'unlimitedStorage', 'identity', 'activeTab', 'scripting'];

manifestChecks({
  load: () => import('./wxt.config'),
  extensionId: 'iapgbifdchhmidblniddncnagghloepi',
  permissions: V1_PERMISSIONS,
});

async function manifest() {
  vi.resetModules();
  return ((await import('./wxt.config')).default as { manifest: Record<string, unknown> }).manifest;
}

describe('hosts and shortcuts', () => {
  it('adds Google APIs as an optional host and no new required permission', async () => {
    const m = await manifest();
    expect(m.host_permissions).toEqual(['https://huggingface.co/*', 'https://*.hf.co/*']);
    expect(m.optional_host_permissions).toContain('https://www.googleapis.com/*');
  });

  it('asks for a site only when drawing is allowed on it, and adds the draw shortcut', async () => {
    const m = await manifest();
    expect(m.optional_host_permissions).toContain('<all_urls>');
    expect(m.host_permissions).not.toContain('<all_urls>');
    const commands = m.commands as Record<string, { suggested_key: { default: string }; description?: string }>;
    expect(Object.keys(commands)).toHaveLength(4);
    expect(commands['toggle-draw']?.suggested_key.default).toBe('Alt+Shift+D');
    expect(commands['toggle-draw']?.description).toBe('Draw on this page');
  });

  it('lets only Motikord message Klipkord, for the shared brand kit', async () => {
    expect((await manifest()).externally_connectable).toEqual({ ids: ['pppjklpibpnndjfddhcedbdicfdalchl'] });
  });
});
