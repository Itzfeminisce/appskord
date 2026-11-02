import { describe, expect, it } from 'vitest';
import type { MixPlan } from '@/lib/audio/mix';
import { DRIFT_MS, measureKey, moved } from './useAudio';

const plan: MixPlan = { length: 1000, parts: [], music: null, denoise: false, level: false };

describe('preview sound follows the playhead', () => {
  it('restarts only when the playhead jumps, not while it runs on with the clock', () => {
    const started = { out: 1000, at: 50_000 };
    expect(moved(started, 3000, 52_000)).toBe(false);
    expect(moved(started, 3000 + DRIFT_MS + 1, 52_000)).toBe(true);
    expect(moved(started, 0, 52_000)).toBe(true);
  });

  it('measures again for changes to the sound, not for the level switches', () => {
    expect(measureKey({ ...plan, level: true, denoise: true })).toBe(measureKey(plan));
    expect(measureKey({ ...plan, length: 2000 })).not.toBe(measureKey(plan));
  });
});
