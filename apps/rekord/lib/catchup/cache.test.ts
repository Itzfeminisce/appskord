import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { record } from '../ledger';
import { V41_EVENTS, V41_NOW } from '../memory/sample';
import { CALENDAR_LEDGER_WHAT, type EventCache, dismissedIds, dismissMissed, EVENTS_KEY, pastEvents, PAST_MS, refreshEventCache, splitEvents } from '../reminders';
import { DEFAULT_SETTINGS, updateSettings } from '../settings';
import type { CalendarEvent } from '../types';
import { findMissed } from './missed';
import { DISMISSED_KEY } from './types';

vi.mock('../ledger', async (original) => ({ ...(await original<typeof import('../ledger')>()), record: vi.fn(async () => undefined) }));

beforeEach(() => {
  fakeBrowser.reset();
  vi.mocked(record).mockClear();
});

const later: CalendarEvent = { id: 'evt-later', title: 'Later', start: V41_NOW + 3_600_000, end: V41_NOW + 7_200_000, attendees: [] };

describe('event cache, 7 days back', () => {
  it('asks Google for the last 7 days and next 24 hours, and keeps ended events by id', async () => {
    await updateSettings({ google: { ...DEFAULT_SETTINGS.google, calendar: true } });
    const list = vi.fn(async () => [...V41_EVENTS, later]);
    expect(await refreshEventCache(V41_NOW, { list })).toEqual([later]);
    expect(list).toHaveBeenCalledWith(undefined, V41_NOW, {}, V41_NOW + 24 * 3_600_000, V41_NOW - PAST_MS);
    expect(record).toHaveBeenCalledWith({ service: 'google-calendar', what: CALENDAR_LEDGER_WHAT, at: V41_NOW });
    const cache = (await fakeBrowser.storage.local.get(EVENTS_KEY))[EVENTS_KEY] as EventCache;
    expect(Object.keys(cache.past ?? {}).sort()).toEqual(V41_EVENTS.map((e) => e.id).sort());
    expect((await pastEvents(V41_NOW)).map((e) => e.id).sort()).toEqual(V41_EVENTS.map((e) => e.id).sort());
  });

  it('splits on now and drops events older than 7 days; old caches without `past` still read', async () => {
    const old = { ...later, id: 'old', start: V41_NOW - PAST_MS - 7_200_000, end: V41_NOW - PAST_MS - 3_600_000 };
    const { events, past } = splitEvents([old, ...V41_EVENTS, later], V41_NOW);
    expect(events).toEqual([later]);
    expect(past.old).toBeUndefined();
    await fakeBrowser.storage.local.set({ [EVENTS_KEY]: { savedAt: V41_NOW, events: [V41_EVENTS[0]!, later] } });
    expect((await pastEvents(V41_NOW)).map((e) => e.id)).toEqual([V41_EVENTS[0]!.id]);
  });
});

describe('dismissed cards', () => {
  it('stores event ids under catchup.dismissed, once each, and hides the card', async () => {
    expect(await dismissedIds()).toEqual([]);
    await dismissMissed('evt-northwind-1102');
    await dismissMissed('evt-northwind-1102');
    expect((await fakeBrowser.storage.local.get(DISMISSED_KEY))[DISMISSED_KEY]).toEqual(['evt-northwind-1102']);
    expect(findMissed(V41_EVENTS, [], await dismissedIds(), V41_NOW).map((e) => e.id)).not.toContain('evt-northwind-1102');
  });
});
