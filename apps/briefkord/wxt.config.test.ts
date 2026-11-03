import { manifestChecks } from '@appskord/config/checks';
import { describe, expect, it, vi } from 'vitest';

const PERMISSIONS = ['sidePanel', 'storage', 'unlimitedStorage', 'activeTab', 'scripting', 'contextMenus'];
const OPTIONAL_HOSTS = [
  'https://penv.cloud/*',
  'https://api.groq.com/*',
  'https://api.openai.com/*',
  'https://api.anthropic.com/*',
  'https://openrouter.ai/*',
  'https://generativelanguage.googleapis.com/*',
  'https://api.x.ai/*',
  'http://localhost:11434/*',
];

manifestChecks({
  load: () => import('./wxt.config'),
  extensionId: 'ghbafbelhbkgelfckkdkaclkjmidepea',
  permissions: PERMISSIONS,
});

async function manifest() {
  vi.resetModules();
  return ((await import('./wxt.config')).default as { manifest: Record<string, unknown> }).manifest;
}

describe('hosts', () => {
  it('asks for no host at install and only the AI providers and Penv Cloud later', async () => {
    const m = await manifest();
    expect(m.host_permissions).toBeUndefined();
    expect([...(m.optional_host_permissions as string[])].sort()).toEqual([...OPTIONAL_HOSTS].sort());
  });

  it('names the app and says what it is for', async () => {
    const m = await manifest();
    expect(m.name).toBe('Briefkord');
    expect(m.description).toBe('One board for every meeting');
  });
});
