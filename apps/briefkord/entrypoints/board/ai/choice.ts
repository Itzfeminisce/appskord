/** The picked model, known before any click, so Chrome's site prompt can be asked for first thing in that click. */
import { PROVIDERS, type CloudProviderId } from '@appskord/llm';
import type { PickerValue } from '@appskord/ui';
import { useSyncExternalStore } from 'react';
import { aiReady, defaultChoice, isAiProvider, keyNameOf, penv, requestHostAccess } from '@/lib/keys';
import { loadSettings } from '@/lib/store/settings';
import { openPanelSettings } from '../shell/panel';

export interface Choice { value: PickerValue; keyNames: string[] }

let current: Choice | undefined;
const listeners = new Set<() => void>();

async function load(): Promise<void> {
  const [keys, s] = await Promise.all([penv.loadKeys(), loadSettings()]);
  const keyNames = Object.keys(keys).filter((k) => keys[k]);
  current = { value: s.ai && isAiProvider(s.ai.provider) ? s.ai : defaultChoice(keyNames), keyNames };
  for (const l of listeners) l();
}

const reload = () => void load().catch((error: unknown) => console.error('Briefkord: could not load the AI choice', error));

/** Starts following the saved choice and keys; called once when the board page loads. */
export function followChoice(): void {
  reload();
  browser.storage.onChanged.addListener((changes, area) => {
    if ((area === 'session' && 'apiKeys' in changes) || (area === 'local' && 'settings' in changes)) reload();
  });
}

export function useChoice(): Choice | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export const providerLabel = (provider: string): string => (isAiProvider(provider) ? PROVIDERS[provider].label : provider);

const hasKey = (c: Choice | undefined): c is Choice => !!c && isAiProvider(c.value.provider) && c.keyNames.includes(keyNameOf(c.value.provider));

/** Call first in a click, before any await: Chrome's prompt for the picked provider's host, once it has a key. */
export function askHost(): Promise<boolean> | undefined {
  return hasKey(current) ? requestHostAccess(current.value.provider as CloudProviderId) : undefined;
}

export type Ready = { ok: true; provider: CloudProviderId; model: string; key: string } | { ok: false; state: 'ai-no-key' | 'ai-site-blocked'; provider: string };

/** The key and site access the run needs. `asked` is the prompt `askHost` started in the click. */
export async function getReady(asked: Promise<boolean> | undefined): Promise<Ready> {
  const r = await aiReady();
  const p = r.choice.provider;
  if (!isAiProvider(p) || !r.key) return { ok: false, state: 'ai-no-key', provider: p };
  const host = r.host || (asked ? await asked : false);
  if (!host) return { ok: false, state: 'ai-site-blocked', provider: p };
  return { ok: true, provider: p, model: r.choice.model, key: r.key };
}

/** Settings, "AI and keys", in the side panel. */
export const openAiSettings = (): void => openPanelSettings('ai');
