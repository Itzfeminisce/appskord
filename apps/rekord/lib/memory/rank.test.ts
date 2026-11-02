import { describe, expect, it } from 'vitest';
import { isoDay, nextWake, rankOpenLoops } from './rank';
import { SAMPLE_ITEMS, SAMPLE_NOW } from './sample';
import type { MemoryItem } from './types';

const item = (id: string, patch: Partial<MemoryItem>): MemoryItem => ({
  id, kind: 'promise', status: 'open', text: id, quote: { speaker: 'A', text: 't', meetingId: 'm', atMs: 0 }, meetingId: 'm',
  ownerId: 'me', personIds: [], history: [], createdAt: 0, updatedAt: 0, ...patch,
});

describe('rankOpenLoops', () => {
  it('gives the sample world header counts and badge', () => {
    const loops = rankOpenLoops(SAMPLE_ITEMS, SAMPLE_NOW);
    expect(loops.counts).toEqual({ youOwe: 3, owedToYou: 2, questions: 1 });
    expect(loops.overdue).toBe(1);
    expect(isoDay(SAMPLE_NOW)).toBe('2026-11-03');
  });

  it('orders the sample You owe tab into sections', () => {
    const { sections } = rankOpenLoops(SAMPLE_ITEMS, SAMPLE_NOW, 'youOwe');
    expect(sections.map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([
      ['overdue', ['i-deck']],
      ['noDate', ['i-checklist', 'i-proposal']],
    ]);
    const owed = rankOpenLoops(SAMPLE_ITEMS, SAMPLE_NOW, 'owedToYou').sections;
    expect(owed.map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([['today', ['i-q3']], ['thisWeek', ['i-launch-copy']]]);
  });

  it('hides snoozed, closed and decision items, and sorts by due date', () => {
    const items = [
      item('late', { due: '2026-11-06' }),
      item('soon', { due: '2026-11-04' }),
      item('snoozed', { snoozedUntil: SAMPLE_NOW + 1 }),
      item('woke', { snoozedUntil: SAMPLE_NOW - 1 }),
      item('done', { status: 'done' }),
      item('dec', { kind: 'decision' }),
      item('q', { kind: 'question', ownerId: undefined }),
    ];
    const loops = rankOpenLoops(items, SAMPLE_NOW);
    expect(loops.counts).toEqual({ youOwe: 3, owedToYou: 0, questions: 1 });
    expect(loops.sections.map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([
      ['thisWeek', ['soon', 'late']],
      ['noDate', ['woke', 'q']],
    ]);
  });
});

describe('snooze wake', () => {
  it('hides a snoozed item until its time, then it rejoins Open loops', () => {
    const snoozed = item('s', { snoozedUntil: 2_000 });
    expect(rankOpenLoops([snoozed], 1_000).counts.youOwe).toBe(0);
    expect(nextWake([snoozed], 1_000)).toBe(2_000);
    expect(rankOpenLoops([snoozed], 2_001).counts.youOwe).toBe(1);
    expect(nextWake([snoozed], 2_001)).toBeUndefined();
  });
});
