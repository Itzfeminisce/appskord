import { manifestChecks } from '@appskord/config/checks';
import { describe, expect, it, vi } from 'vitest';

const PERMISSIONS = ['sidePanel', 'storage', 'tabCapture', 'offscreen', 'activeTab', 'identity', 'alarms', 'notifications'];
const OPTIONAL_HOSTS = [
  'https://penv.cloud/*',
  'https://api.groq.com/*',
  'https://api.openai.com/*',
  'https://openrouter.ai/*',
  'https://api.anthropic.com/*',
  'https://generativelanguage.googleapis.com/*',
  'https://api.x.ai/*',
  'https://api.deepgram.com/*',
  'wss://api.deepgram.com/*',
  'https://api.notion.com/*',
  'https://www.googleapis.com/*',
  'https://oauth2.googleapis.com/*',
  'https://tasks.googleapis.com/*',
  'https://api.linear.app/*',
  'http://localhost:11434/*',
  'https://huggingface.co/*',
  'https://cdn-lfs.huggingface.co/*',
  'https://cdn-lfs-us-1.hf.co/*',
  'https://cas-bridge.xethub.hf.co/*',
  'https://cdn-lfs.hf.co/*',
  'https://cdn-lfs-eu-1.hf.co/*',
];

manifestChecks({
  load: () => import('./wxt.config'),
  extensionId: 'flkicdahoghegnlgpkmdcemlooblblcd',
  permissions: PERMISSIONS,
});

async function manifest() {
  vi.resetModules();
  return ((await import('./wxt.config')).default as { manifest: Record<string, unknown> }).manifest;
}

describe('hosts', () => {
  it('asks for every service host only when its feature is turned on', async () => {
    const m = await manifest();
    expect(m.host_permissions).toBeUndefined();
    expect([...(m.optional_host_permissions as string[])].sort()).toEqual([...OPTIONAL_HOSTS].sort());
  });

  it('signs in to Google with launchWebAuthFlow, not a manifest oauth2 client', async () => {
    expect((await manifest()).oauth2).toBeUndefined();
  });

  it('goes off the record with Alt+Shift+O', async () => {
    expect((await manifest()).commands).toEqual({ 'off-record': { suggested_key: { default: 'Alt+Shift+O' }, description: 'Off the record' } });
  });

  it('lets the search model compile WebAssembly and nothing remote', async () => {
    expect((await manifest()).content_security_policy).toEqual({ extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" });
  });
});
