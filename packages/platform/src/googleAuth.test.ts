import { describe, expect, it, vi } from 'vitest';
import {
  authUrl,
  googleConfigured,
  parseTokenRedirect,
  signInWithGoogle,
  tokenUsable,
  type IdentityApi,
} from './googleAuth';

const REDIRECT = 'https://abc.chromiumapp.org/';
const DRIVE = 'https://www.googleapis.com/auth/drive.file';

function identity(
  answer: (url: URL) => string | undefined,
): IdentityApi & { launchWebAuthFlow: ReturnType<typeof vi.fn> } {
  return {
    getRedirectURL: () => REDIRECT,
    launchWebAuthFlow: vi.fn(async ({ url }: { url: string }) => answer(new URL(url))),
  };
}

describe('googleAuth', () => {
  it('builds the consent URL for the app client id and scopes', () => {
    const u = new URL(authUrl('fake-client', REDIRECT, 's', [DRIVE], { silent: true, loginHint: 'you@example.com' }));
    expect(u.searchParams.get('client_id')).toBe('fake-client');
    expect(u.searchParams.get('response_type')).toBe('token');
    expect(u.searchParams.get('scope')).toBe(DRIVE);
    expect(u.searchParams.get('prompt')).toBe('none');
    expect(u.searchParams.get('login_hint')).toBe('you@example.com');
  });

  it('reads the token and its expiry, and refuses a different state', () => {
    const t = parseTokenRedirect(`${REDIRECT}#access_token=ya29.test&expires_in=3599&state=s`, 's', [DRIVE], 1000);
    expect(t).toEqual({ token: 'ya29.test', expiresAt: 1000 + 3599_000, scopes: [DRIVE] });
    expect(() => parseTokenRedirect(`${REDIRECT}#access_token=ya29.test&state=x`, 's', [DRIVE], 0)).toThrow();
    expect(() => parseTokenRedirect(`${REDIRECT}#error=access_denied&state=s`, 's', [DRIVE], 0)).toThrow(
      /access_denied/,
    );
  });

  it('treats a token as gone a minute early', () => {
    expect(tokenUsable({ expiresAt: 120_000 }, 0)).toBe(true);
    expect(tokenUsable({ expiresAt: 59_000 }, 0)).toBe(false);
    expect(tokenUsable(undefined, 0)).toBe(false);
    expect(googleConfigured(' ')).toBe(false);
  });

  it('signs in through launchWebAuthFlow with the given client id', async () => {
    const id = identity(
      (u) => `${REDIRECT}#access_token=ya29.test&expires_in=3600&state=${u.searchParams.get('state')}`,
    );
    const t = await signInWithGoogle({ clientId: 'fake-client', scopes: [DRIVE], interactive: true, identity: id });
    expect(t.token).toBe('ya29.test');
    const details = id.launchWebAuthFlow.mock.calls[0]![0];
    expect(details.interactive).toBe(true);
    expect(details.abortOnLoadForNonInteractive).toBeUndefined();
    expect(new URL(details.url).searchParams.get('client_id')).toBe('fake-client');
  });

  it('renews silently with prompt=none, and fails when the window closes', async () => {
    const id = identity((u) => `${REDIRECT}#access_token=ya29.test&state=${u.searchParams.get('state')}`);
    await signInWithGoogle({ clientId: 'c', scopes: [DRIVE], interactive: false, identity: id });
    const details = id.launchWebAuthFlow.mock.calls[0]![0];
    expect(new URL(details.url).searchParams.get('prompt')).toBe('none');
    expect(details).toMatchObject({
      interactive: false,
      abortOnLoadForNonInteractive: false,
      timeoutMsForNonInteractive: 5000,
    });
    await expect(
      signInWithGoogle({ clientId: 'c', scopes: [DRIVE], interactive: true, identity: identity(() => undefined) }),
    ).rejects.toThrow(/closed/);
  });
});
