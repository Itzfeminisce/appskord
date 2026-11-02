import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import { BRIEF_PREFIX, DUE_ALARM, LOOKBACK_ALARM, nextAt, planAlarms } from './reminders';
import { SAMPLE_EVENT, SAMPLE_NOW } from './memory/sample';

const memory = DEFAULT_SETTINGS.memory;
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

describe('reminder alarms', () => {
  it('briefs 5 minutes before, checks due promises at 09:00 and looks back on Friday at 16:00', () => {
    const now = at(3, 8, 0);
    const plan = planAlarms([SAMPLE_EVENT], memory, now);
    expect(plan).toEqual([
      { name: BRIEF_PREFIX + SAMPLE_EVENT.id, when: at(3, 9, 55) },
      { name: DUE_ALARM, when: at(3, 9), periodInMinutes: 1440 },
      { name: LOOKBACK_ALARM, when: at(6, 16), periodInMinutes: 7 * 1440 },
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
});
