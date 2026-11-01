import { describe, expect, it } from 'vitest';
import { decodeVerdict, drawVerdict, encodeVerdict, fpsOf, keyframeBefore, memoryLine, resultsText, seekPoints, summaryRow } from './v3';

describe('fpsOf', () => {
  it('turns frames and ms into fps', () => {
    expect(fpsOf(150, 3000)).toBe(50);
    expect(fpsOf(0, 1000)).toBe(0);
    expect(fpsOf(10, 0)).toBe(0);
  });
});

describe('encodeVerdict', () => {
  it('passes 1080p at 30 fps and misses at 29', () => {
    expect(encodeVerdict('1080p', true, 150, 5000).verdict).toBe('pass');
    expect(encodeVerdict('1080p', true, 145, 5000).verdict).toBe('miss');
  });
  it('needs 50 fps at 720p', () => {
    expect(encodeVerdict('720p', true, 150, 3000).verdict).toBe('pass');
    expect(encodeVerdict('720p', true, 150, 3100).verdict).toBe('miss');
  });
  it('misses and reports 0 fps when the config is unsupported', () => {
    expect(encodeVerdict('720p', false, 150, 1)).toMatchObject({ fps: 0, verdict: 'miss', supported: false });
  });
});

describe('decodeVerdict', () => {
  it('passes a fast first frame and short seeks', () => {
    expect(decodeVerdict(400, [100, 200, 300])).toMatchObject({ meanSeekMs: 200, worstSeekMs: 300, seeks: 3, verdict: 'pass' });
  });
  it('misses a slow first frame or slow average seek', () => {
    expect(decodeVerdict(3000, [100]).verdict).toBe('miss');
    expect(decodeVerdict(400, [300, 400]).verdict).toBe('miss');
  });
  it('misses when nothing was measured', () => {
    expect(decodeVerdict(0, []).verdict).toBe('miss');
  });
});

describe('drawVerdict', () => {
  it('needs 30 fps', () => {
    expect(drawVerdict(150, 5000)).toEqual({ fps: 30, verdict: 'pass' });
    expect(drawVerdict(100, 5000)).toEqual({ fps: 20, verdict: 'miss' });
  });
});

describe('keyframeBefore and seekPoints', () => {
  it('finds the last key frame at or before the target', () => {
    const keys = [0, 1_000_000, 2_000_000];
    expect(keyframeBefore(keys, 1_999_999)).toBe(1_000_000);
    expect(keyframeBefore(keys, 2_000_000)).toBe(2_000_000);
    expect(keyframeBefore(keys, 0)).toBe(0);
  });
  it('keeps seek points inside the clip', () => {
    expect(seekPoints([0, 0.5, 1, 2, -1], 60_000_000)).toEqual([0, 30_000_000, 59_999_940, 59_999_940, 0]);
  });
});

describe('memoryLine', () => {
  it('is absent without performance.memory', () => {
    expect(memoryLine(null)).toEqual({ usedMb: null, verdict: null });
  });
  it('compares to 1.5 GB', () => {
    expect(memoryLine(100 * 1_048_576)).toEqual({ usedMb: 100, verdict: 'pass' });
    expect(memoryLine(1600 * 1_048_576).verdict).toBe('miss');
  });
});

describe('resultsText', () => {
  it('lists each measure and shows Not measured yet rows as not measured', () => {
    const text = resultsText([summaryRow('Draw', 'pass', '31 fps'), summaryRow('Segmentation', null, '')], { cores: 4, chrome: '156' });
    expect(text).toBe('Klipkord v3 machine check, Chrome 156, 4 cores\nDraw: pass (31 fps)\nSegmentation: not measured');
  });
});
