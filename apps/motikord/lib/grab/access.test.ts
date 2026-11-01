import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessRequest, ALL_SITES, requestPageAccess } from './access';

describe('accessRequest', () => {
  it('asks for every site when the URL is unknown', () => expect(accessRequest(undefined)).toEqual(ALL_SITES));
  it('asks for just the origin when the URL is known', () => expect(accessRequest('https://example.com/a/b?q=1')).toEqual(['https://example.com/*']));
  it('asks for nothing on pages Chrome refuses', () => {
    for (const url of ['chrome://extensions', 'https://chromewebstore.google.com/detail/x', 'https://example.com/file.pdf']) expect(accessRequest(url)).toBeUndefined();
  });
});

describe('requestPageAccess', () => {
  const stub = (result: boolean | Error) => {
    const request = vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)));
    vi.stubGlobal('chrome', { permissions: { request } });
    return request;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('is granted for an unknown URL after asking for all sites', async () => {
    const request = stub(true);
    expect(await requestPageAccess(undefined)).toBe('granted');
    expect(request).toHaveBeenCalledWith({ origins: ALL_SITES });
  });
  it('asks for one origin when the URL is known', async () => {
    const request = stub(true);
    await requestPageAccess('https://example.com/x');
    expect(request).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
  });
  it('is denied when the person says no or Chrome throws', async () => {
    stub(false);
    expect(await requestPageAccess(undefined)).toBe('denied');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stub(new Error('x'));
    expect(await requestPageAccess(undefined)).toBe('denied');
  });
  it('is blocked without asking on a Chrome page', async () => {
    const request = stub(true);
    expect(await requestPageAccess('chrome://settings')).toBe('blocked');
    expect(request).not.toHaveBeenCalled();
  });
});
