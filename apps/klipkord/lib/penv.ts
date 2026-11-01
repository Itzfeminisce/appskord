/** Klipkord's keys and Penv Cloud connection, from `@appskord/penv`. Keys stay in chrome.storage.session under `apiKeys`. */
import { createPenv, type KeyCheckRequest } from '@appskord/penv';
import { PROVIDERS } from './llm';
import { getSettings } from './settings';

export {
  loadKeyStatus,
  PenvAppError,
  PenvError,
  requestHosts,
  saveKeyStatus,
  type KeyResults,
  type KeyStatus,
  type PenvAppConnection,
  type PenvTarget,
} from '@appskord/penv';

export const penv = createPenv({
  appName: 'Klipkord',
  clientId: 'klipkord',
  keys: { kind: 'map', storageKey: 'apiKeys' },
  // The cheap "who am I" request for a key name, or null when Klipkord doesn't know that key.
  keyCheck: (name, key): KeyCheckRequest | null => {
    const provider = Object.values(PROVIDERS).find((p) => p.keyName === name);
    if (!provider) return null;
    if (provider.id === 'anthropic') {
      return {
        url: 'https://api.anthropic.com/v1/models',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      };
    }
    return { url: `${provider.baseUrl}/models`, headers: { Authorization: `Bearer ${key}` } };
  },
  settings: getSettings,
});

export const {
  checkKeys,
  clearKeys,
  connectKeyNames,
  connectPaste,
  connectPenvApp,
  disconnectPenvApp,
  ensureKeys,
  forgetAll,
  invalidateAppLoads,
  loadKeys,
  loadPenvAppKeys,
  mergeKeys,
  saveKeys,
  wasDisconnected,
} = penv;
