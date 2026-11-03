// Before the meeting: the event cache (7 days back, 24 hours ahead), alarms, notifications, and the brief's one AI call.
import { DISMISSED_KEY } from './catchup/types';
import { listMeetings } from './db';
import { listEvents } from './calendar';
import { GoogleError } from './google';
import { record } from './ledger';
import { chat, LLMError, type FetchLike } from './llm';
import { buildBrief, briefNote, dueNote, dueToday, firstName, lastTimeMessages, localLastTime, parseLines, type Brief, type NoteContent } from './memory/brief';
import { buildWeek, lookBackStart, type Week } from './memory/lookback';
import { transition } from './memory/promise';
import { isOpenLoop, isoDay } from './memory/rank';
import { getItem, listItems, listPeople, putItem } from './memory/store';
import type { LedgerEntry, MemoryItem, MemorySettings, Person } from './memory/types';
import { getSettings } from './settings';
import type { CalendarEvent, Meeting } from './types';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// Events

export const EVENTS_KEY = 'rekord.events';
/** `past` holds events that ended in the last 7 days, keyed by event id, for the catch-up card and picker. */
export interface EventCache { savedAt: number; events: CalendarEvent[]; past?: Record<string, CalendarEvent> }
/** How often the open panel refreshes the cache (Google tokens last about an hour, with no refresh). */
export const CACHE_REFRESH_MS = 15 * MIN;
export const CALENDAR_LEDGER_WHAT = 'Events for the last 7 days and the next 24 hours';
/** How far back the cache reaches, for meetings Rekord missed (same calendar.readonly scope). */
export const PAST_MS = 7 * DAY;

/** Fetches the last 7 days and the next 24 hours of events and keeps them, so the background can brief without a token. */
export async function refreshEventCache(now = Date.now(), deps: { list?: typeof listEvents; save?: (c: EventCache) => Promise<void> } = {}): Promise<CalendarEvent[] | undefined> {
  const { google } = await getSettings();
  if (!google.calendar) return undefined;
  const list = deps.list ?? listEvents;
  const sent = () => record({ service: 'google-calendar', what: CALENDAR_LEDGER_WHAT, at: now });
  let fetched: CalendarEvent[];
  try {
    fetched = await list(google.calendarId, now, {}, now + DAY, now - PAST_MS);
  } catch (error) {
    // Only a reply from Google means the request left the computer.
    if (error instanceof GoogleError && error.code === 'server') await sent();
    throw error;
  }
  await sent();
  const { events, past } = splitEvents(fetched, now);
  await (deps.save ?? saveEvents)({ savedAt: now, events, past });
  return events;
}
const saveEvents = (cache: EventCache) => browser.storage.local.set({ [EVENTS_KEY]: cache });

/** Upcoming and current events stay a list; ended ones go to `past`, keyed by id. */
export function splitEvents(fetched: CalendarEvent[], now: number): { events: CalendarEvent[]; past: Record<string, CalendarEvent> } {
  const past: Record<string, CalendarEvent> = {};
  for (const e of fetched) if (e.end <= now && e.end > now - PAST_MS) past[e.id] = e;
  return { events: fetched.filter((e) => e.end > now), past };
}

const readCache = async () => (await browser.storage.local.get(EVENTS_KEY))[EVENTS_KEY] as EventCache | undefined;

/** Cached events not over yet. */
export async function cachedEvents(now = Date.now()): Promise<CalendarEvent[]> {
  return ((await readCache())?.events ?? []).filter((e) => e.end > now);
}

/** Cached events that ended in the last 7 days. */
export async function pastEvents(now = Date.now()): Promise<CalendarEvent[]> {
  const cache = await readCache();
  // Events that ended since the last refresh are still in `events`.
  const all = [...Object.values(cache?.past ?? {}), ...(cache?.events ?? [])];
  return [...new Map(all.map((e) => [e.id, e])).values()].filter((e) => e.end <= now && e.end > now - PAST_MS);
}

// Missed-meeting cards

const DISMISSED_MAX = 200;

/** Event ids whose missed-meeting card was dismissed. */
export async function dismissedIds(): Promise<string[]> {
  const ids = (await browser.storage.local.get(DISMISSED_KEY))[DISMISSED_KEY];
  return Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string') : [];
}

/** Hides the card for one event for good. */
export async function dismissMissed(eventId: string): Promise<void> {
  const ids = await dismissedIds();
  if (ids.includes(eventId)) return;
  await browser.storage.local.set({ [DISMISSED_KEY]: [...ids, eventId].slice(-DISMISSED_MAX) });
}

// Alarms

export const BRIEF_PREFIX = 'rekord.brief:';
export const DUE_ALARM = 'rekord.due';
export const LOOKBACK_ALARM = 'rekord.lookback';
/** The due-day notification goes out at this hour. */
export const DUE_HOUR = 9;

export interface AlarmPlan { name: string; when: number }

/** The next time it is `hour`:00, on `weekday` (0 Sunday … 6 Saturday) when given. */
export function nextAt(now: number, hour: number, weekday?: number): number {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (weekday !== undefined) d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  if (d.getTime() <= now) d.setDate(d.getDate() + (weekday === undefined ? 1 : 7));
  return d.getTime();
}

/** Events whose brief already went out this browser session. */
export const BRIEFED_KEY = 'rekord.briefed';
const BRIEFED_MAX = 200;

export async function briefedIds(): Promise<string[]> {
  return ((await browser.storage.session.get(BRIEFED_KEY))[BRIEFED_KEY] as string[] | undefined) ?? [];
}

async function markBriefed(eventId: string): Promise<void> {
  const ids = (await briefedIds()).filter((id) => id !== eventId);
  await browser.storage.session.set({ [BRIEFED_KEY]: [...ids, eventId].slice(-BRIEFED_MAX) });
}

/** Alarms for the settings: a brief before each meeting in the next 24 h not briefed yet, the next due check and the next look back. */
export function planAlarms(events: CalendarEvent[], memory: MemorySettings, now: number, briefed: readonly string[] = []): AlarmPlan[] {
  const plan: AlarmPlan[] = [];
  if (memory.brief.on) {
    for (const e of events) {
      if (e.start - now < MIN || e.start > now + DAY || briefed.includes(e.id)) continue;
      // Opened the panel inside the lead time: brief right away.
      plan.push({ name: BRIEF_PREFIX + e.id, when: Math.max(now + 1000, e.start - memory.brief.minutes * MIN) });
    }
  }
  // One-shot, planned again each time they fire, so 09:00 stays 09:00 across a clock change.
  if (memory.dueReminders) plan.push({ name: DUE_ALARM, when: nextAt(now, DUE_HOUR) });
  if (memory.lookBack.on) plan.push({ name: LOOKBACK_ALARM, when: nextAt(now, memory.lookBack.hour, memory.lookBack.day) });
  return plan;
}

const ours = (name: string) => name.startsWith(BRIEF_PREFIX) || name === DUE_ALARM || name === LOOKBACK_ALARM;

/** Sets alarms to the plan; leaves Rekord's other alarms (backfill, badge) alone. */
export async function scheduleReminders(now = Date.now()): Promise<AlarmPlan[]> {
  const [{ memory }, events, existing, briefed] = await Promise.all([getSettings(), cachedEvents(now), browser.alarms.getAll(), briefedIds()]);
  const plan = planAlarms(events, memory, now, briefed);
  const wanted = new Map(plan.map((p) => [p.name, p]));
  for (const a of existing) if (ours(a.name) && !wanted.has(a.name)) await browser.alarms.clear(a.name);
  for (const p of plan) {
    const have = existing.find((a) => a.name === p.name);
    // A brief already due right away stays as it is; anything else moves only when its time moved.
    const keep = have && !have.periodInMinutes && (have.scheduledTime === p.when || (p.name.startsWith(BRIEF_PREFIX) && p.when === now + 1000 && have.scheduledTime <= p.when));
    if (!keep) await browser.alarms.create(p.name, { when: p.when });
  }
  return plan;
}

// Notifications

export const NOTE_BRIEF = 'rekord.brief:';
export const NOTE_DUE = 'rekord.due:';
export const NOTE_LOOKBACK = 'rekord.lookback:';
export const NOTE_OWE = 'rekord.owe:';
const ICON = '/icon/128.png';

/** Your own promises due today, for the due-day notification. */
export function oweToday(items: MemoryItem[], now: number): MemoryItem[] {
  const today = isoDay(now);
  return items.filter((i) => i.kind === 'promise' && i.ownerId === 'me' && !!i.toId && i.toId !== 'me' && i.due === today && isOpenLoop(i, now));
}

/** "Due today: join Thursday’s rollout demo" / "You promised Sarah in 1:1 with Sarah." with Open and Snooze. */
export function oweNote(item: MemoryItem, to: Person, made?: Pick<Meeting, 'title'>): NoteContent {
  const thing = /^.[A-Z0-9]/.test(item.text) ? item.text : item.text.charAt(0).toLowerCase() + item.text.slice(1);
  return {
    title: `Due today: ${thing}`,
    message: `You promised ${firstName(to.name)}${made ? ` in ${made.title}` : ''}.`,
    buttons: [{ title: 'Open' }, { title: 'Snooze' }],
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Friday's "Your week in Rekord" / "9 meetings · 8 promises kept · 4 still open" with "Open look back". */
export function weekNote(week: Week): NoteContent {
  const open = Math.max(0, week.promisesMade - week.promisesKept);
  return {
    title: 'Your week in Rekord',
    message: `${count(week.meetings, 'meeting')} · ${count(week.promisesKept, 'promise')} kept · ${open} still open`,
    buttons: [{ title: 'Open look back' }],
  };
}

async function memoryData(): Promise<{ people: Person[]; items: MemoryItem[]; meetings: Meeting[] }> {
  const [people, items, meetings] = await Promise.all([listPeople(), listItems(), listMeetings()]);
  return { people, items, meetings };
}

/** The brief for a cached event, from local data only. */
export async function briefFor(eventId: string, now = Date.now()): Promise<Brief | undefined> {
  const event = (await cachedEvents(now)).find((e) => e.id === eventId);
  return event ? buildBrief({ event, ...(await memoryData()), now }) : undefined;
}

function notify(id: string, content: { title: string; message: string; buttons?: { title: string }[] }) {
  return browser.notifications.create(id, { type: 'basic', iconUrl: browser.runtime.getURL(ICON as '/icon/128.png'), requireInteraction: true, ...content });
}

/** Runs one of our alarms; false for an alarm that is not a reminder. */
export async function onReminderAlarm(name: string, now = Date.now()): Promise<boolean> {
  if (name.startsWith(BRIEF_PREFIX)) {
    const { memory } = await getSettings();
    const eventId = name.slice(BRIEF_PREFIX.length);
    const brief = memory.brief.on ? await briefFor(eventId, now) : undefined;
    await markBriefed(eventId);
    if (brief && brief.event.start > now) await notify(NOTE_BRIEF + brief.event.id, briefNote(brief, now));
    return true;
  }
  if (name === DUE_ALARM) {
    const [{ memory }, data, events] = await Promise.all([getSettings(), memoryData(), cachedEvents(now)]);
    if (memory.dueReminders) {
      for (const item of dueToday(data.items, now)) {
        const owner = data.people.find((p) => p.id === item.ownerId);
        if (owner) await notify(NOTE_DUE + item.id, dueNote(item, owner, events, now));
      }
      for (const item of oweToday(data.items, now)) {
        const to = data.people.find((p) => p.id === item.toId);
        if (to) await notify(NOTE_OWE + item.id, oweNote(item, to, data.meetings.find((m) => m.id === item.meetingId)));
      }
    }
    await scheduleReminders(now);
    return true;
  }
  if (name === LOOKBACK_ALARM) {
    const { memory } = await getSettings();
    if (memory.lookBack.on) {
      const start = lookBackStart(now);
      await notify(NOTE_LOOKBACK + start, weekNote(buildWeek({ ...(await memoryData()), now, start })));
    }
    await scheduleReminders(now);
    return true;
  }
  return false;
}

// Opening the side panel on a screen

export const PANEL_ROUTE_KEY = 'rekord.panelRoute';
export interface PanelRoute { screen: string; params: Record<string, string | number>; at: number }
/** A route older than this is stale (the panel opened for something else). */
export const PANEL_ROUTE_TTL = 2 * MIN;

export const setPanelRoute = (screen: string, params: PanelRoute['params'] = {}) =>
  browser.storage.session.set({ [PANEL_ROUTE_KEY]: { screen, params, at: Date.now() } satisfies PanelRoute });

/** Reads and clears the route a notification or tab asked the panel to open. */
export async function takePanelRoute(now = Date.now()): Promise<PanelRoute | undefined> {
  const route = (await browser.storage.session.get(PANEL_ROUTE_KEY))[PANEL_ROUTE_KEY] as PanelRoute | undefined;
  if (!route) return undefined;
  await browser.storage.session.remove(PANEL_ROUTE_KEY);
  return now - route.at <= PANEL_ROUTE_TTL ? route : undefined;
}

export const briefTabUrl = (eventId: string) => `${browser.runtime.getURL('/brief.html')}?event=${encodeURIComponent(eventId)}`;
/** The look back tab for the week starting `start` (Monday 00:00), else the week it picks itself. */
export const lookBackTabUrl = (start?: number) => `${browser.runtime.getURL('/lookback.html')}${start ? `?week=${start}` : ''}`;

/** Snooze from the due notification: back tomorrow at 09:00. */
export async function snoozeFromNote(itemId: string, now = Date.now()): Promise<boolean> {
  const item = await getItem(itemId);
  if (!item) return false;
  const next = transition(item, { type: 'snooze', until: nextAt(now, DUE_HOUR) }, now);
  if (next === item) return false;
  await putItem(next);
  return true;
}

// "Last time" in three lines

export const lastTimeKey = (meetingId: string) => `rekord.lastTime.${meetingId}`;
export const LAST_TIME_WHAT = 'Last meeting notes for a brief';
const LEDGER_SERVICE: Partial<Record<string, LedgerEntry['service']>> = { groq: 'groq', openai: 'openai', openrouter: 'openrouter', anthropic: 'anthropic' };
const NOT_SENT = new Set(['no-key', 'offline', 'local-unavailable', 'cancelled']);

/** The three lines for the last meeting: cached for the session, else asked of the AI once, else built locally. */
export async function lastTime(brief: Brief, deps: { fetchFn?: FetchLike } = {}): Promise<string[]> {
  const last = brief.last;
  if (!last) return [];
  const key = lastTimeKey(last.id);
  const cached = (await browser.storage.session.get(key))[key] as string[] | undefined;
  if (cached?.length) return cached;
  const [{ items, people, meetings }, settings] = await Promise.all([memoryData(), getSettings()]);
  const from = items.filter((i) => (i.meetingId === last.id || i.history.some((q) => q.meetingId === last.id)) && !['suggested', 'dismissed'].includes(i.status));
  const service = LEDGER_SERVICE[settings.summary.provider];
  let sent = true;
  try {
    const overview = meetings.find((m) => m.id === last.id)?.summary?.overview;
    const lines = parseLines(await chat(lastTimeMessages(last, overview, from, people), { maxTokens: 200 }, deps.fetchFn));
    if (lines.length) {
      await browser.storage.session.set({ [key]: lines });
      return lines;
    }
  } catch (error) {
    sent = !(error instanceof LLMError && NOT_SENT.has(error.code));
    console.error('Rekord: could not write the brief', error);
  } finally {
    if (service && sent) await record({ service, what: LAST_TIME_WHAT, meetingId: last.id });
  }
  // Kept for the session too, so a failed call is not asked again on every open.
  const local = localLastTime(last.id, items, people);
  if (local.length) await browser.storage.session.set({ [key]: local });
  return local;
}

