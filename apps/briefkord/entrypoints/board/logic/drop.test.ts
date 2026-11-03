import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES } from '@/lib/store/files';
import { formatBytes, isBoardFile, planDrop } from './drop';

const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('planDrop', () => {
  it('adds images, PDFs and documents and skips videos and files over 50 MB', () => {
    const files = [f('a.png', 'image/png'), f('Demo recording.mov', 'video/quicktime'), f('r.pdf', 'application/pdf'), f('big.zip', 'application/zip', MAX_FILE_BYTES + 1), f('doc.docx', '')];
    const plan = planDrop(files);
    expect(plan.accepted.map((x) => x.name)).toEqual(['a.png', 'r.pdf', 'doc.docx']);
    expect(plan.skipped.map((s) => [s.file.name, s.reason])).toEqual([['Demo recording.mov', 'video'], ['big.zip', 'too-big']]);
    expect(plan.boardFile).toBeUndefined();
  });

  it('keeps a file of exactly 50 MB', () => {
    expect(planDrop([f('edge.pdf', 'application/pdf', MAX_FILE_BYTES)]).accepted).toHaveLength(1);
  });

  it('opens a .briefkord file as a board instead of adding anything', () => {
    const plan = planDrop([f('a.png', 'image/png'), f('Q4 roadmap.briefkord', '')]);
    expect(plan.boardFile?.name).toBe('Q4 roadmap.briefkord');
    expect(plan.accepted).toEqual([]);
    expect(isBoardFile({ name: 'x.BRIEFKORD' })).toBe(true);
    expect(isBoardFile({ name: 'x.briefkord.zip' })).toBe(false);
  });
});

describe('formatBytes', () => {
  it('writes sizes as the frames do', () => {
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
    expect(formatBytes(12_400_000)).toBe('12.4 MB');
    expect(formatBytes(3_000_000)).toBe('3 MB');
    expect(formatBytes(412_000)).toBe('412 KB');
    expect(formatBytes(13)).toBe('13 B');
  });
});
