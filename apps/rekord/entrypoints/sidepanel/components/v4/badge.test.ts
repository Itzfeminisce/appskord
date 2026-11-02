import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, getDB } from '@/lib/db';
import { SAMPLE_NOW, seedSample } from '@/lib/memory/sample';
import { badgeText, refreshBadge } from '../../../background';

describe('toolbar badge', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });

  it('shows the overdue count from Open loops, empty when nothing is overdue', async () => {
    const setText = vi.fn(async () => undefined);
    expect(await refreshBadge(SAMPLE_NOW, setText)).toBe('');
    await seedSample(await getDB());
    expect(await refreshBadge(SAMPLE_NOW, setText)).toBe('1');
    expect(setText).toHaveBeenLastCalledWith('1');
    // A week later more promises are overdue.
    expect(Number(await refreshBadge(SAMPLE_NOW + 7 * 86_400_000, setText))).toBeGreaterThan(1);
  });

  it('writes the count as text', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(3)).toBe('3');
  });
});
