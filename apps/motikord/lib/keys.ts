/**
 * Keys by their Penv Cloud names (GROQ_API_KEY, PEXELS_API_KEY). They live only in chrome.storage.session,
 * through the getKey/setKey names in settings.ts, so a restart of Chrome forgets them.
 */
import { clearKey, getKey, setKey, type KeyName } from './settings';

const NAMES: Record<string, KeyName> = { GROQ_API_KEY: 'groq', PEXELS_API_KEY: 'pexels' };

export async function saveKeys(keys: Record<string, string>): Promise<void> {
  await Promise.all(Object.entries(keys).map(([name, value]) => (NAMES[name] ? setKey(NAMES[name]!, value) : undefined)));
}

export async function loadKeys(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, key] of Object.entries(NAMES)) {
    const value = await getKey(key);
    if (value) out[name] = value;
  }
  return out;
}

export async function clearKeys(): Promise<void> {
  await Promise.all(Object.values(NAMES).map((key) => clearKey(key)));
}

/** Adds keys to the ones already in memory; a key that is not in `keys` is left alone. */
export async function mergeKeys(keys: Record<string, string>): Promise<void> {
  await saveKeys(keys);
}
