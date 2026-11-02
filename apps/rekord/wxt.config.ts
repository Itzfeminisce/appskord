import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineAppConfig, isRelease } from '@appskord/config';
import { OPTIONAL_HOSTS } from './lib/hosts';

// Rekord's public key fixes the extension id (flkicdahoghegnlgpkmdcemlooblblcd) for Penv Cloud, Google and the Web Store.
// It is public; the private key stays with the owner and is uploaded once, with the first Web Store zip. See docs/GOOGLE.md.
const REKORD_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxVukoIgjV4ZMhNpHu0gGwWj3T9fsPlEzpUnSlHRscU581QJSGsLB3EpXnbZzsRE1TCKwxvmenqgD81uKsZ64bwUlNHvM9ekXB8IVaooXgmSm0wQzTitR6tRYoXRHJyjpQp1pxvYEnZlBaDbvNQhfaLKPMJWoeR6RT7tTMm5vObdEEr8eNEvkCRSSPewdzIgh0MC40F1jBHUbXYpWSxhfPKHxjoCvScqc+5c/J8gE6DrYqLNBWk2i5g6sNtZvUK+zsDEAHH4ONaSUbdkgJOTfXe0mzE1iEaUZZYNIZQFDKE3YYPbDOkliGq/viwwfikycvri8WxHFTdR9y2MRTssOjwIDAQAB';

const fromTransformers = createRequire(createRequire(import.meta.url).resolve('@huggingface/transformers'));
const ORT_DIR = dirname(fromTransformers.resolve('onnxruntime-web/wasm'));
const ORT_FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

export default defineAppConfig({
  name: 'Rekord',
  description: 'Personal AI meeting note taker',
  publicKey: REKORD_KEY,
  icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  permissions: ['sidePanel', 'storage', 'tabCapture', 'offscreen', 'activeTab', 'identity', 'alarms'],
  // Requested only when the user turns on Penv Cloud, a cloud AI key, Deepgram, Google, Notion or Ollama (lib/hosts.ts).
  optionalHostPermissions: OPTIONAL_HOSTS,
  // The search model's ONNX runtime compiles WebAssembly (lib/recall/worker.ts).
  manifest: { content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" } },
  wxt: {
    // WASM-only ONNX runtime (no WebGPU on the target laptop); the worker is an ES module so it can split chunks.
    vite: () => ({
      resolve: { alias: [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }] },
      worker: { format: 'es' },
      // Dev frame routes (`#/dev/<Frame>`) are left out of the release zip.
      define: { __REKORD_DEV_FRAMES__: JSON.stringify(!isRelease()) },
    }),
    hooks: {
      // MV3 forbids remote code, so the runtime's loader and .wasm ship in the extension under ort/.
      'build:publicAssets': (_wxt, files) => {
        for (const f of ORT_FILES) files.push({ absoluteSrc: join(ORT_DIR, f), relativeDest: `ort/${f}` });
      },
    },
  },
});
