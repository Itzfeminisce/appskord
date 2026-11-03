/** Recognises a pasted key by its prefix or shape and checks it with the service. Never logs or returns the value itself. */
import { authHeaders, modelsUrl, PROVIDERS, providerForKey, type ProviderKeyName } from './providers';

export type KeyName = ProviderKeyName | 'DEEPGRAM_API_KEY' | 'NOTION_TOKEN' | 'PEXELS_API_KEY';

/** 'pexels' is a field that only takes a Pexels key, so its bare shape counts there. */
export type KeyField = 'main' | 'pexels';

export interface DetectOptions<N extends KeyName> {
  field?: KeyField;
  /** The key names this app uses; anything else comes back as null. */
  names?: readonly N[];
}

// Longest prefix first: sk-ant- and sk-or- keys also start with OpenAI's sk-.
const PREFIXES: [string, KeyName][] = [
  ['gsk_', 'GROQ_API_KEY'],
  ['sk-ant-', 'ANTHROPIC_API_KEY'],
  ['sk-or-', 'OPENROUTER_API_KEY'],
  ['sk-', 'OPENAI_API_KEY'],
  ['xai-', 'XAI_API_KEY'],
  ['AIza', 'GEMINI_API_KEY'],
  ['ntn_', 'NOTION_TOKEN'],
  ['secret_', 'NOTION_TOKEN'],
  ['pexels_', 'PEXELS_API_KEY'],
];
/** Pexels keys have no prefix: 56 letters and digits. */
const PEXELS_SHAPE = /^[A-Za-z0-9]{40,64}$/;
const DEEPGRAM_SHAPE = /^[0-9a-f]{40}$/i;

const SHAPES: Record<KeyName, RegExp> = {
  GROQ_API_KEY: /^gsk_[A-Za-z0-9]{20,}$/,
  ANTHROPIC_API_KEY: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  OPENROUTER_API_KEY: /^sk-or-[A-Za-z0-9_-]{20,}$/,
  OPENAI_API_KEY: /^sk-[A-Za-z0-9_-]{20,}$/,
  XAI_API_KEY: /^xai-[A-Za-z0-9_-]{20,}$/,
  GEMINI_API_KEY: /^AIza[A-Za-z0-9_-]{20,}$/,
  NOTION_TOKEN: /^(ntn_|secret_)[A-Za-z0-9]{20,}$/,
  DEEPGRAM_API_KEY: DEEPGRAM_SHAPE,
  PEXELS_API_KEY: /^pexels_[A-Za-z0-9]{20,}$/,
};

function detectAny(v: string, field: KeyField): KeyName | null {
  const hit = PREFIXES.find(([prefix]) => v.startsWith(prefix));
  if (hit) return hit[1];
  // The bare Pexels shape counts only inside the Pexels field, never the main one.
  if (field === 'pexels' && PEXELS_SHAPE.test(v)) return 'PEXELS_API_KEY';
  if (DEEPGRAM_SHAPE.test(v)) return 'DEEPGRAM_API_KEY';
  return null;
}

/** The key name for a pasted value, or null when it is not one of `names`. */
export function detectKey<N extends KeyName = KeyName>(value: string, opts: DetectOptions<N> = {}): N | null {
  const v = value.trim();
  if (!v) return null;
  const name = detectAny(v, opts.field ?? 'main');
  if (!name || (opts.names && !(opts.names as readonly string[]).includes(name))) return null;
  return name as N;
}

/** True when the value has the whole shape of its key, so a pause may check it. */
export function looksComplete(name: KeyName, value: string): boolean {
  const v = value.trim();
  return SHAPES[name].test(v) || (name === 'PEXELS_API_KEY' && PEXELS_SHAPE.test(v));
}

export const IDLE_MS = 600;

/** Runs `run` on paste at once, or after the value is a full key and typing has paused; never per keystroke. */
export function createKeyWatcher<N extends KeyName = KeyName>(
  run: (name: N, key: string) => void,
  opts: DetectOptions<N> = {},
  idleMs = IDLE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    cancel,
    paste(value: string) {
      cancel();
      const name = detectKey(value, opts);
      if (name) run(name, value);
    },
    type(value: string) {
      cancel();
      const name = detectKey(value, opts);
      if (name && looksComplete(name, value)) timer = setTimeout(() => run(name, value), idleMs);
    },
  };
}

const LABELS: Record<KeyName, string> = {
  GROQ_API_KEY: 'Groq',
  OPENAI_API_KEY: 'OpenAI',
  ANTHROPIC_API_KEY: 'Anthropic',
  OPENROUTER_API_KEY: 'OpenRouter',
  GEMINI_API_KEY: 'Gemini',
  XAI_API_KEY: 'xAI',
  DEEPGRAM_API_KEY: 'Deepgram',
  NOTION_TOKEN: 'Notion',
  PEXELS_API_KEY: 'Pexels',
};

/** The service's display name for a key name ("Groq"); unknown names come back unchanged. */
export function serviceLabel(name: string): string {
  return LABELS[name as KeyName] ?? name;
}

export interface KeyCheckRequest {
  url: string;
  headers: Record<string, string>;
}

/** The cheap "who am I" request for a key. OpenRouter lists models for anyone, so its key is checked on /key. */
export function checkRequest(name: KeyName, key: string): KeyCheckRequest | null {
  if (name === 'PEXELS_API_KEY')
    return { url: 'https://api.pexels.com/v1/search?query=nature&per_page=1', headers: { Authorization: key } };
  if (name === 'DEEPGRAM_API_KEY')
    return { url: 'https://api.deepgram.com/v1/projects', headers: { Authorization: `Token ${key}` } };
  const p = providerForKey(name);
  if (!p) return null;
  return {
    url: p === 'openrouter' ? `${PROVIDERS.openrouter.baseUrl}/key` : modelsUrl({ provider: p }),
    headers: authHeaders(p, key),
  };
}

export type KeyCheck = 'ready' | 'rejected' | 'unreachable';

/** Asks the service whether it accepts the key. 'rejected' only on 401/403; any other failure is 'unreachable'. */
export async function checkKey(name: KeyName, value: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  const req = checkRequest(name, value.trim());
  if (!req) return 'unreachable';
  try {
    const res = await fetchImpl(req.url, { headers: req.headers, credentials: 'omit' });
    if (res.ok) return 'ready';
    return res.status === 401 || res.status === 403 ? 'rejected' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export type Verdict = 'ready' | 'rejected' | 'unreachable' | 'denied';

export interface VerifyDeps<N extends KeyName> {
  request: (origins: readonly string[]) => Promise<'granted' | 'denied'>;
  save: (name: N, value: string) => Promise<void>;
  fetchImpl?: typeof fetch;
}

/** Asks for host access first (nothing awaited before it, so the gesture counts), checks the key, and saves it only when accepted. */
export async function verifyKey<N extends KeyName>(
  name: N,
  value: string,
  origins: readonly string[],
  deps: VerifyDeps<N>,
): Promise<Verdict> {
  if ((await deps.request(origins)) === 'denied') return 'denied';
  const result = await checkKey(name, value, deps.fetchImpl);
  if (result !== 'ready') return result;
  await deps.save(name, value.trim());
  return 'ready';
}
