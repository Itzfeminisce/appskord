import { describe, expect, it, vi } from 'vitest';
import { linkItem, matchPerson, mergeSuggestions, mergedPerson, planForget, relinkItem } from './link';
import { SAMPLE_ITEMS, SAMPLE_PEOPLE } from './sample';
import type { MemoryItem, Person } from './types';

const p = (id: string, name: string, patch: Partial<Person> = {}): Person => ({
  id, name, aliases: [], meetingIds: [], createdAt: 0, updatedAt: 0, ...patch,
});
const item = (id: string, patch: Partial<MemoryItem> = {}): MemoryItem => ({
  id, kind: 'promise', status: 'open', text: id, quote: { speaker: 'A', text: 't', meetingId: 'm', atMs: 0 }, meetingId: 'm',
  personIds: [], history: [], createdAt: 0, updatedAt: 0, ...patch,
});

describe('matchPerson', () => {
  const people = [p('a', 'Sarah Chen', { email: 'sarah@northwind.co', aliases: ['Sarah'] }), p('b', 'Sam Ortiz', { email: 'sam@x.io' }), p('c', 'Sam')];

  it('matches by email first, ignoring case', () => {
    expect(matchPerson({ name: 'Someone', email: 'SARAH@northwind.co' }, people).person?.id).toBe('a');
  });

  it('then by exact name, then by alias', () => {
    expect(matchPerson({ name: 'sam ortiz' }, people).person?.id).toBe('b');
    expect(matchPerson({ name: 'Sarah' }, people).person?.id).toBe('a');
  });

  it('suggests instead of guessing on a partial name', () => {
    const m = matchPerson({ name: 'Sarah Jones' }, people);
    expect(m.person).toBeUndefined();
    expect(m.suggestions.map((s) => s.id)).toEqual(['a']);
    expect(matchPerson({ name: 'Nobody' }, people)).toEqual({ suggestions: [] });
  });

  it('does not match a same-named person who has a different email', () => {
    const m = matchPerson({ name: 'Sam Ortiz', email: 'other@y.io' }, people);
    expect(m.person).toBeUndefined();
    expect(m.suggestions.map((s) => s.id)).toEqual(['b']);
  });
});

describe('mergeSuggestions', () => {
  it('pairs the sample "Sam" with Sam Ortiz only', () => {
    expect(mergeSuggestions(SAMPLE_PEOPLE).map(([a, b]) => [a.id, b.id])).toEqual([['p-sam-guest', 'p-sam']]);
  });
});

describe('mergeSuggestions without emails', () => {
  it('pairs "Sam" with "Sam Lee" whichever id sorts first, once', () => {
    for (const ids of [['a', 'z'], ['z', 'a']]) {
      const people = [p(ids[0]!, 'Sam'), p(ids[1]!, 'Sam Lee')];
      expect(mergeSuggestions(people).map(([x, y]) => [x.name, y.name])).toEqual([['Sam', 'Sam Lee']]);
      expect(mergeSuggestions([...people].reverse())).toHaveLength(1);
    }
  });
  it('de-duplicates two emailless people with the same name', () => {
    expect(mergeSuggestions([p('a', 'Sam'), p('b', 'Sam')])).toHaveLength(1);
  });
});

describe('linkItem', () => {
  const fresh = item('new');
  it('asks the AI about the best similar candidates of the same kind', async () => {
    const same = vi.fn(async (_f: MemoryItem, e: MemoryItem) => e.id === 'b');
    const got = await linkItem(fresh, [
      { item: item('a'), score: 0.9 }, { item: item('b'), score: 0.8 }, { item: item('low'), score: 0.2 },
      { item: item('dec', { kind: 'decision' }), score: 0.99 },
    ], same);
    expect(got?.id).toBe('b');
    expect(same.mock.calls.map(([, e]) => e.id)).toEqual(['a', 'b']);
  });
  it('returns nothing when the AI says no', async () => {
    expect(await linkItem(fresh, [{ item: item('a'), score: 0.9 }], async () => false)).toBeUndefined();
  });
});

describe('people edits', () => {
  it('plans forgetting Sarah: 2 promises, 2 decision links', () => {
    const plan = planForget('p-sarah', SAMPLE_ITEMS, 5);
    expect(plan.deleteIds.sort()).toEqual(['i-deck', 'i-q3']);
    expect(plan).toMatchObject({ promises: 2, decisionLinks: 2 });
    expect(plan.unlinked.every((i) => !i.personIds.includes('p-sarah') && i.updatedAt === 5)).toBe(true);
  });

  it('merges details and relinks items', () => {
    const merged = mergedPerson(p('k', 'Sam Ortiz', { email: 'sam@x.io', meetingIds: ['1'] }), p('d', 'Sam', { meetingIds: ['1', '2'] }), 9);
    expect(merged).toMatchObject({ id: 'k', email: 'sam@x.io', aliases: ['Sam'], meetingIds: ['1', '2'], updatedAt: 9 });
    const moved = relinkItem(item('i', { ownerId: 'd', personIds: ['d', 'k'] }), 'd', 'k', 9);
    expect(moved).toMatchObject({ ownerId: 'k', personIds: ['k'] });
  });
});
