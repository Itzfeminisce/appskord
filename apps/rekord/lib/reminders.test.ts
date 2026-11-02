import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { closeDB, putMeeting } from './db';
import { record } from './ledger';
import { buildBrief } from './memory/brief';
import { lookBackStart } from './memory/lookback';
import { putItem, putPerson } from './memory/store';
import { saveKeys } from './penv';
import { DEFAULT_SETTINGS } from './settings';
import {
  BRIEF_PREFIX, BRIEFED_KEY, DUE_ALARM, EVENTS_KEY, lastTime, lastTimeKey, LOOKBACK_ALARM, nextAt, NOTE_BRIEF, NOTE_LOOKBACK, onReminderAlarm, planAlarms, scheduleReminders,
} from './reminders';
import { SAMPLE_EVENT, SAMPLE_ITEMS, SAMPLE_MEETINGS, SAMPLE_NOW, SAMPLE_PEOPLE } from './memory/sample';

vi.mock('./ledger', async (original) => ({ ...(await original<typeof import('./ledger')>()), record: vi.fn(async () => undefined) }));

beforeEach(async () => {
  fakeBrowser.reset();
  vi.mocked(record).mockClear();
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
});

const memory = DEFAULT_SETTINGS.memory;
const MIN = 60_000;
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

describe('reminder alarms', () => {
  it('briefs 5 minutes before, checks due promises at 09:00 and looks back on Friday at 16:00', () => {
    const now = at(3, 8, 0);
    const plan = planAlarms([SAMPLE_EVENT], memory, now);
    expect(plan).toEqual([
      { name: BRIEF_PREFIX + SAMPLE_EVENT.id, when: at(3, 9, 55) },
      { name: DUE_ALARM, when: at(3, 9) },
      { name: LOOKBACK_ALARM, when: at(6, 16) },
    ]);
  });

  it('follows the settings and skips meetings past or beyond 24 hours', () => {
    const later = { ...SAMPLE_EVENT, id: 'later', start: at(5, 10), end: at(5, 11) };
    const off = { ...memory, brief: { on: true, minutes: 15 as const }, dueReminders: false, lookBack: { ...memory.lookBack, on: false } };
    expect(planAlarms([SAMPLE_EVENT, later], off, at(3, 8))).toEqual([{ name: BRIEF_PREFIX + SAMPLE_EVENT.id, when: at(3, 9, 45) }]);
    expect(planAlarms([SAMPLE_EVENT], { ...memory, brief: { on: false, minutes: 5 } }, at(3, 8)).map((p) => p.name)).toEqual([DUE_ALARM, LOOKBACK_ALARM]);
    // Inside the lead time the brief goes out right away; after the start, never.
    expect(planAlarms([SAMPLE_EVENT], off, SAMPLE_NOW)[0]?.when).toBe(SAMPLE_NOW + 1000);
    expect(planAlarms([SAMPLE_EVENT], off, at(3, 10, 5))).toEqual([]);
  });

  it('finds the next hour and weekday', () => {
    expect(nextAt(at(3, 10), 9)).toBe(at(4, 9));
    expect(nextAt(at(6, 16), 16, 5)).toBe(at(13, 16));
    expect(nextAt(at(6, 15), 16, 5)).toBe(at(6, 16));
  });

  it('briefs each meeting once a session, and keeps a brief already due', async () => {
    await fakeBrowser.storage.local.set({ [EVENTS_KEY]: { savedAt: SAMPLE_NOW, events: [SAMPLE_EVENT] } });
    const name = BRIEF_PREFIX + SAMPLE_EVENT.id;
    await scheduleReminders(SAMPLE_NOW);
    expect((await fakeBrowser.alarms.get(name))?.scheduledTime).toBe(SAMPLE_NOW + 1000);
    // Opened again a moment later: the alarm already due is not pushed back.
    await scheduleReminders(SAMPLE_NOW + 500);
    expect((await fakeBrowser.alarms.get(name))?.scheduledTime).toBe(SAMPLE_NOW + 1000);
    await onReminderAlarm(name, SAMPLE_NOW + 1000);
    expect((await fakeBrowser.storage.session.get(BRIEFED_KEY))[BRIEFED_KEY]).toEqual([SAMPLE_EVENT.id]);
    await fakeBrowser.alarms.clear(name);
    expect(planAlarms([SAMPLE_EVENT], memory, SAMPLE_NOW + 2000, [SAMPLE_EVENT.id]).map((p) => p.name)).toEqual([DUE_ALARM, LOOKBACK_ALARM]);
    await scheduleReminders(SAMPLE_NOW + 2000);
    expect(await fakeBrowser.alarms.get(name)).toBeUndefined();
    expect(await fakeBrowser.notifications.getAll()).toHaveProperty(NOTE_BRIEF + SAMPLE_EVENT.id);
  });

  it('keeps 09:00 and Friday 16:00 across a clock change, planning the next one when each fires', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Europe/London';
    try {
      // Clocks go back on Sunday 25 Oct 2026.
      const sat = new Date(2026, 9, 24, 9).getTime();
      expect(nextAt(sat, 9)).toBe(new Date(2026, 9, 25, 9).getTime());
      expect(nextAt(sat, 9) - sat).toBe(25 * 60 * MIN);
      await fakeBrowser.alarms.create(DUE_ALARM, { when: sat, periodInMinutes: 1440 });
      await onReminderAlarm(DUE_ALARM, sat);
      const due = await fakeBrowser.alarms.get(DUE_ALARM);
      expect(due?.scheduledTime).toBe(new Date(2026, 9, 25, 9).getTime());
      expect(due?.periodInMinutes).toBeUndefined();
      const fri = new Date(2026, 9, 23, 16).getTime();
      await onReminderAlarm(LOOKBACK_ALARM, fri);
      expect((await fakeBrowser.alarms.get(LOOKBACK_ALARM))?.scheduledTime).toBe(new Date(2026, 9, 30, 16).getTime());
    } finally {
      process.env.TZ = tz;
    }
  });

  it('looks back on the week just ended from Saturday to Monday', async () => {
    const mon26 = new Date(2026, 9, 26).getTime();
    expect(lookBackStart(new Date(2026, 9, 30, 16).getTime())).toBe(mon26);
    expect(lookBackStart(new Date(2026, 9, 31, 10).getTime())).toBe(mon26);
    expect(lookBackStart(new Date(2026, 10, 1, 10).getTime())).toBe(mon26);
    expect(lookBackStart(at(2, 9))).toBe(mon26);
    expect(lookBackStart(at(3, 9))).toBe(at(2, 0));
    await onReminderAlarm(LOOKBACK_ALARM, at(2, 9));
    expect(await fakeBrowser.notifications.getAll()).toHaveProperty(NOTE_LOOKBACK + mon26);
  });
});

describe('last time', () => {
  const brief = buildBrief({ event: SAMPLE_EVENT, people: SAMPLE_PEOPLE, items: SAMPLE_ITEMS, meetings: SAMPLE_MEETINGS, now: SAMPLE_NOW });

  it('keeps the local lines for the session after a failed call, and logs the call against the meeting', async () => {
    const last = brief.last!;
    await Promise.all([...SAMPLE_ITEMS.map(putItem), ...SAMPLE_PEOPLE.map(putPerson), ...SAMPLE_MEETINGS.map(putMeeting)]);
    await saveKeys({ GROQ_API_KEY: 'gsk_test' });
    const fetchFn = vi.fn(async () => new Response('down', { status: 500 }));
    const lines = await lastTime(brief, { fetchFn });
    expect(lines.length).toBeGreaterThan(0);
    expect((await fakeBrowser.storage.session.get(lastTimeKey(last.id)))[lastTimeKey(last.id)]).toEqual(lines);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ service: 'groq', meetingId: last.id }));
    const calls = fetchFn.mock.calls.length;
    expect(await lastTime(brief, { fetchFn })).toEqual(lines);
    expect(fetchFn.mock.calls.length).toBe(calls);
  });
});
