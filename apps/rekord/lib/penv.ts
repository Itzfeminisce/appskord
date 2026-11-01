/** Rekord's keys and Penv Cloud connection, from `@appskord/penv`. Keys stay in chrome.storage.session under `apiKeys`. */
import { createPenv, type KeyCheckRequest } from '@appskord/penv';
import { getSettings, PROVIDERS } from './settings';

export {
  formatEnvPath,
  loadKeyStatus,
  loadToken,
  loadTokenTarget,
  parseEnvPath,
  PenvAppError,
  PenvError,
  saveKeyStatus,
  type KeyResults,
  type KeyStatus,
  type PenvAppConnection,
  type PenvTarget,
} from '@appskord/penv';

export const DEEPGRAM_KEY = 'DEEPGRAM_API_KEY';

/** The cheap "who am I" request for a key name, or null when Rekord doesn't know that key. */
export function checkRequest(name: string, key: string): KeyCheckRequest | null {
  if (name === DEEPGRAM_KEY) return { url: 'https://api.deepgram.com/v1/projects', headers: { Authorization: `Token ${key}` } };
  const provider = Object.values(PROVIDERS).find((p) => p.keyName === name);
  if (!provider) return null;
  if (provider.id === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/models',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    };
  }
  return { url: `${provider.baseUrl}/models`, headers: { Authorization: `Bearer ${key}` } };
}

export const penv = createPenv({
  appName: 'Rekord',
  clientId: 'rekord',
  optionalKeys: [DEEPGRAM_KEY, 'NOTION_TOKEN'],
  keys: { kind: 'map', storageKey: 'apiKeys' },
  keyCheck: checkRequest,
  settings: getSettings,
});

export const {
  checkKeys,
  clearKeys,
  connectKeyNames,
  connectPaste,
  connectPenv,
  connectPenvApp,
  disconnectPenvApp,
  ensureKeys,
  forgetAll,
  invalidateAppLoads,
  loadKeys,
  loadPenvAppKeys,
  mergeKeys,
  reconnect,
  saveKeys,
  wasDisconnected,
} = penv;
