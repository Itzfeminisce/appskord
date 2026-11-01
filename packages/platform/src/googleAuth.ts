/** Google sign-in through launchWebAuthFlow (implicit flow): the consent URL, reading the redirect, token expiry. */
import { browser } from 'wxt/browser';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
// Treat a token as gone a minute early so a request doesn't start on one about to expire.
const EARLY_MS = 60_000;

export interface GoogleToken {
  token: string;
  expiresAt: number;
  scopes: string[];
}

export const googleConfigured = (clientId: string): boolean => clientId.trim().length > 0;

/** `silent` asks Google not to show any page (prompt=none), for renewing a token without the user. */
export function authUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  scopes: string[],
  opts: { silent?: boolean; loginHint?: string } = {},
): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: scopes.join(' '),
    state,
    include_granted_scopes: 'false',
  });
  if (opts.silent) q.set('prompt', 'none');
  if (opts.loginHint) q.set('login_hint', opts.loginHint);
  return `${AUTH_ENDPOINT}?${q.toString()}`;
}

/** Reads the token from the redirect's fragment; throws when Google sent an error or the state differs. */
export function parseTokenRedirect(redirected: string, state: string, requested: string[], now: number): GoogleToken {
  const hash = redirected.includes('#') ? redirected.slice(redirected.indexOf('#') + 1) : '';
  const p = new URLSearchParams(
    hash || (redirected.includes('?') ? redirected.slice(redirected.indexOf('?') + 1) : ''),
  );
  const error = p.get('error');
  if (error) throw new Error(`Google sign-in failed: ${error}`);
  if (p.get('state') !== state) throw new Error('Google sign-in returned a different state');
  const token = p.get('access_token');
  if (!token) throw new Error('Google sign-in returned no token');
  const granted = p.get('scope');
  const seconds = Number(p.get('expires_in') ?? '3600');
  return {
    token,
    expiresAt: now + (Number.isFinite(seconds) ? seconds : 3600) * 1000,
    scopes: granted ? granted.split(' ').filter(Boolean) : requested,
  };
}

export const tokenUsable = <T extends { expiresAt: number }>(t: T | undefined, now: number): t is T =>
  !!t && t.expiresAt - EARLY_MS > now;

/** The part of chrome.identity sign-in uses; injected in tests. */
export interface IdentityApi {
  launchWebAuthFlow(details: {
    url: string;
    interactive: boolean;
    abortOnLoadForNonInteractive?: boolean;
    timeoutMsForNonInteractive?: number;
  }): Promise<string | undefined>;
  getRedirectURL(path?: string): string;
}

export interface SignInOptions {
  clientId: string;
  scopes: string[];
  /** False renews silently (prompt=none) and fails when Google would need to ask the user. */
  interactive: boolean;
  loginHint?: string;
  identity?: IdentityApi;
}

/** Runs Google's consent page and returns the token; the caller decides where it lives. Never logs it. */
export async function signInWithGoogle(o: SignInOptions): Promise<GoogleToken> {
  const identity = o.identity ?? (browser.identity as unknown as IdentityApi);
  const state = crypto.randomUUID();
  const redirected = await identity.launchWebAuthFlow({
    url: authUrl(o.clientId, identity.getRedirectURL(), state, o.scopes, {
      silent: !o.interactive,
      loginHint: o.loginHint,
    }),
    interactive: o.interactive,
    // prompt=none answers through a redirect chain; give it a moment instead of stopping at the first page load.
    ...(o.interactive ? {} : { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 5000 }),
  });
  if (!redirected) throw new Error('Google sign-in was closed');
  return parseTokenRedirect(redirected, state, o.scopes, Date.now());
}
