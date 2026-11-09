import { describe, expect, it } from 'vitest';
import {
  blocksVerdict,
  exportVerdict,
  failedRow,
  memoryVerdict,
  previewVerdict,
  SCENE,
  v3Row,
  V3_ROWS,
} from '../src/check';

describe('v3 check verdicts', () => {
  it('passes the building blocks only when all load', () => {
    expect(blocksVerdict(10, 10)).toBe('Pass');
    expect(blocksVerdict(9, 10)).toBe('Fail');
  });

  it('needs 30 fps preview', () => {
    expect(previewVerdict(30)).toBe('Pass');
    expect(previewVerdict(29.9)).toBe('Slow');
  });

  it('allows 4x clip length at 30 fps and twice that at 60 fps', () => {
    expect(SCENE.seconds).toBe(15);
    expect(exportVerdict(60, 30)).toBe('Pass');
    expect(exportVerdict(60.1, 30)).toBe('Slow');
    expect(exportVerdict(120, 60)).toBe('Pass');
    expect(exportVerdict(121, 60)).toBe('Slow');
  });

  it('keeps memory under 1.5 GB', () => {
    expect(memoryVerdict(1535)).toBe('Pass');
    expect(memoryVerdict(1536)).toBe('Slow');
  });
});

describe('v3 rows', () => {
  it('lists the five rows in order', () => {
    expect(V3_ROWS.map((r) => r.name)).toEqual([
      'Building blocks load',
      'Preview speed',
      'Export 30 fps',
      'Export 60 fps',
      'Memory',
    ]);
  });

  it('names the fallback only when a row misses', () => {
    expect(v3Row('preview', 'Pass', 40, 'fps', {}).fallback).toBeNull();
    expect(v3Row('preview', 'Slow', 20, 'fps', {}).fallback).toBe('fewer effects in preview');
    expect(v3Row('export60', 'Slow', 130, 's', {}).fallback).toBe('30 fps default');
    expect(failedRow('memory', new Error('boom'))).toMatchObject({ verdict: 'Fail', numbers: { error: 'boom' } });
  });
});
