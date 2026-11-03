/** Briefkord's AI keys and model choice. Keys live only in `chrome.storage.session` (`apiKeys`), through `@appskord/penv`. */
import { checkRequest, isProviderKeyName, PROVIDERS, SUGGESTED, type CloudProviderId } from '@appskord/llm';
import { createPenv, requestHosts, type PenvAppConnection, type PenvSettings } from '@appskord/penv';
import type { PickerValue } from '@appskord/ui';
import { loadSettings } from './store/settings';

export { PenvAppError, requestHosts, type PenvAppConnection } from '@appskord/penv';

/** The cloud providers, in the shared picker order. Briefkord has no on-this-computer model. */
export const AI_PROVIDERS: CloudProviderId[] = ['groq', 'openai', 'anthropic', 'google', 'xai', 'openrouter'];

export const keyNameOf = (provider: CloudProviderId): string => PROVIDERS[provider].keyName!;

export const isAiProvider = (id: string): id is CloudProviderId => (AI_PROVIDERS as string[]).includes(id);

/** The Penv Cloud connection (names only, no secrets) in `chrome.storage.local`. */
const CONNECTION_KEY = 'penvConnection';

export async function loadPenvConnection(): Promise<PenvAppConnection | undefined> {
  const stored = (await browser.storage.local.get(CONNECTION_KEY))[CONNECTION_KEY] as PenvAppConnection | undefined;
  return stored?.connectionId ? stored : undefined;
}

export async function savePenvConnection(conn: PenvAppConnection | undefined): Promise<void> {
  if (conn) await browser.storage.local.set({ [CONNECTION_KEY]: conn });
  else await browser.storage.local.remove(CONNECTION_KEY);
}

async function penvSettings(): Promise<PenvSettings> {
  const conn = await loadPenvConnection();
  return conn ? { keySource: 'penv-app', penvApp: conn } : {};
}

export const penv = createPenv({
  appName: 'Briefkord',
  clientId: 'briefkord',
  keys: { kind: 'map', storageKey: 'apiKeys' },
  keyCheck: (name, key) => (isProviderKeyName(name) ? checkRequest(name, key) : null),
  settings: penvSettings,
});

/** Every provider key, asked for when connecting Penv Cloud. */
export const AI_KEY_NAMES = AI_PROVIDERS.map(keyNameOf);

/** Names of the AI keys in memory, never values. Reloads them from Penv Cloud first when only the grant is left. */
export async function loadedKeyNames(): Promise<string[]> {
  await penv.ensureKeys();
  const keys = await penv.loadKeys();
  return AI_KEY_NAMES.filter((name) => keys[name]);
}

/** The choice when none is saved: the first provider with a key, else the first provider, with its suggested model. */
export function defaultChoice(keyNames: readonly string[]): PickerValue {
  const provider = AI_PROVIDERS.find((p) => keyNames.includes(keyNameOf(p))) ?? AI_PROVIDERS[0]!;
  return { provider, model: SUGGESTED[provider].chat?.[0] ?? '' };
}

/** The picked provider and model (Settings, "AI and keys"); the default when nothing is picked yet. */
export async function aiChoice(): Promise<PickerValue> {
  const { ai } = await loadSettings();
  if (ai && isAiProvider(ai.provider)) return ai;
  return defaultChoice(await loadedKeyNames());
}

/** The key for `provider` from this browser session, or undefined. Never log or show it. */
export async function aiKey(provider: string): Promise<string | undefined> {
  if (!isAiProvider(provider)) return undefined;
  await penv.ensureKeys();
  return (await penv.loadKeys())[keyNameOf(provider)] || undefined;
}

/** The host pattern Chrome must allow before Briefkord calls the provider. */
export const hostOf = (provider: CloudProviderId): string => `https://${PROVIDERS[provider].host}/*`;

export async function hasHostAccess(provider: CloudProviderId): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [hostOf(provider)] });
  } catch {
    return false;
  }
}

/** Shows Chrome's prompt for the provider's host only. Call it first thing in a click, before any other await. */
export function requestHostAccess(provider: CloudProviderId): Promise<boolean> {
  return requestHosts([hostOf(provider)]);
}

export interface AiReady {
  choice: PickerValue;
  key?: string;
  /** Chrome lets Briefkord reach the provider's host. */
  host: boolean;
}

/** Everything an AI action needs before it runs: the choice, its key (if any) and whether its host is allowed. */
export async function aiReady(): Promise<AiReady> {
  const choice = await aiChoice();
  if (!isAiProvider(choice.provider)) return { choice, host: false };
  const [key, host] = await Promise.all([aiKey(choice.provider), hasHostAccess(choice.provider)]);
  return { choice, ...(key ? { key } : {}), host };
}
