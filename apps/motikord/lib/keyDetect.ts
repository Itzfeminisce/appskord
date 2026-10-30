/** Recognises a pasted key by its prefix and checks it with the service. Never logs or returns the value itself. */

export type EnvKeyName = 'GROQ_API_KEY' | 'PEXELS_API_KEY';

/** Pexels keys have no prefix: 56 letters and digits. */
const PEXELS_SHAPE = /^[A-Za-z0-9]{40,64}$/;

/** The key name for a pasted value, or null when Motikord doesn't recognise it. */
export function detectKey(value: string): EnvKeyName | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith('gsk_')) return 'GROQ_API_KEY';
  if (v.startsWith('pexels_') || PEXELS_SHAPE.test(v)) return 'PEXELS_API_KEY';
  return null;
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
