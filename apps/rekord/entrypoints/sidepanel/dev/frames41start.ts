// v4.1 T4 dev frames: Home with the missed-meeting card, the picker, Something else, and Settings (#/dev/V41<Frame>).
import { getDB } from '@/lib/db';
import { DISMISSED_KEY } from '@/lib/catchup/types';
import { SAMPLE_MEETINGS, seedSampleV41, V41_EVENT, V41_EVENTS, V41_NOW } from '@/lib/memory/sample';
import { putVectors } from '@/lib/memory/store';
import { EVENTS_KEY } from '@/lib/reminders';
import { getSettings, updateSettings } from '@/lib/settings';
import type { CalendarEvent } from '@/lib/types';
import { world } from '../components/v4/world';
import { settingsDev } from '../screens/v4/SettingsMemory';
import { pickOtherDev } from '../screens/v41/PickOther';
import type { DevFrame } from './frames';

const MB = 1024 * 1024;
const at = (month: number, day: number, h: number, m: number) => new Date(2026, month - 1, day, h, m).getTime();

const realNow = Date.now.bind(Date);

/** A second calendar meeting missed today (V41HomeTwoMissed). */
const EARLIER: CalendarEvent = {
  ...V41_EVENT, id: 'evt-customer-1102', title: 'Customer call', start: at(11, 2, 11, 30), end: at(11, 2, 12, 0),
};

/** Google Calendar connected and its last 7 days cached; the missed-meeting hook reads the real clock, so it follows the frame's. */
export async function calendarWorld(events: CalendarEvent[]) {
  const real = realNow;
  const shift = world.now() - real();
  Date.now = () => real() + shift;
  const settings = await getSettings();
  await updateSettings({ google: { ...settings.google, calendar: true }, missedMeetingCard: true });
  await browser.storage.local.set({ [EVENTS_KEY]: { savedAt: world.now(), events: [], past: Object.fromEntries(events.map((e) => [e.id, e])) } });
  await browser.storage.local.remove(DISMISSED_KEY);
}

/** Search windows for every sample meeting, so "Memory size" reads about 3 MB as in the frame. */
async function seedVectors() {
  const text = 'We agreed to send the revised pricing deck to Northwind before the next sync.';
  for (const m of SAMPLE_MEETINGS) {
    await putVectors(Array.from({ length: 250 }, (_, i) => ({
      id: `${m.id}-v${i}`, meetingId: m.id, atMs: i * 10_000, endMs: i * 10_000 + 30_000, text, v: new Int8Array(384).fill(i % 100), scale: 0.01,
    })));
  }
}

export const FRAMES_41_START = {
  V41Home: { screen: 'home', now: V41_NOW, setup: () => calendarWorld(V41_EVENTS) },
  V41HomeTwoMissed: { screen: 'home', now: V41_NOW, setup: () => calendarWorld([...V41_EVENTS, EARLIER]) },
  V41Pick: { screen: 'catchupPick', now: V41_NOW, setup: () => calendarWorld(V41_EVENTS) },
  V41PickOther: {
    screen: 'catchupPickOther', now: V41_NOW,
    setup: async () => { pickOtherDev.form = { name: 'Lunch with Dana', date: '2026-10-30', start: '12:30', attendees: [{ name: 'Dana Ruiz' }] }; },
  },
  V41Settings: {
    screen: 'settingsMemory', now: V41_NOW,
    setup: async () => {
      await seedSampleV41(await getDB(), 'after');
      settingsDev.model = { state: 'ready', bytes: 22 * MB };
      await seedVectors();
    },
  },
} satisfies Record<string, DevFrame>;
