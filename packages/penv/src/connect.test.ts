import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createPenv, loadKeyStatus, loadToken, loadTokenTarget, parseEnvPath, type PenvSettings } from './connect';
import { createKeyStore } from './keys';

const TARGET = { org: 'acme', project: 'notes', env: 'dev' };
const REDIRECT = 'https://abc.chromiumapp.org/penv';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const penvOk = () => vi.fn(async () => json({ keys: [{ name: 'GROQ_API_KEY', value: 'gsk_test' }] }));

let settings: PenvSettings = {};
// Shaped like Rekord: the token path and a key check.
const map = createPenv({
  appName: 'Rekord',
  clientId: 'rekord',
  keys: { kind: 'map', storageKey: 'apiKeys' },
  keyCheck: (name, key) =>
    name === 'GROQ_API_KEY' ? { url: 'https://groq.test/models', headers: { Authorization: `Bearer ${key}` } } : null,
  settings: async () => settings,
});

const NAMES = { GROQ_API_KEY: 'groq', PEXELS_API_KEY: 'pexels' };
// Shaped like Motikord: one session entry per key, optional keys on every connect.
const named = createPenv({
  appName: 'Motikord',
  clientId: 'motikord',
  optionalKeys: Object.keys(NAMES),
  keys: { kind: 'names', names: NAMES },
});

beforeEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
  settings = {};
});

describe('key store', () => {
  it('map: keeps every key in one session entry, merges and clears', async () => {
    const store = createKeyStore({ kind: 'map', storageKey: 'apiKeys' });
    await store.saveKeys({ GROQ_API_KEY: 'gsk_test' });
    expect(await fakeBrowser.storage.session.get('apiKeys')).toEqual({ apiKeys: { GROQ_API_KEY: 'gsk_test' } });
    await store.mergeKeys({ OPENAI_API_KEY: 'sk_test' });
    expect(await store.loadKeys()).toEqual({ GROQ_API_KEY: 'gsk_test', OPENAI_API_KEY: 'sk_test' });
    await store.clearKeys();
    expect(await store.loadKeys()).toEqual({});
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('names: keeps each known key under its own name, drops unknown ones, merges and clears', async () => {
    const store = createKeyStore({ kind: 'names', names: NAMES });
    await store.saveKeys({ GROQ_API_KEY: 'gsk_test', PEXELS_API_KEY: 'pexels_test', OTHER: 'x_test' });
    expect(await fakeBrowser.storage.session.get('groq')).toEqual({ groq: 'gsk_test' });
    expect(await store.loadKeys()).toEqual({ GROQ_API_KEY: 'gsk_test', PEXELS_API_KEY: 'pexels_test' });
    await store.clearKeys();
    await store.saveKeys({ GROQ_API_KEY: 'gsk_test' });
    await store.mergeKeys({ PEXELS_API_KEY: 'pexels_test' });
    expect(Object.keys(await store.loadKeys()).sort()).toEqual(['GROQ_API_KEY', 'PEXELS_API_KEY']);
    await store.clearKeys();
    expect(await store.loadKeys()).toEqual({});
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });
});

describe('connect', () => {
  it('parses org/project/env', () => {
    expect(parseEnvPath(' acme/notes/dev ')).toEqual(TARGET);
    expect(parseEnvPath('acme/notes')).toBeNull();
    expect(parseEnvPath('acme//dev')).toBeNull();
  });

  it('connectPenv keeps token and keys in session storage only and returns names', async () => {
    expect(await map.connectPenv('pck_test', TARGET, penvOk())).toEqual(['GROQ_API_KEY']);
    expect(await loadToken()).toBe('pck_test');
    expect(await map.loadKeys()).toEqual({ GROQ_API_KEY: 'gsk_test' });
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('connectPaste drops blank keys and merges with keys already in memory', async () => {
    expect(await map.connectPaste({ GROQ_API_KEY: ' gsk_test ', OPENAI_API_KEY: '  ' })).toEqual(['GROQ_API_KEY']);
    await map.connectPaste({ DEEPGRAM_API_KEY: 'dg_test' });
    expect(await map.connectPaste({ GROQ_API_KEY: 'gsk_new', DEEPGRAM_API_KEY: '' })).toEqual([
      'DEEPGRAM_API_KEY',
      'GROQ_API_KEY',
    ]);
    expect(await map.loadKeys()).toEqual({ GROQ_API_KEY: 'gsk_new', DEEPGRAM_API_KEY: 'dg_test' });
  });

  it('reconnect returns null without a token and refetches with one', async () => {
    expect(await map.reconnect(penvOk())).toBeNull();
    await fakeBrowser.storage.session.set({ penvToken: 'pck_test' });
    settings = { penv: TARGET };
    const fetchImpl = penvOk();
    expect(await map.reconnect(fetchImpl)).toEqual(['GROQ_API_KEY']);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('reconnect uses the env the token was saved with, not settings.penv', async () => {
    await map.connectPenv('pck_test', TARGET, penvOk());
    expect(await loadTokenTarget()).toEqual(TARGET);
    settings = { penv: { org: 'old', project: 'old', env: 'old' } };
    const fetchImpl = penvOk();
    await map.reconnect(fetchImpl);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain('acme');
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).not.toContain('old');
  });

  it('ensureKeys reports ready or reconnect', async () => {
    settings = { penv: TARGET };
    expect(await map.ensureKeys(penvOk())).toBe('reconnect');
    await fakeBrowser.storage.session.set({ penvToken: 'pck_test' });
    expect(await map.ensureKeys(penvOk())).toBe('ready');
    await map.forgetAll();
    await fakeBrowser.storage.session.set({ penvToken: 'pck_test' });
    expect(await map.ensureKeys(vi.fn(async () => new Response('', { status: 401 })))).toBe('reconnect');
    expect(await loadToken()).toBe('pck_test');
  });

  it('checkKeys checks only keys the app knows, and never keeps a value', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    const results = await map.checkKeys({ GROQ_API_KEY: ' gsk_test ', OTHER: 'x_test', BLANK: ' ' }, fetchImpl);
    expect(results).toEqual({ GROQ_API_KEY: 'rejected' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]).toMatchObject([
      'https://groq.test/models',
      { headers: { Authorization: 'Bearer gsk_test' } },
    ]);
    expect(await named.checkKeys({ GROQ_API_KEY: 'gsk_test' }, fetchImpl)).toEqual({});
  });

  it('checkKeys marks a key unreachable when the provider never answers', async () => {
    const hang = vi.fn(() => new Promise<Response>(() => {}));
    expect(await map.checkKeys({ GROQ_API_KEY: 'gsk_test' }, hang as typeof fetch, 20)).toEqual({
      GROQ_API_KEY: 'unreachable',
    });
  });

  it('forgetAll clears the token, grant, last check and keys', async () => {
    await map.saveKeys({ GROQ_API_KEY: 'gsk_test' });
    await fakeBrowser.storage.session.set({
      penvToken: 'pck_test',
      penvGrant: 'pca_test',
      keyStatus: { GROQ_API_KEY: 'ok' },
    });
    await map.forgetAll();
    expect(await map.loadKeys()).toEqual({});
    expect(await loadToken()).toBeUndefined();
    expect(await map.loadGrant()).toBeUndefined();
    expect(await loadKeyStatus()).toEqual({});
  });
});

/** Fake approval window and Penv Cloud for the named-key app. */
const allow = () =>
  vi.fn(
    async (url: string) =>
      `${REDIRECT}?${new URLSearchParams({ state: new URL(url).searchParams.get('state')!, code: 'code_test' })}`,
  );
function fakePenv(opts: { appStatus?: number; appBody?: unknown; keys?: { name: string; value: string }[] } = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith('/auth/app/token'))
      return json({ grant: 'pca_one', connection: { id: 'c1', ...TARGET, keys: ['GROQ_API_KEY'] } }, 201);
    if (u.endsWith('/auth/app'))
      return json(opts.appBody ?? { credential: 'pck_test', grant: 'pca_two' }, opts.appStatus ?? 201);
    if (u.includes('/envs/')) return json({ keys: opts.keys ?? [{ name: 'GROQ_API_KEY', value: 'gsk_test' }] });
    return new Response(null, { status: 404 });
  });
}

describe('named keys over the app connection', () => {
  const conn = { connectionId: 'c1', ...TARGET, keys: ['GROQ_API_KEY'] };

  it('asks for the optional keys and keeps the shared ones under their names', async () => {
    expect(named.connectKeyNames(['GROQ_API_KEY'])).toEqual(['GROQ_API_KEY', 'PEXELS_API_KEY']);
    const q = new URL(
      named.buildConnectUrl({ redirectUri: REDIRECT, state: 's', challenge: 'c', keys: ['GROQ_API_KEY'] }),
    ).searchParams;
    expect(q.get('client_id')).toBe('motikord');
    const fetchImpl = fakePenv({ keys: [{ name: 'PEXELS_API_KEY', value: 'pexels_test' }] });
    await named.connectPenvApp({ keys: ['GROQ_API_KEY'], launch: allow(), fetchImpl, redirect: REDIRECT });
    expect(await named.loadPenvAppKeys(TARGET, fetchImpl)).toEqual(['PEXELS_API_KEY']);
    expect(await fakeBrowser.storage.session.get('pexels')).toEqual({ pexels: 'pexels_test' });
  });

  it('restoreKeys loads the keys again from the grant', async () => {
    await fakeBrowser.storage.session.set({ penvGrant: 'pca_one' });
    expect(await named.restoreKeys(conn, fakePenv())).toBe(true);
    expect(await named.loadKeys()).toEqual({ GROQ_API_KEY: 'gsk_test' });
  });

  it('restoreKeys does not fetch when the key is already in memory, or there is no connection', async () => {
    await named.saveKeys({ GROQ_API_KEY: 'gsk_test' });
    const f = fakePenv();
    expect(await named.restoreKeys(conn, f)).toBe(true);
    expect(await named.restoreKeys(undefined, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('restoreKeys is false when Penv Cloud refuses the grant', async () => {
    await fakeBrowser.storage.session.set({ penvGrant: 'pca_old' });
    expect(await named.restoreKeys(conn, fakePenv({ appStatus: 400, appBody: { error: 'invalid_grant' } }))).toBe(
      false,
    );
    expect(await named.wasDisconnected()).toBe(true);
  });

  it('names the app in its errors', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'invalid_client' }, 400));
    await expect(
      named.connectPenvApp({ keys: [], launch: allow(), fetchImpl, redirect: REDIRECT }),
    ).rejects.toMatchObject({ code: 'not-connected', message: 'Motikord is not set up on Penv Cloud.' });
  });
});
