import { describe, expect, it, vi } from 'vitest';
import { requestOrigins } from './hostAccess';

const perms = (answer: boolean | Error) => ({
  request: vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  }),
});

describe('requestOrigins', () => {
  it('asks Chrome for exactly the origins', async () => {
    const permissions = perms(true);
    expect(await requestOrigins(['https://api.groq.com/*'], { permissions })).toBe(true);
    expect(permissions.request).toHaveBeenCalledWith({ origins: ['https://api.groq.com/*'] });
  });
  it('resolves false when the person refuses', async () => {
    expect(await requestOrigins(['https://penv.cloud/*'], { permissions: perms(false) })).toBe(false);
  });
  it('resolves false and reports when Chrome throws', async () => {
    const onError = vi.fn();
    expect(
      await requestOrigins(['https://penv.cloud/*'], { permissions: perms(new Error('no gesture')), onError }),
    ).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });
});
