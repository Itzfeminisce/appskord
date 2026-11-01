/** Optional host access. Call from a click handler: Chrome only shows its prompt after a user gesture. */
import { browser } from 'wxt/browser';

export interface PermissionsApi {
  request(permissions: { origins: string[] }): Promise<boolean>;
}

export interface RequestOriginsOptions {
  /** Defaults to browser.permissions; injected in tests. */
  permissions?: PermissionsApi;
  /** Called when Chrome throws; the request then resolves false. */
  onError?: (error: unknown) => void;
}

/** Asks Chrome for the origins with no awaited call before it, so the gesture survives. Resolves false, never throws. */
export async function requestOrigins(origins: readonly string[], opts: RequestOriginsOptions = {}): Promise<boolean> {
  const permissions = opts.permissions ?? (browser.permissions as unknown as PermissionsApi);
  try {
    return await permissions.request({ origins: [...origins] });
  } catch (error) {
    opts.onError?.(error);
    return false;
  }
}
