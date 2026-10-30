import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOSTS, requestHost } from './hostAccess';

function stubPermissions(contains: boolean, request: boolean | Error) {
  const perms = {
    contains: vi.fn(async () => contains),
    request: vi.fn(async () => { if (request instanceof Error) throw request; return request; }),
  };
  vi.stubGlobal('chrome', { permissions: perms });
  return perms;
}

describe('requestHost', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns granted when Chrome allows the host', async () => {
    const perms = stubPermissions(false, true);
    expect(await requestHost(HOSTS.groq)).toBe('granted');
    expect(perms.request).toHaveBeenCalledWith({ origins: ['https://api.groq.com/*'] });
  });
  it('returns denied when the person denies', async () => {
    stubPermissions(false, false);
    expect(await requestHost(HOSTS.openverse)).toBe('denied');
  });
  it('skips the prompt when the host is already allowed', async () => {
    const perms = stubPermissions(true, false);
    expect(await requestHost(HOSTS.pexels)).toBe('granted');
    expect(perms.request).not.toHaveBeenCalled();
  });
  it('returns denied when Chrome throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubPermissions(false, new Error('no gesture'));
    expect(await requestHost(HOSTS.penv)).toBe('denied');
  });
});
