import { describe, expect, it } from 'vitest';
import { shotFlag } from './DevSwitcher';

describe('shotFlag', () => {
  it('hides the dev picker with shot=1 or clean, in the query or after the hash', () => {
    expect(shotFlag('?shot=1', '#/dev/Settings')).toBe(true);
    expect(shotFlag('', '#/dev/Settings?shot=1')).toBe(true);
    expect(shotFlag('', '#/dev/ImageKey?clean')).toBe(true);
  });
  it('shows it again with shot=0 and leaves it as it was without a flag', () => {
    expect(shotFlag('', '#/dev/Privacy?shot=0')).toBe(false);
    expect(shotFlag('', '#/dev/Privacy')).toBeUndefined();
  });
});
