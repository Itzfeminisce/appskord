import { describe, expect, it } from 'vitest';
import { captureProblem } from './result';

describe('captureProblem', () => {
  it('tells a missing grant from a page Chrome never lets extensions read', () => {
    expect(captureProblem(new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.')).problem).toBe('no-access');
    expect(captureProblem(new Error('Cannot access a chrome:// URL')).problem).toBe('restricted');
    expect(captureProblem(new Error('The extensions gallery cannot be scripted.')).problem).toBe('restricted');
    expect(captureProblem('No tab with id: 4.')).toEqual({ ok: false, problem: 'failed', message: 'No tab with id: 4.' });
  });
});
