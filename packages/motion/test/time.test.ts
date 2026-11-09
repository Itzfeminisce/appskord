import { describe, expect, it } from 'vitest';
import { frameCount, frameMs } from '../src/time';

describe('frameCount', () => {
  it('round-trips every frame boundary at 30 and 60 fps', () => {
    for (const fps of [30, 60]) {
      for (let f = 0; f < 20000; f++) expect(frameCount(frameMs(f, fps), fps)).toBe(f);
    }
  });
});
