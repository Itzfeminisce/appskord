import { describe, expect, it } from 'vitest';
import { onceAtATime } from './Templates';

describe('onceAtATime', () => {
  it('ignores a second call while the first runs, then allows another', async () => {
    let calls = 0;
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    const run = onceAtATime(async () => { calls++; await hold; });
    const a = run();
    const b = run();
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
    await run();
    expect(calls).toBe(2);
  });
  it('allows a retry after a failure', async () => {
    let calls = 0;
    const run = onceAtATime(async () => { calls++; throw new Error('x'); });
    await run().catch(() => undefined);
    await run().catch(() => undefined);
    expect(calls).toBe(2);
  });
});
