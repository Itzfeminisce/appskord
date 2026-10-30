import { defineConfig } from 'wxt';

// Motikord's public key fixes the extension id (pppjklpibpnndjfddhcedbdicfdalchl); the private key stays with the owner.
const MOTIKORD_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAj1r5lVPbTxJ2yXbfsW5/d0CffTORqCzBsYZFXYFmtwjutPfnIqenqtFChRPLwMAkrmQZ9J+v38bIGHjrsTz7HOkl+x+qhBj7KGlDeWmdBWISeNowFbFb92o6uHxcY3gQG1bzP59/VO7uZvtcSllWW5o0WVtWmBmIIVTYRtCSLvMF73qCXOmgUROIDtlnw67CRM+7sG+jMI/lFPywScKGVl/qIDbyM+AGU1qzuajZwunxH8NYBIQqPH6/dP3i0Y1s6B5Wikf9dio52bYP8IPspm9hQDoAbMvqioHKJDzvWMQe3F9y49da+yU5B2l6knS9w4rfGMIEdKBiWc654jIGcwIDAQAB';
const extensionKey = process.env.WXT_EXTENSION_KEY || MOTIKORD_KEY;
// Release = `wxt zip` or `--mode release`.
const release = process.argv.includes('zip') || process.argv.includes('release');

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
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
    permissions: ['storage', 'unlimitedStorage'],
    action: { default_title: 'Open Motikord' },
  },
});
