/** Recognises a pasted key by its prefix and checks it with the service. Never logs or returns the value itself. */
import { authHeaders, PROVIDER_API } from './llm';
import { PROVIDERS, providerForKey } from './providers';

export type ProviderKeyName = 'GROQ_API_KEY' | 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'OPENROUTER_API_KEY';
export type EnvKeyName = ProviderKeyName | 'PEXELS_API_KEY';

/** Pexels keys have no prefix: 56 letters and digits. */
const PEXELS_SHAPE = /^[A-Za-z0-9]{40,64}$/;

export type KeyField = 'main' | 'pexels';

// Longest prefix first: sk-ant- and sk-or- keys also start with OpenAI's sk-.
const PREFIXES: [string, ProviderKeyName][] = [['gsk_', 'GROQ_API_KEY'], ['sk-ant-', 'ANTHROPIC_API_KEY'], ['sk-or-', 'OPENROUTER_API_KEY'], ['sk-', 'OPENAI_API_KEY']];
const SHAPES: Record<ProviderKeyName, RegExp> = {
  GROQ_API_KEY: /^gsk_[A-Za-z0-9]{20,}$/,
  ANTHROPIC_API_KEY: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  OPENROUTER_API_KEY: /^sk-or-[A-Za-z0-9_-]{20,}$/,
  OPENAI_API_KEY: /^sk-[A-Za-z0-9_-]{20,}$/,
};

/** The key name for a pasted value, or null. The bare Pexels shape counts only inside the Pexels field, never the main one. */
export function detectKey(value: string, field: KeyField = 'main'): EnvKeyName | null {
  const v = value.trim();
  if (!v) return null;
  const hit = PREFIXES.find(([prefix]) => v.startsWith(prefix));
  if (hit) return hit[1];
  if (v.startsWith('pexels_') || (field === 'pexels' && PEXELS_SHAPE.test(v))) return 'PEXELS_API_KEY';
  return null;
}

/** True when the value has the whole shape of its key, so a pause may check it. */
export function looksComplete(name: EnvKeyName, value: string): boolean {
  const v = value.trim();
  return name === 'PEXELS_API_KEY' ? PEXELS_SHAPE.test(v) || /^pexels_[A-Za-z0-9]{20,}$/.test(v) : SHAPES[name].test(v);
}

export const IDLE_MS = 600;

/** Runs `run` on paste at once, or after the value is a full key and typing has paused; never per keystroke. */
export function createKeyWatcher(run: (name: EnvKeyName, key: string) => void, field: KeyField = 'main', idleMs = IDLE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  return {
    cancel,
    paste(value: string) {
      cancel();
      const name = detectKey(value, field);
      if (name) run(name, value);
    },
    type(value: string) {
      cancel();
      const name = detectKey(value, field);
      if (name && looksComplete(name, value)) timer = setTimeout(() => run(name, value), idleMs);
    },
  };
}

/** The service's display name for a key name ("Groq"); unknown names come back unchanged. */
export function serviceLabel(name: string): string {
  if (name === 'PEXELS_API_KEY') return 'Pexels';
  const p = providerForKey(name);
  return p ? PROVIDERS[p].label : name;
}

export type KeyCheck = 'ready' | 'rejected' | 'unreachable';

/** Asks the service whether it accepts the key. 'rejected' only on 401/403; any other failure is 'unreachable'. */
export async function checkKey(name: EnvKeyName, value: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  const { url, headers } = checkRequest(name, value.trim());
  try {
    const res = await fetchImpl(url, { headers, credentials: 'omit' });
    if (res.ok) return 'ready';
    return res.status === 401 || res.status === 403 ? 'rejected' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/** OpenRouter lists models for anyone, so its key is checked on /key; the others on their model list. */
function checkRequest(name: EnvKeyName, key: string): { url: string; headers: Record<string, string> } {
  const p = providerForKey(name);
  if (!p) return { url: 'https://api.pexels.com/v1/search?query=nature&per_page=1', headers: { Authorization: key } };
  return { url: p === 'openrouter' ? 'https://openrouter.ai/api/v1/key' : PROVIDER_API[p].modelsUrl, headers: authHeaders(p, key) };
}

export type Verdict = 'ready' | 'rejected' | 'unreachable' | 'denied';

export interface VerifyDeps {
  request: (origins: readonly string[]) => Promise<'granted' | 'denied'>;
  save: (name: EnvKeyName, value: string) => Promise<void>;
  fetchImpl?: typeof fetch;
}

/** Asks for host access first (nothing awaited before it, so the gesture counts), checks the key, and saves it only when accepted. */
export async function verifyKey(name: EnvKeyName, value: string, origins: readonly string[], deps: VerifyDeps): Promise<Verdict> {
  if ((await deps.request(origins)) === 'denied') return 'denied';
  const result = await checkKey(name, value, deps.fetchImpl);
  if (result !== 'ready') return result;
  await deps.save(name, value.trim());
  return 'ready';
}
