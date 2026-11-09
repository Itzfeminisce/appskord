import { defineAppConfig, isRelease } from '@appskord/config';

// Motikord's public key fixes the extension id (pppjklpibpnndjfddhcedbdicfdalchl); the private key stays with the owner.
const MOTIKORD_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAj1r5lVPbTxJ2yXbfsW5/d0CffTORqCzBsYZFXYFmtwjutPfnIqenqtFChRPLwMAkrmQZ9J+v38bIGHjrsTz7HOkl+x+qhBj7KGlDeWmdBWISeNowFbFb92o6uHxcY3gQG1bzP59/VO7uZvtcSllWW5o0WVtWmBmIIVTYRtCSLvMF73qCXOmgUROIDtlnw67CRM+7sG+jMI/lFPywScKGVl/qIDbyM+AGU1qzuajZwunxH8NYBIQqPH6/dP3i0Y1s6B5Wikf9dio52bYP8IPspm9hQDoAbMvqioHKJDzvWMQe3F9y49da+yU5B2l6knS9w4rfGMIEdKBiWc654jIGcwIDAQAB';

export default defineAppConfig({
  name: 'Motikord',
  description: 'Short animated clips, made on your computer',
  publicKey: MOTIKORD_KEY,
  icons: { 16: 'icon/16.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  // activeTab + scripting run the page picker (T6) only in the tab you grab from.
  permissions: ['sidePanel', 'storage', 'unlimitedStorage', 'activeTab', 'scripting', 'identity'],
  // Asked for only when first used: Penv Cloud, Groq, the media libraries and the hosts their files come from.
  optionalHostPermissions: [
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
    // Media sources: the built-in search APIs and the hosts their files come from.
    'https://commons.wikimedia.org/*',
    'https://images-api.nasa.gov/*',
    'https://images-assets.nasa.gov/*',
    'https://collectionapi.metmuseum.org/*',
    'https://api.artic.edu/*',
    'https://www.artic.edu/*',
    'https://pixabay.com/*',
    'https://cdn.pixabay.com/*',
    'https://freesound.org/*',
    'https://api.unsplash.com/*',
    'https://images.unsplash.com/*',
    // The side panel gets no activeTab, so Grab asks for the page you are on (one site at a time, never all sites at once).
    'https://*/*',
    'http://*/*',
  ],
  devOnlyEntrypoints: ['check'],
  // Rapier and dotLottie compile their bundled wasm; MV3 blocks that without 'wasm-unsafe-eval'.
  manifest: { content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" } },
  // Dev tools (screen switcher, #/dev/<frame>, check link) ship in dev and `npm run build`, never in the release zip.
  wxt: { vite: () => ({ define: { __MOTIKORD_DEV_TOOLS__: JSON.stringify(!isRelease()) } }) },
});
