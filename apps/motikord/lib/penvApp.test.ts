import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { loadKeys, saveKeys } from './keys';
import {
  buildConnectUrl, connectKeyNames, connectPenvApp, createPkce, disconnectPenvApp, loadGrant, loadPenvAppKeys,
  PENV_APP_CLIENT_ID, pkceChallenge, PenvAppError, restoreKeys, wasDisconnected,
} from './penvApp';

const REDIRECT = 'https://pppjklpibpnndjfddhcedbdicfdalchl.chromiumapp.org/penv';
const TARGET = { org: 'acme', project: 'motikord', env: 'dev' };
const CONNECTION = { id: 'c1', org: 'acme', project: 'motikord', environment: 'dev', keys: ['GROQ_API_KEY'] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Fake approval window: echoes the state from the URL with the given params. */
const allow = (extra: Record<string, string> = { code: 'code_test' }, stateOverride?: string) =>
  vi.fn(async (url: string) => {
    const state = stateOverride ?? new URL(url).searchParams.get('state')!;
    return `${REDIRECT}?${new URLSearchParams({ state, ...extra })}`;
  });

/** Fake Penv Cloud: code → grant; grant → pck_ + rotated grant; env read. */
function fakePenv(opts: { appStatus?: number; appBody?: unknown; keys?: { name: string; value: string }[] } = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/auth/app/token')) return json({ grant: 'pca_one', connection: CONNECTION }, 201);
    if (u.endsWith('/auth/app')) return json(opts.appBody ?? { credential: 'pck_test', grant: 'pca_two' }, opts.appStatus ?? 201);
    if (u.endsWith('/auth/revoke')) return new Response(null, { status: 204 });
    if (u.includes('/envs/')) {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer pck_test');
      return json({ keys: opts.keys ?? [{ name: 'GROQ_API_KEY', value: 'gsk_test' }] });
    }
    return new Response(null, { status: 404 });
  });
}

describe('penvApp', () => {
  beforeEach(() => fakeBrowser.reset());

  it('builds the connect URL for the motikord client with PKCE S256', async () => {
    const { verifier, challenge } = await createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(await pkceChallenge(verifier));
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const url = new URL(buildConnectUrl({ redirectUri: REDIRECT, state: 'st', challenge, keys: connectKeyNames(['GROQ_API_KEY']) }));
    expect(url.origin + url.pathname).toBe('https://penv.cloud/connect');
    expect(PENV_APP_CLIENT_ID).toBe('motikord');
    expect(url.searchParams.get('client_id')).toBe('motikord');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('keys')).toBe('GROQ_API_KEY,PEXELS_API_KEY');
  });

  it('approval flow: exchanges the code, then loads the shared keys', async () => {
    const fetchImpl = fakePenv();
    const launch = allow();
    const conn = await connectPenvApp({ keys: ['GROQ_API_KEY'], launch, fetchImpl, redirect: REDIRECT });
    expect(conn).toEqual({ connectionId: 'c1', ...TARGET, keys: ['GROQ_API_KEY'] });
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(sent).toMatchObject({ client_id: 'motikord', code: 'code_test', redirect_uri: REDIRECT });
    expect(await pkceChallenge(sent.code_verifier)).toBe(new URL(launch.mock.calls[0]![0]).searchParams.get('code_challenge'));
    expect(await loadGrant()).toBe('pca_one');

    expect(await loadPenvAppKeys(TARGET, fetchImpl)).toEqual(['GROQ_API_KEY']);
    expect(await loadGrant()).toBe('pca_two');
    expect(await loadKeys()).toEqual({ GROQ_API_KEY: 'gsk_test' });
  });

  it('rejects a state mismatch without calling Penv Cloud', async () => {
    const fetchImpl = fakePenv();
    await expect(connectPenvApp({ keys: [], launch: allow(undefined, 'other'), fetchImpl, redirect: REDIRECT }))
      .rejects.toMatchObject({ code: 'state-mismatch' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await loadGrant()).toBeUndefined();
  });

  it('a closed window or denied access means not connected', async () => {
    const closed = vi.fn(async () => { throw new Error('closed'); });
    await expect(connectPenvApp({ keys: [], launch: closed, fetchImpl: fakePenv(), redirect: REDIRECT })).rejects.toMatchObject({ code: 'not-connected' });
    const err = await connectPenvApp({ keys: [], launch: allow({ error: 'access_denied' }), fetchImpl: fakePenv(), redirect: REDIRECT }).catch((e) => e);
    expect(err).toBeInstanceOf(PenvAppError);
    expect(err.code).toBe('not-connected');
  });

  it('invalid_grant clears the grant and keys and marks disconnected', async () => {
    await fakeBrowser.storage.session.set({ penvGrant: 'pca_old' });
    await saveKeys({ GROQ_API_KEY: 'gsk_test' });
    const fetchImpl = fakePenv({ appStatus: 400, appBody: { error: 'invalid_grant' } });
    await expect(loadPenvAppKeys(TARGET, fetchImpl)).rejects.toMatchObject({ code: 'disconnected' });
    expect(await loadGrant()).toBeUndefined();
    expect(await loadKeys()).toEqual({});
    expect(await wasDisconnected()).toBe(true);
  });

  it('skips keys Penv Cloud did not share', async () => {
    const fetchImpl = fakePenv({ keys: [{ name: 'PEXELS_API_KEY', value: 'pexels_test' }] });
    await connectPenvApp({ keys: ['GROQ_API_KEY'], launch: allow(), fetchImpl, redirect: REDIRECT });
    expect(await loadPenvAppKeys(TARGET, fetchImpl)).toEqual(['PEXELS_API_KEY']);
  });

  it('disconnect revokes the grant and clears keys', async () => {
    await fakeBrowser.storage.session.set({ penvGrant: 'pca_one' });
    await saveKeys({ GROQ_API_KEY: 'gsk_test' });
    const fetchImpl = fakePenv();
    expect(await disconnectPenvApp(fetchImpl)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://penv.cloud/api/v1/auth/revoke');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer pca_one');
    expect(await loadGrant()).toBeUndefined();
    expect(await loadKeys()).toEqual({});
  });

  it('disconnect still clears locally when the revoke fails', async () => {
    await fakeBrowser.storage.session.set({ penvGrant: 'pca_one' });
    expect(await disconnectPenvApp(vi.fn(async () => { throw new TypeError('offline'); }))).toBe(false);
    expect(await loadGrant()).toBeUndefined();
  });
});

describe('restoreKeys', () => {
  beforeEach(() => fakeBrowser.reset());
  const conn = { connectionId: 'c1', ...TARGET, keys: ['GROQ_API_KEY'] };

  it('loads the keys again from the grant', async () => {
    await fakeBrowser.storage.session.set({ penvGrant: 'pca_one' });
    expect(await restoreKeys(conn, fakePenv())).toBe(true);
    expect(await loadKeys()).toEqual({ GROQ_API_KEY: 'gsk_test' });
  });
  it('does not fetch when a Groq key is already in memory, or there is no connection', async () => {
    await saveKeys({ GROQ_API_KEY: 'gsk_test' });
    const f = fakePenv();
    expect(await restoreKeys(conn, f)).toBe(true);
    expect(await restoreKeys(undefined, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('is false when Penv Cloud refuses the grant', async () => {
    await fakeBrowser.storage.session.set({ penvGrant: 'pca_old' });
    expect(await restoreKeys(conn, fakePenv({ appStatus: 400, appBody: { error: 'invalid_grant' } }))).toBe(false);
  });
});
