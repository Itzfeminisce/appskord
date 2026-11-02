import { describe, expect, it } from 'vitest';
import { SAMPLE_MEETINGS, V41_CATCHUP, V41_EVENT, V41_EVENTS, V41_NOW } from '../memory/sample';
import type { CalendarEvent, Meeting } from '../types';
import { findMissed, isMatched, recentForPicker } from './missed';

const H = 3_600_000;
const ev = (id: string, endAgoH: number, self = true): CalendarEvent => ({
  id, title: id, start: V41_NOW - (endAgoH + 1) * H, end: V41_NOW - endAgoH * H,
  attendees: [{ email: 'a@x.co', ...(self ? { self: true } : {}) }, { email: 'b@x.co' }],
});

describe('findMissed', () => {
  it('finds the Northwind meeting on the sample world, not the recorded sync or older ones', () => {
    expect(findMissed(V41_EVENTS, SAMPLE_MEETINGS, [], V41_NOW).map((e) => e.id)).toEqual([V41_EVENT.id]);
  });

  it('drops dismissed, caught-up, not-yet-ended, older than 24 h and not-attended events', () => {
    const events = [ev('ok', 2), ev('dismissed', 3), ev('future', -1), ev('old', 25), ev('not-me', 2, false)];
    expect(findMissed(events, [], ['dismissed'], V41_NOW).map((e) => e.id)).toEqual(['ok']);
    expect(findMissed(V41_EVENTS, [...SAMPLE_MEETINGS, V41_CATCHUP], [], V41_NOW)).toEqual([]);
  });

  it('lists each event once, newest end first', () => {
    expect(findMissed([ev('a', 5), ev('b', 1), ev('a', 5)], [], [], V41_NOW).map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('isMatched', () => {
  const m = (startedAt: number, event?: CalendarEvent): Meeting => ({ id: 'm', title: 'e', startedAt, status: 'done', language: 'en', ...(event ? { event } : {}) });
  it('matches by event id, or by title and start time when no event is attached', () => {
    const e = ev('e', 1);
    expect(isMatched(e, [m(0, e)])).toBe(true);
    expect(isMatched(e, [m(e.start, { ...e, id: 'other' })])).toBe(false);
    expect(isMatched(e, [m(e.start + 5 * 60_000)])).toBe(true);
    expect(isMatched(e, [{ ...m(e.start), title: 'Intro with Lumen' }])).toBe(false);
    expect(isMatched(e, [m(e.end)])).toBe(false);
  });
  it('treats a form catch-up (event id form:…) as unlinked: title and time decide', () => {
    const e = ev('e', 1);
    const form = (startedAt: number, title = 'e'): Meeting => ({ ...m(startedAt, { ...e, id: 'form:m' }), title });
    expect(isMatched(e, [form(e.start)])).toBe(true);
    expect(isMatched(e, [form(e.start, 'Other')])).toBe(false);
    expect(isMatched(e, [form(e.end + 60_000)])).toBe(false);
  });
});

describe('recentForPicker', () => {
  it('lists the last 7 days with no recording, newest first (V41Pick)', () => {
    expect(recentForPicker(V41_EVENTS, SAMPLE_MEETINGS, V41_NOW).map((e) => e.title)).toEqual(['Q4 planning with Northwind', 'Hiring sync', 'Team retro']);
  });

  it('skips events older than 7 days or not over yet', () => {
    expect(recentForPicker([ev('old', 24 * 7 + 1), ev('soon', -2), ev('week', 24 * 6)], [], V41_NOW).map((e) => e.id)).toEqual(['week']);
  });
});
