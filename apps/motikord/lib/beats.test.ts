import { describe, expect, it } from 'vitest';
import { beatSyncEdit, bpmOf, detectBeats, findBeats, snapCuts } from './beats';

const SR = 8000;
function clicks(bpm: number, seconds: number) {
  const s = new Float32Array(SR * seconds), step = Math.round((SR * 60) / bpm);
  for (let t = 0; t < s.length; t += step) for (let i = 0; i < 200 && t + i < s.length; i++) s[t + i] = 0.9 * Math.sin(i * 0.8);
  return s;
}

describe('detectBeats', () => {
  it('finds 120 BPM in a click track', () => {
    const r = detectBeats(clicks(120, 10), SR);
    expect(r.bpm).toBe(120);
    expect(r.beats.length).toBeGreaterThanOrEqual(19);
    expect(Math.abs(r.beats[1]! - 1000)).toBeLessThan(30);
  });
  it('finds nothing in silence', () => {
    expect(detectBeats(new Float32Array(SR * 5), SR)).toEqual({ beats: [], bpm: null });
  });
  it('wraps decoding with an injected decoder', async () => {
    const r = await findBeats(new Blob([new Uint8Array(4)]), { decode: async () => ({ samples: clicks(120, 6), sampleRate: SR }) });
    expect(r.bpm).toBe(120);
    expect(r.peaks).toHaveLength(120);
  });
});

describe('snapCuts', () => {
  const beats = [0, 500, 1000, 1500, 2000, 2500, 3000];
  it('moves cuts within 150 ms and keeps the total', () => {
    const out = snapCuts([1080, 1000, 900], beats);
    expect(out).toEqual([1000, 1000, 980]);
    expect(out.reduce((a, b) => a + b)).toBe(2980);
  });
  it('leaves cuts with no beat nearby', () => expect(snapCuts([1250, 1000], beats, 150)).toEqual([1250, 1000]));
});

describe('beatSyncEdit', () => {
  it('stores beats, the switch and snapped lengths in one change', () => {
    const r = { scenes: [{ durationMs: 1080, layers: [{ endMs: 1080 }] }, { durationMs: 1500, layers: [] }] } as never;
    const e = beatSyncEdit(r, [0, 500, 1000, 1500, 2000], true)!;
    expect(e.ops.map((o) => o.path)).toEqual(['/beats', '/beatSync', '/scenes/0/durationMs', '/scenes/0/layers/0/endMs', '/scenes/1/durationMs']);
  });
  it('bpmOf reads stored beats', () => expect(bpmOf([0, 500, 1000, 1500, 2000])).toBe(120));
});
