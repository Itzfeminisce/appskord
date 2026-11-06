import { describe, expect, it } from 'vitest';
import { frameIndex } from './usePlayback';

describe('frameIndex', () => {
  it('changes once per frame at the given fps, so 60 Hz ticks re-render 30 times a second', () => {
    const ticks = Array.from({ length: 61 }, (_, i) => (i * 1000) / 60);
    const changes = ticks.filter((t, i) => i > 0 && frameIndex(t, 30) !== frameIndex(ticks[i - 1]!, 30));
    expect(changes).toHaveLength(30);
    expect(frameIndex(0, 30)).toBe(0);
    expect(frameIndex(33.4, 30)).toBe(1);
  });
});
