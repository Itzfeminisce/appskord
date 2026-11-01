/** Rekord's Google OAuth client; the sign-in pieces (consent URL, reading the redirect, token expiry) are shared. */
import { googleConfigured as configured } from '@appskord/platform';

export { authUrl, parseTokenRedirect, tokenUsable, type GoogleToken } from '@appskord/platform';

// Rekord's Google OAuth client (Web application, redirect https://flkicdahoghegnlgpkmdcemlooblblcd.chromiumapp.org/). It is public.
const REKORD_CLIENT_ID = '503949808619-egjguop1pgr0imp7pj7ej19g1b8afifo.apps.googleusercontent.com';
export const GOOGLE_CLIENT_ID: string = (import.meta.env.WXT_GOOGLE_CLIENT_ID as string | undefined) || REKORD_CLIENT_ID;

export const googleConfigured = (clientId = GOOGLE_CLIENT_ID): boolean => configured(clientId);
