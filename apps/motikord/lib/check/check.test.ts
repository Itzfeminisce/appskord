import { describe, expect, it } from 'vitest';
import { exportPlan } from './plan';
import { easeInOutCubic, easeOutBack, layerKind, poseAt, sceneAt } from './scene';
import { frameStats, percentile, round } from './stats';
import { failed, numbersText, shapeResults } from './results';
import { exportVerdict, memoryVerdict, previewVerdict, supportVerdict } from './verdict';

describe('stats', () => {
  it('takes the nearest-rank percentile', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
  });

  it('counts fps and dropped frames from rAF intervals', () => {
    const smooth = frameStats(Array(60).fill(1000 / 60));
    expect(round(smooth.meanFps)).toBe(60);
    expect(smooth.dropped).toBe(0);
    const janky = frameStats([16.7, 16.7, 50, 33.3]);
    expect(janky.dropped).toBe(3);
    expect(janky.p95Ms).toBe(50);
    expect(frameStats([]).meanFps).toBe(0);
  });
});

describe('verdicts', () => {
  it('judges against the plan budget', () => {
    expect(previewVerdict(30)).toBe('Pass');
    expect(previewVerdict(29.9)).toBe('Slow');
    expect(exportVerdict(30)).toBe('Pass');
    expect(exportVerdict(30.1)).toBe('Slow');
    expect(exportVerdict(12, 6)).toBe('Pass');
    expect(exportVerdict(13, 6)).toBe('Slow');
    expect(memoryVerdict(399)).toBe('Pass');
    expect(memoryVerdict(400)).toBe('Slow');
    expect(supportVerdict(false)).toBe('Fail');
  });
});

describe('results', () => {
  it('lists every test in order, run or not', () => {
    const out = shapeResults({ cores: 4 }, { mp4: { verdict: 'Pass', numbers: { seconds: 21.5 } }, gif: failed(new Error('no worker')) }, '2026-10-30T00:00:00.000Z');
    expect(out.tests).toHaveLength(8);
    expect(out.tests[0]).toEqual({ id: 'preview', name: '1. Preview', verdict: 'Not run' });
    expect(out.tests[1]).toMatchObject({ id: 'mp4', verdict: 'Pass', seconds: 21.5 });
    expect(out.tests[4]).toMatchObject({ verdict: 'Fail', error: 'no worker' });
    expect(numbersText({ a: 1, b: 'x' })).toBe('a: 1\nb: x');
  });
});

describe('scene and plan', () => {
  it('eases from 0 to 1', () => {
    for (const ease of [easeInOutCubic, easeOutBack]) {
      expect(ease(0)).toBeCloseTo(0);
      expect(ease(1)).toBeCloseTo(1);
    }
  });

  it('splits 15 s into 3 scenes and loops', () => {
    expect(sceneAt(0)).toEqual({ scene: 0, local: 0 });
    expect(sceneAt(7)).toEqual({ scene: 1, local: 2 });
    expect(sceneAt(16).scene).toBe(0);
  });

  it('has 2 images, 3 texts and 5 shapes, deterministic per frame', () => {
    const kinds = Array.from({ length: 10 }, (_, i) => layerKind(i));
    expect(kinds.filter((k) => k === 'image')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'text')).toHaveLength(3);
    expect(poseAt(3, 2.5, 1920, 1080)).toEqual(poseAt(3, 2.5, 1920, 1080));
    expect(poseAt(3, 2.5, 1920, 1080).alpha).toBeGreaterThan(0.9);
  });

  it('plans 450 frames at 1080p30 and 90 GIF frames', () => {
    expect(exportPlan('mp4')).toMatchObject({ width: 1920, height: 1080, frames: 450 });
    expect(exportPlan('gif')).toMatchObject({ width: 480, frames: 90 });
  });
});
