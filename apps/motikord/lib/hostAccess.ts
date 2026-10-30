/** Optional host access. Call from a click handler: Chrome only shows its prompt after a user gesture. */

export type HostAccess = 'granted' | 'denied';

/** Origin patterns for the hosts each feature reaches (all listed as optional_host_permissions). */
export const HOSTS = {
  penv: ['https://penv.cloud/*'],
  groq: ['https://api.groq.com/*'],
  openverse: ['https://api.openverse.org/*'],
  pexels: ['https://api.pexels.com/*', 'https://images.pexels.com/*', 'https://videos.pexels.com/*'],
} as const;

/** Asks Chrome for the hosts; request() resolves true when they are already allowed. No awaited call before it, so the user gesture survives. Never throws. */
export async function requestHost(origins: readonly string[]): Promise<HostAccess> {
  const wanted = [...origins];
  try {
    return (await chrome.permissions.request({ origins: wanted })) ? 'granted' : 'denied';
  } catch (error) {
    console.error('Motikord: could not ask for host access', error);
    return 'denied';
  }
}
