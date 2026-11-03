import { describe, expect, it } from 'vitest';
import { V41_CATCHUP } from '../memory/sample';
import { catchupPreamble, preambleFor } from './preamble';

describe('catchupPreamble', () => {
  it('fills in the meeting’s date, not the telling’s', () => {
    expect(catchupPreamble(V41_CATCHUP.startedAt)).toBe(
      'This is the user retelling a meeting from memory. Lines are the user\'s words. Attribute promises, decisions and questions to the people the user names, not to the speaker of the line. Work out dates from the meeting date 2026-11-02.');
  });

  it('is empty for recordings, including old meetings with no source', () => {
    expect(preambleFor(V41_CATCHUP)).toContain('2026-11-02');
    expect(preambleFor({ startedAt: 0 })).toBe('');
    expect(preambleFor({ startedAt: 0, source: 'app' })).toBe('');
  });
});
