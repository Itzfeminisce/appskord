/**
 * Keys held in session memory, from Penv Cloud or pasted by the user, and the check that they work.
 * The `pck_` token and keys live only in `browser.storage.session`. Never log or show a value.
 */
import { browser } from 'wxt/browser';
import { createPenvApp, GRANT_KEY, type PenvAppConnection, type PenvAppOptions } from './app';
import { fetchPenvKeys, type PenvTarget } from './env';
import { createKeyStore, type KeyLayout } from './keys';

const TOKEN_KEY = 'penvToken';
const TARGET_KEY = 'penvTarget';
const STATUS_KEY = 'keyStatus';

export type KeyStatus = 'ok' | 'rejected' | 'unreachable';
/** Status per key name. Never holds a key value. */
export type KeyResults = Record<string, KeyStatus>;

/** The cheap "who am I" request that checks one key. */
export interface KeyCheckRequest {
  url: string;
  headers: Record<string, string>;
}

/** What `ensureKeys` and `reconnect` read from the app's settings. */
export interface PenvSettings {
  keySource?: string | null;
  penvApp?: PenvAppConnection;
  penv?: PenvTarget;
}

export interface PenvOptions extends Omit<PenvAppOptions, 'keys'> {
  /** Where the app keeps its keys in `chrome.storage.session`. */
  keys: KeyLayout;
  /** The request that checks a key, or null when the app doesn't know that key. */
  keyCheck?: (name: string, key: string) => KeyCheckRequest | null;
  /** The app's settings, for re-loading keys when the side panel opens. */
  settings?: () => Promise<PenvSettings>;
}

/** "org/project/env" → target, or null if it is not three non-empty parts. */
export function parseEnvPath(path: string): PenvTarget | null {
  const parts = path
    .trim()
    .split('/')
    .map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  const [org = '', project = '', env = ''] = parts;
  return { org, project, env };
}

export function formatEnvPath(t: PenvTarget): string {
  return `${t.org}/${t.project}/${t.env}`;
}

/**
 * Asks Chrome for access to the sites a connection talks to. Needs a user gesture on the first call;
 * resolves false (never throws) when the user says no or the call is not allowed.
 */
export async function requestHosts(origins: string[]): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins });
  } catch {
    return false;
  }
}

/** Remembers the last check (names and statuses only) for this browser session. */
export async function saveKeyStatus(results: KeyResults): Promise<void> {
  await browser.storage.session.set({ [STATUS_KEY]: results });
}

export async function loadKeyStatus(): Promise<KeyResults> {
  const stored = await browser.storage.session.get(STATUS_KEY);
  return (stored[STATUS_KEY] as KeyResults | undefined) ?? {};
}

export async function loadToken(): Promise<string | undefined> {
  const stored = await browser.storage.session.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY];
  return typeof token === 'string' && token ? token : undefined;
}

/** The penv environment the kept token belongs to, if any. */
export async function loadTokenTarget(): Promise<PenvTarget | undefined> {
  const stored = await browser.storage.session.get(TARGET_KEY);
  const t = stored[TARGET_KEY] as Partial<PenvTarget> | undefined;
  return t && t.org && t.project && t.env ? { org: t.org, project: t.project, env: t.env } : undefined;
}

async function checkOne(req: KeyCheckRequest, fetchImpl: typeof fetch, timeoutMs: number): Promise<KeyStatus> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'unreachable'>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve('unreachable');
    }, timeoutMs);
  });
  const call = fetchImpl(req.url, { headers: req.headers, signal: ctrl.signal }).then(
    (res): KeyStatus => (res.status === 401 || res.status === 403 ? 'rejected' : res.ok ? 'ok' : 'unreachable'),
    (): KeyStatus => 'unreachable',
  );
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** One app's keys: the store, Penv Cloud (app connection and token), pasted keys and the key check. */
export function createPenv(o: PenvOptions) {
  const store = createKeyStore(o.keys);
  const app = createPenvApp({ ...o, keys: store });
  const { appName } = o;
  const settings: () => Promise<PenvSettings> = o.settings ?? (async () => ({}));

  /** Forgets the token, its environment, the grant, the last check and every key held in memory. */
  async function forgetAll(): Promise<void> {
    await browser.storage.session.remove([TOKEN_KEY, TARGET_KEY, STATUS_KEY, GRANT_KEY]);
    await store.clearKeys();
  }

  /** Saves pasted keys (blank ones dropped), merged into the keys already in memory. Returns the key names in memory. */
  async function connectPaste(keys: Record<string, string>): Promise<string[]> {
    const clean = Object.fromEntries(
      Object.entries(keys)
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(([, v]) => v),
    );
    await store.mergeKeys(clean);
    return Object.keys(await store.loadKeys()).sort();
  }

  /** Fetches keys from penv, keeps the token and keys in session memory. Returns the key names found. */
  async function connectPenv(token: string, target: PenvTarget, fetchImpl: typeof fetch = fetch): Promise<string[]> {
    const keys = await fetchPenvKeys(appName, token, target, fetchImpl);
    await store.saveKeys(keys);
    await browser.storage.session.set({ [TOKEN_KEY]: token, [TARGET_KEY]: target });
    return Object.keys(keys).sort();
  }

  /**
   * Re-fetches penv keys with the token kept in session memory.
   * Returns the key names, or null when there is no token (the user must connect again).
   * Throws PenvError when penv refuses.
   */
  async function reconnect(fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
    const token = await loadToken();
    if (!token) return null;
    const target = (await loadTokenTarget()) ?? (await settings()).penv;
    if (!target) return null;
    return connectPenv(token, target, fetchImpl);
  }

  /**
   * Checks every loaded key against its own provider, in parallel. Keys the app doesn't know are skipped.
   * 'rejected' = 401/403; 'unreachable' = network error, other failure or no answer within ~8 s.
   */
  async function checkKeys(
    keys: Record<string, string>,
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 8000,
  ): Promise<KeyResults> {
    const entries = await Promise.all(
      Object.entries(keys).map(async ([name, value]) => {
        const req = value?.trim() && o.keyCheck ? o.keyCheck(name, value.trim()) : null;
        return req ? ([name, await checkOne(req, fetchImpl, timeoutMs)] as const) : null;
      }),
    );
    return Object.fromEntries(entries.filter((e): e is readonly [string, KeyStatus] => !!e));
  }

  /**
   * Call when the side panel opens. 'ready' if keys are in memory (re-fetching them from Penv Cloud when only
   * the grant or token is left); 'reconnect' when the user has to connect again (e.g. after a browser restart).
   */
  async function ensureKeys(fetchImpl: typeof fetch = fetch): Promise<'ready' | 'reconnect'> {
    const keys = await store.loadKeys();
    if (Object.keys(keys).length > 0) return 'ready';
    try {
      const s = await settings();
      if (s.keySource === 'penv-app' && s.penvApp) {
        return (await app.loadPenvAppKeys(s.penvApp, fetchImpl)) ? 'ready' : 'reconnect';
      }
      return (await reconnect(fetchImpl)) ? 'ready' : 'reconnect';
    } catch {
      return 'reconnect';
    }
  }

  return {
    ...store,
    ...app,
    forgetAll,
    connectPaste,
    connectPenv,
    reconnect,
    checkKeys,
    ensureKeys,
    fetchPenvKeys: (token: string, target: PenvTarget, fetchImpl?: typeof fetch, opts?: { skipRedacted?: boolean }) =>
      fetchPenvKeys(appName, token, target, fetchImpl, opts),
  };
}

export type Penv = ReturnType<typeof createPenv>;
