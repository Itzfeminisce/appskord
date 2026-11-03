import { describe, expect, it } from 'vitest';
import { SAMPLE_MEETINGS, V41_CATCHUP } from '../memory/sample';
import type { Meeting } from '../types';
import { isCatchup, itemMeta, quoteCaption } from './label';

describe('label', () => {
  it('says "From your catch-up" in place of the clock', () => {
    expect(itemMeta(V41_CATCHUP, '06:15')).toBe('Q4 planning with Northwind · 2 Nov · From your catch-up');
    expect(quoteCaption('Alex', V41_CATCHUP, '06:15')).toBe('Alex · Q4 planning with Northwind · 2 Nov · From your catch-up');
  });

  it('keeps the clock for recordings, and old meetings without source still load as recordings', () => {
    const old = JSON.parse(JSON.stringify({ ...SAMPLE_MEETINGS[1]!, source: undefined })) as Meeting;
    expect(old.source).toBeUndefined();
    expect(isCatchup(old)).toBe(false);
    expect(isCatchup(undefined)).toBe(false);
    expect(itemMeta(old, '40:18')).toBe('Pricing review · 26 Oct · 40:18');
  });
});
