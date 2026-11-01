import { describe, expect, it } from 'vitest';
import { clock, minutesAgo, seconds } from './format';
import { editorPath } from './open';
import { recordingIdOf } from './router';

describe('editor address and times', () => {
  it('reads the recording id from #/<recordingId>', () => {
    expect(recordingIdOf('/rec-1')).toBe('rec-1');
    expect(recordingIdOf(new URL(`x:${editorPath('a b')}`).hash.slice(1))).toBe('a b');
    expect(recordingIdOf('/')).toBeUndefined();
  });

  it('formats times as the frames do', () => {
    expect(clock(402_000)).toBe('6:42');
    expect(clock(27_400, true)).toBe('0:27.4');
    expect(clock(3_723_000)).toBe('1:02:03');
    expect(seconds(800)).toBe('0.8 s');
  });
});

describe('recovered edits age', () => {
  it('counts whole minutes, never less than 1, even for a time in the future', () => {
    expect(minutesAgo(0, 5 * 60_000)).toBe(5);
    expect(minutesAgo(10_000, 0)).toBe(1);
    expect(minutesAgo(Number.NaN, 0)).toBe(1);
  });
});
