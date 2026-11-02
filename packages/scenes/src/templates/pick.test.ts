import { describe, expect, it } from 'vitest';
import { paceMs, transitionFor } from './pick';
import { getPack } from './scenes';

describe('pace and transitions', () => {
  it('sets scene and transition lengths by pace', () => {
    expect(paceMs('calm')).toEqual({ sceneMs: 4500, transitionMs: 600 });
    expect(paceMs('normal')).toEqual({ sceneMs: 3000, transitionMs: 400 });
    expect(paceMs('fast')).toEqual({ sceneMs: 1750, transitionMs: 250 });
  });

  it("cycles the pack's transitions", () => {
    const bold = getPack('bold')!;
    expect([0, 1, 2, 3].map((i) => transitionFor(bold, i, 'fast'))).toEqual([
      { kind: 'push', ms: 250 },
      { kind: 'wipe', ms: 250 },
      { kind: 'zoom', ms: 250 },
      { kind: 'push', ms: 250 },
    ]);
    expect(transitionFor(getPack('playful')!, 2)).toEqual({ kind: 'match', ms: 0 });
    expect(transitionFor(getPack('clean')!, 1)).toEqual({ kind: 'slide', ms: 400 });
  });
});
