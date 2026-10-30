import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearKeys, loadKeys, mergeKeys, saveKeys } from './keys';
import { getKey } from './settings';

describe('keys', () => {
  beforeEach(() => fakeBrowser.reset());

  it('keeps keys in session storage under the settings key names', async () => {
    await saveKeys({ GROQ_API_KEY: 'gsk_test', PEXELS_API_KEY: 'pexels_test', OTHER: 'x' });
    expect(await getKey('groq')).toBe('gsk_test');
    expect(await loadKeys()).toEqual({ GROQ_API_KEY: 'gsk_test', PEXELS_API_KEY: 'pexels_test' });
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('merges and clears', async () => {
    await saveKeys({ GROQ_API_KEY: 'gsk_test' });
    await mergeKeys({ PEXELS_API_KEY: 'pexels_test' });
    expect(Object.keys(await loadKeys()).sort()).toEqual(['GROQ_API_KEY', 'PEXELS_API_KEY']);
    await clearKeys();
    expect(await loadKeys()).toEqual({});
  });
});
