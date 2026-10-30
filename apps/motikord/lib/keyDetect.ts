/** Recognises a pasted key by its prefix and checks it with the service. Never logs or returns the value itself. */

export type EnvKeyName = 'GROQ_API_KEY' | 'PEXELS_API_KEY';

/** Pexels keys have no prefix: 56 letters and digits. */
const PEXELS_SHAPE = /^[A-Za-z0-9]{40,64}$/;

export type KeyField = 'main' | 'pexels';

/** The key name for a pasted value, or null. The bare Pexels shape counts only inside the Pexels field, never the main one. */
export function detectKey(value: string, field: KeyField = 'main'): EnvKeyName | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith('gsk_')) return 'GROQ_API_KEY';
  if (v.startsWith('pexels_') || (field === 'pexels' && PEXELS_SHAPE.test(v))) return 'PEXELS_API_KEY';
  return null;
}

/** True when the value has the whole shape of its key, so a pause may check it. */
export function looksComplete(name: EnvKeyName, value: string): boolean {
  const v = value.trim();
  return name === 'GROQ_API_KEY' ? /^gsk_[A-Za-z0-9]{20,}$/.test(v) : PEXELS_SHAPE.test(v) || /^pexels_[A-Za-z0-9]{20,}$/.test(v);
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

const LABELS: Record<EnvKeyName, string> = { GROQ_API_KEY: 'Groq', PEXELS_API_KEY: 'Pexels' };

/** The service's display name for a key name ("Groq"); unknown names come back unchanged. */
export function serviceLabel(name: string): string {
  return LABELS[name as EnvKeyName] ?? name;
}

export type KeyCheck = 'ready' | 'rejected' | 'unreachable';

/** Asks the service whether it accepts the key. 'rejected' only on 401/403; any other failure is 'unreachable'. */
export async function checkKey(name: EnvKeyName, value: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  const url = name === 'GROQ_API_KEY' ? 'https://api.groq.com/openai/v1/models' : 'https://api.pexels.com/v1/search?query=nature&per_page=1';
  const headers = name === 'GROQ_API_KEY' ? { Authorization: `Bearer ${value.trim()}` } : { Authorization: value.trim() };
  try {
    const res = await fetchImpl(url, { headers, credentials: 'omit' });
    if (res.ok) return 'ready';
    return res.status === 401 || res.status === 403 ? 'rejected' : 'unreachable';
  } catch {
    return 'unreachable';
  }
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
