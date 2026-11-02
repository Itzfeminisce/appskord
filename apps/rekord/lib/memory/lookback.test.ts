import { describe, expect, it } from 'vitest';
import type { Meeting } from '../types';
import { buildWeek, carriedDue, durationLabel, lookBackMarkdown, lookBackNote, weekLabel, weekStart } from './lookback';
import { SAMPLE_ITEMS, SAMPLE_MEETINGS, SAMPLE_PEOPLE } from './sample';

const FRI = new Date(2026, 9, 30, 16, 0).getTime();
const byId = (id: string) => SAMPLE_ITEMS.find((i) => i.id === id)!;

describe('look back', () => {
  it('names the week and its time', () => {
    expect(weekLabel(weekStart(FRI))).toBe('26 to 30 Oct');
    expect(weekLabel(weekStart(new Date(2026, 9, 2).getTime()))).toBe('28 Sep to 2 Oct');
    expect(durationLabel(400)).toBe('6 h 40 min');
    expect(durationLabel(40)).toBe('40 min');
  });

  it('counts the week’s meetings, promises and decisions', () => {
    const extra: Meeting = { id: 'm-x', title: 'Extra', startedAt: new Date(2026, 9, 30, 11).getTime(), endedAt: new Date(2026, 9, 30, 11, 30).getTime(), status: 'done', language: 'en', source: 'tab' };
    const week = buildWeek({ meetings: [...SAMPLE_MEETINGS, extra], items: SAMPLE_ITEMS, people: SAMPLE_PEOPLE, now: FRI });
    // Pricing review 50, sync 47, 1:1 30, Lumen 30, Extra 30.
    expect([week.meetings, week.minutes]).toEqual([5, 187]);
    expect([week.promisesMade, week.promisesKept, week.decisions]).toEqual([6, 2, 3]);
    expect(week.decided[0]).toMatchObject({ item: { id: 'd-team-12' }, replaces: { id: 'd-team-10' } });
    expect(week.stillOpen.map((i) => i.id)).toEqual(['i-deck', 'q-free-plan', 'i-proposal']);
    expect(week.people[0]).toMatchObject({ person: { id: 'p-priya' }, meetings: 2 });
    expect(week.late).toEqual([]);
    expect(lookBackNote(week).title).toBe('Your week · 26 to 30 Oct');
    const md = lookBackMarkdown(week, new Map(SAMPLE_PEOPLE.map((p) => [p.id, p])), FRI);
    expect(md).toContain('# Your week · 26 to 30 Oct');
    expect(md).toContain('- Team plan is $12 a seat (Replaces: Team plan is $10 a seat)');
    expect(md).toContain('- Send the revised pricing deck (To Sarah · due Fri 30 Oct)');
  });

  it('lists promises late more than a week, and carries a week on', () => {
    const late = { ...byId('i-q3'), id: 'late', due: '2026-10-22' };
    expect(buildWeek({ meetings: [], items: [late], people: [], now: FRI }).late.map((i) => i.id)).toEqual(['late']);
    expect(carriedDue(byId('i-deck'), FRI)).toBe('2026-11-06');
    expect(carriedDue(byId('i-launch-copy'), FRI)).toBe('2026-11-12');
  });
});
