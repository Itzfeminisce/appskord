import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOSTS, requestHost } from './hostAccess';

function stubPermissions(request: boolean | Error) {
  const perms = {
    contains: vi.fn(async () => false),
    request: vi.fn(async () => { if (request instanceof Error) throw request; return request; }),
  };
  vi.stubGlobal('chrome', { permissions: perms });
  return perms;
}

describe('requestHost', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns granted when Chrome allows the host', async () => {
    const perms = stubPermissions(true);
    expect(await requestHost(HOSTS.groq)).toBe('granted');
    expect(perms.request).toHaveBeenCalledWith({ origins: ['https://api.groq.com/*'] });
  });
  it('returns denied when the person denies', async () => {
    stubPermissions(false);
    expect(await requestHost(HOSTS.openverse)).toBe('denied');
  });
  it('calls request directly, never contains first, so the gesture is kept', async () => {
    const perms = stubPermissions(true);
    expect(await requestHost(HOSTS.pexels)).toBe('granted');
    expect(perms.contains).not.toHaveBeenCalled();
  });
  it('returns denied when Chrome throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubPermissions(new Error('no gesture'));
    expect(await requestHost(HOSTS.penv)).toBe('denied');
  });
});
