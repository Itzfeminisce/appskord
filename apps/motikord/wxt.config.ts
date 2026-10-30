import { defineConfig } from 'wxt';

// Motikord's public key fixes the extension id (pppjklpibpnndjfddhcedbdicfdalchl); the private key stays with the owner.
const MOTIKORD_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAj1r5lVPbTxJ2yXbfsW5/d0CffTORqCzBsYZFXYFmtwjutPfnIqenqtFChRPLwMAkrmQZ9J+v38bIGHjrsTz7HOkl+x+qhBj7KGlDeWmdBWISeNowFbFb92o6uHxcY3gQG1bzP59/VO7uZvtcSllWW5o0WVtWmBmIIVTYRtCSLvMF73qCXOmgUROIDtlnw67CRM+7sG+jMI/lFPywScKGVl/qIDbyM+AGU1qzuajZwunxH8NYBIQqPH6/dP3i0Y1s6B5Wikf9dio52bYP8IPspm9hQDoAbMvqioHKJDzvWMQe3F9y49da+yU5B2l6knS9w4rfGMIEdKBiWc654jIGcwIDAQAB';
const extensionKey = process.env.WXT_EXTENSION_KEY || MOTIKORD_KEY;
// Release = `wxt zip` or `--mode release`.
const release = process.argv.includes('zip') || process.argv.includes('release');

const ICONS = { 16: 'icon/16.png', 48: 'icon/48.png', 128: 'icon/128.png' };

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Dev tools (screen switcher, ?screen=, check link) ship in dev and `npm run build`, never in the release zip.
  vite: () => ({ define: { __MOTIKORD_DEV_TOOLS__: JSON.stringify(!release) } }),
  hooks: {
    // The machine check is a developer page; it stays out of the release zip.
    'entrypoints:found': (_wxt, infos) => {
      if (!release) return;
      const at = infos.findIndex((info) => info.name === 'check');
      if (at >= 0) infos.splice(at, 1);
    },
  },
  manifest: {
    key: extensionKey,
    name: 'Motikord',
    description: 'Short animated clips, made on your computer',
    icons: ICONS,
    // activeTab + scripting run the page picker (T6) only in the tab you grab from.
    permissions: ['sidePanel', 'storage', 'unlimitedStorage', 'activeTab', 'scripting', 'identity'],
    // Asked for only when first used: Penv Cloud, Groq, the media libraries and the hosts their files come from.
    optional_host_permissions: [
      'https://penv.cloud/*',
      'https://api.groq.com/*',
      'https://api.openverse.org/*',
      'https://api.pexels.com/*',
      'https://images.pexels.com/*',
      'https://videos.pexels.com/*',
      // Openverse lists files that live on their source sites.
      'https://*.staticflickr.com/*',
      'https://upload.wikimedia.org/*',
      'https://cdn.freesound.org/*',
      'https://*.jamendo.com/*',
      'https://ccmixter.org/*',
      'https://images.metmuseum.org/*',
      'https://images.rawpixel.com/*',
      'https://cdn.stocksnap.io/*',
      'https://files.freemusicarchive.org/*',
      'https://archive.org/*',
      'https://*.archive.org/*',
      'https://lh3.googleusercontent.com/*',
      'https://player.vimeo.com/*',
      // The side panel gets no activeTab, so Grab asks for the page you are on (one site at a time, never all sites at once).
      'https://*/*',
      'http://*/*',
    ],
    action: { default_title: 'Open Motikord', default_icon: ICONS },
  },
});
