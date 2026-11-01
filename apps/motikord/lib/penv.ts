/**
 * Motikord's keys and Penv Cloud connection, from `@appskord/penv`. Each key keeps its own chrome.storage.session
 * entry under its settings.ts KeyName (getKey/setKey), so a restart of Chrome forgets them.
 */
import { createPenv } from '@appskord/penv';
import type { KeyName } from './settings';

export { PenvAppError, PenvError, type PenvAppConnection, type PenvTarget } from '@appskord/penv';

const NAMES: Record<string, KeyName> = {
  GROQ_API_KEY: 'groq', OPENAI_API_KEY: 'openai', ANTHROPIC_API_KEY: 'anthropic', OPENROUTER_API_KEY: 'openrouter', PEXELS_API_KEY: 'pexels',
  PIXABAY_API_KEY: 'pixabay', FREESOUND_API_KEY: 'freesound', JAMENDO_CLIENT_ID: 'jamendo', UNSPLASH_ACCESS_KEY: 'unsplash',
};

export const penv = createPenv({
  appName: 'Motikord',
  clientId: 'motikord',
  optionalKeys: Object.keys(NAMES),
  keys: { kind: 'names', names: NAMES },
});

export const {
  clearKeys,
  connectKeyNames,
  connectPenvApp,
  disconnectPenvApp,
  loadKeys,
  loadPenvAppKeys,
  mergeKeys,
  restoreKeys,
  saveKeys,
  wasDisconnected,
} = penv;
