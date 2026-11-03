import { MOTIKORD_ID } from '@appskord/brand';
import { defineAppConfig } from '@appskord/config';

// Klipkord's public key fixes the extension id (iapgbifdchhmidblniddncnagghloepi) for Penv Cloud, Google and the Web Store.
// It is public; the private key stays with the owner and is uploaded once, with the first Web Store zip.
const KLIPKORD_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsgE5EguZ5k4ildTMikSj16eCiu4JLqrcIcvovWNeR7f5AYXIeaZmunEwQm1S+f0f02OrkjTGjqnN5kWi9spIk+uhVIYYpT7Jn38uE9g51/0Gz8dgPeFpQnW8xdC6YJMjLangx8C1U5izTRWK7GuGl6ORDC7GsBLlcMZsajhbhBozCfVsmvBEujinqr/b/nIY/OvMTVlnMkGTSDA+8OT0SKoSPm9F742wITYjkSrbG4XRqrmRxYGebR6oi6pQ1e+LGkcjragX/KuiM3qgI7/YGRkRCspV0IG1L7x8THxYF8mn8gA6weVIWNo6BkuS1cpzUGDhnbpXc86NBoO6DVpKewIDAQAB';

export default defineAppConfig({
  name: 'Klipkord',
  description: 'Screen recorder in the Chrome side panel',
  publicKey: KLIPKORD_KEY,
  // No `icons` shipped before; WXT found these in public/icon. Listed so the built manifest stays the same.
  icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  // activeTab (granted by a shortcut) + scripting draw the marker toast in the active tab.
  permissions: ['sidePanel', 'desktopCapture', 'storage', 'unlimitedStorage', 'identity', 'activeTab', 'scripting'],
  // The Whisper check fetches models from Hugging Face, which redirects to its CDN hosts.
  hostPermissions: ['https://huggingface.co/*', 'https://*.hf.co/*'],
  // Requested only when the user turns on Penv Cloud, a cloud key, Ollama or Google Drive, or allows drawing on a site.
  optionalHostPermissions: [
    'https://penv.cloud/*',
    'https://api.groq.com/*',
    'https://openrouter.ai/*',
    'https://api.openai.com/*',
    'https://api.anthropic.com/*',
    'https://api.x.ai/*',
    'https://generativelanguage.googleapis.com/*',
    'http://localhost:11434/*',
    'https://www.googleapis.com/*',
    '<all_urls>',
  ],
  actionIcon: false,
  devOnlyEntrypoints: ['check'],
  manifest: {
    commands: {
      'toggle-recording': { suggested_key: { default: 'Alt+Shift+R' }, description: 'Start or stop recording' },
      'toggle-pause': { suggested_key: { default: 'Alt+Shift+P' }, description: 'Pause or resume recording' },
      'add-marker': { suggested_key: { default: 'Alt+Shift+M' }, description: 'Add a marker' },
      'toggle-draw': { suggested_key: { default: 'Alt+Shift+D' }, description: 'Draw on this page' },
    },
    // Only Motikord may message Klipkord from outside, to share the brand kit.
    externally_connectable: { ids: [MOTIKORD_ID] },
    // ONNX Runtime compiles its bundled wasm; MV3 blocks that without 'wasm-unsafe-eval'.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
