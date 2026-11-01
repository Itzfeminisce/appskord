/** Google sign-in for Drive links: implicit-flow token through launchWebAuthFlow, kept only in chrome.storage.session. */
import {
  authUrl as sharedAuthUrl,
  googleConfigured as configured,
  parseTokenRedirect as parseShared,
  signInWithGoogle,
  tokenUsable as usable,
} from '@appskord/platform';

// Public OAuth client id (O2), set at build time; empty until the owner creates the client.
// Klipkord's Google OAuth client (Web application, redirect https://iapgbifdchhmidblniddncnagghloepi.chromiumapp.org/). It is public.
const KLIPKORD_CLIENT_ID = '503949808619-egjguop1pgr0imp7pj7ej19g1b8afifo.apps.googleusercontent.com';
export const GOOGLE_CLIENT_ID: string = (import.meta.env.WXT_GOOGLE_CLIENT_ID as string | undefined) || KLIPKORD_CLIENT_ID;
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_ORIGINS = ['https://www.googleapis.com/*'];
const TOKEN_KEY = 'googleToken';

export interface GoogleToken { token: string; expiresAt: number }

export const googleConfigured = (clientId = GOOGLE_CLIENT_ID): boolean => configured(clientId);

export const authUrl = (clientId: string, redirectUri: string, state: string): string => sharedAuthUrl(clientId, redirectUri, state, [DRIVE_SCOPE]);

const driveOnly = ({ token, expiresAt, scopes }: { token: string; expiresAt: number; scopes: string[] }): GoogleToken => {
  if (!scopes.includes(DRIVE_SCOPE)) throw new Error('Google sign-in did not grant Drive access');
  return { token, expiresAt };
};

/** Reads the token from the redirect's fragment; throws when Google sent an error, the state differs or Drive was not granted. */
export const parseTokenRedirect = (redirected: string, state: string, now: number): GoogleToken =>
  driveOnly(parseShared(redirected, state, [DRIVE_SCOPE], now));

export const tokenUsable = (t: GoogleToken | undefined, now: number): t is GoogleToken => usable(t, now);

export async function getGoogleToken(): Promise<string | undefined> {
  const stored = (await browser.storage.session.get(TOKEN_KEY))[TOKEN_KEY] as GoogleToken | undefined;
  return tokenUsable(stored, Date.now()) ? stored.token : undefined;
}

/** Runs in a click: asks for Google's host, then shows Google's consent window. */
export async function connectGoogle(): Promise<string> {
  if (!googleConfigured()) throw new Error('WXT_GOOGLE_CLIENT_ID is not set in this build');
  if (!(await browser.permissions.request({ origins: GOOGLE_ORIGINS }))) throw new Error('Google access was not allowed');
  const t = driveOnly(await signInWithGoogle({ clientId: GOOGLE_CLIENT_ID, scopes: [DRIVE_SCOPE], interactive: true }));
  await browser.storage.session.set({ [TOKEN_KEY]: t });
  return t.token;
}

export const forgetGoogleToken = (): Promise<void> => browser.storage.session.remove(TOKEN_KEY);

/** True when Google itself failed, false when the window was closed or access was refused. */
export function signInError(error: unknown): boolean {
  const m = String((error as { message?: string } | null)?.message ?? error).toLowerCase();
  return !/access_denied|did not approve|closed|was not allowed|cancel/.test(m);
}
