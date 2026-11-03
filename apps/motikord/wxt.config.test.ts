import { manifestChecks } from '@appskord/config/checks';
import { describe, expect, it, vi } from 'vitest';

const V1_PERMISSIONS = ['sidePanel', 'storage', 'unlimitedStorage', 'activeTab', 'scripting', 'identity'];
const OPTIONAL_HOSTS = [
  'https://penv.cloud/*',
  'https://api.groq.com/*',
  'https://api.openai.com/*',
  'https://api.anthropic.com/*',
  'https://openrouter.ai/*',
  'https://api.x.ai/*',
  'https://generativelanguage.googleapis.com/*',
  'https://api.openverse.org/*',
  'https://api.pexels.com/*',
  'https://images.pexels.com/*',
  'https://videos.pexels.com/*',
];
const OPENVERSE_MEDIA_HOSTS = ['https://*.staticflickr.com/*', 'https://upload.wikimedia.org/*', 'https://cdn.freesound.org/*', 'https://*.jamendo.com/*', 'https://ccmixter.org/*', 'https://images.metmuseum.org/*', 'https://images.rawpixel.com/*', 'https://cdn.stocksnap.io/*', 'https://files.freemusicarchive.org/*', 'https://archive.org/*', 'https://*.archive.org/*', 'https://lh3.googleusercontent.com/*', 'https://player.vimeo.com/*'];
const SOURCE_HOSTS = ['https://commons.wikimedia.org/*', 'https://images-api.nasa.gov/*', 'https://images-assets.nasa.gov/*', 'https://collectionapi.metmuseum.org/*', 'https://api.artic.edu/*', 'https://www.artic.edu/*', 'https://pixabay.com/*', 'https://cdn.pixabay.com/*', 'https://freesound.org/*', 'https://api.unsplash.com/*', 'https://images.unsplash.com/*'];
const PAGE_HOSTS = ['https://*/*', 'http://*/*'];

manifestChecks({
  load: () => import('./wxt.config'),
  extensionId: 'pppjklpibpnndjfddhcedbdicfdalchl',
  permissions: V1_PERMISSIONS,
});

async function manifest() {
  vi.resetModules();
  return ((await import('./wxt.config')).default as { manifest: Record<string, unknown> }).manifest;
}

describe('hosts', () => {
  it('asks for no required hosts', async () => {
    expect((await manifest()).host_permissions).toBeUndefined();
  });

  it('lists every library, AI and media host as optional', async () => {
    const hosts = (await manifest()).optional_host_permissions as string[];
    expect(hosts).toEqual([...OPTIONAL_HOSTS, ...OPENVERSE_MEDIA_HOSTS, ...SOURCE_HOSTS, ...PAGE_HOSTS]);
    expect(hosts).not.toContain('<all_urls>');
  });

  it('has the Icon frame at 16, 48 and 128 px', async () => {
    expect(Object.keys((await manifest()).icons as Record<string, string>)).toEqual(['16', '48', '128']);
  });
});
