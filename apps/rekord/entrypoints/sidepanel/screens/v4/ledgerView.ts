// Ledger rows as V4Ledger shows them per meeting, and V4LedgerAll's totals per service for a period.
import type { LedgerEntry } from '@/lib/memory/types';
import type { RedactionMark } from '@/lib/redact';
import { formatClock } from '@/lib/time';

type Service = LedgerEntry['service'];
export type LedgerIcon = 'calendar' | 'up' | 'check' | 'power' | 'lock' | 'tasks' | 'page' | 'down' | 'none';

export const SERVICE_NAMES: Record<Service, string> = {
  groq: 'Groq', openai: 'OpenAI', openrouter: 'OpenRouter', anthropic: 'Anthropic', deepgram: 'Deepgram',
  'google-calendar': 'Google Calendar', 'google-tasks': 'Google Tasks', notion: 'Notion', linear: 'Linear',
  huggingface: 'Hugging Face', gmail: 'Gmail', 'off-record': 'Off the record', redaction: 'Redacted',
};
const ICONS: Partial<Record<Service, LedgerIcon>> = {
  'google-calendar': 'calendar', 'google-tasks': 'check', 'off-record': 'power', redaction: 'lock',
};
// Rows that are about this computer, not a service: shown last.
const LOCAL: Service[] = ['off-record', 'redaction'];

const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Redacted Tue 3 Nov, 10:41 · 0:42" without the word, for the ledger and the transcript. */
export const redactionLine = (m: RedactionMark) => `${day(m.at)}, ${hhmm(m.at)} · ${formatClock(m.endMs - m.startMs)}`;

// Known calls in the order the frame lists them; each knows its own count words.
const WHATS: { what: string; detail: (e: LedgerEntry) => string; time?: (e: LedgerEntry) => string }[] = [
  { what: 'Read this event', detail: (e) => e.what },
  { what: 'Audio for transcription', detail: (e) => `${e.what} · ${plural(e.count, 'part')}` },
  { what: 'Ask and What did I miss?', detail: (e) => `${e.what} · ${plural(e.count, 'request')}` },
  { what: 'Clash checks', detail: (e) => `${e.what} · every 60 s while on · ${plural(e.count, 'check')}`, time: () => '' },
  { what: 'Transcript text for summary and memory', detail: (e) => e.what },
  { what: 'Tasks', detail: (e) => plural(e.count, 'task') },
  { what: 'Off the record', detail: (e) => `${Math.max(1, Math.round((e.lastAt - e.firstAt) / 60_000))} min · nothing sent`, time: (e) => hhmm(e.firstAt) },
];

/** "09:55"; two calls "10:14, 10:21"; more "10:00 to 10:32"; calls in one minute show one time. */
export function callTimes(e: LedgerEntry): string {
  const a = hhmm(e.firstAt);
  const b = hhmm(e.lastAt);
  if (a === b) return a;
  return e.count === 2 ? `${a}, ${b}` : `${a} to ${b}`;
}

export interface LedgerRow { id: string; name: string; detail: string; time: string; icon: LedgerIcon; dark: boolean }

/** One row per ledger entry for a meeting; redaction rows show the dates from the meeting's marks. */
export function meetingRows(entries: LedgerEntry[], marks: RedactionMark[] = []): LedgerRow[] {
  const first = new Map<Service, number>();
  for (const e of entries) first.set(e.service, Math.min(first.get(e.service) ?? Infinity, e.firstAt));
  const rank = (e: LedgerEntry) => (LOCAL.includes(e.service) ? 1 : 0);
  const whatAt = (e: LedgerEntry) => { const i = WHATS.findIndex((w) => w.what === e.what); return i < 0 ? WHATS.length : i; };
  const sorted = [...entries].sort((a, b) => rank(a) - rank(b) || first.get(a.service)! - first.get(b.service)!
    || LOCAL.indexOf(a.service) - LOCAL.indexOf(b.service) || whatAt(a) - whatAt(b) || a.firstAt - b.firstAt);
  return sorted.map((e) => {
    const known = WHATS.find((w) => w.what === e.what);
    const redaction = e.service === 'redaction';
    const detail = redaction
      ? (marks.length ? marks.map(redactionLine).join(', ') : `${day(e.lastAt)}, ${hhmm(e.lastAt)}`)
      : known ? known.detail(e) : e.what;
    return {
      id: e.id, name: SERVICE_NAMES[e.service], detail, icon: ICONS[e.service] ?? 'up', dark: e.service === 'off-record',
      time: redaction ? '' : known?.time ? known.time(e) : callTimes(e),
    };
  });
}

/** Monday 00:00 of the week holding `now`. */
export function weekStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export type Period = 'week' | 'month' | 'all';
export const PERIODS: { id: Period; label: string }[] = [{ id: 'week', label: 'This week' }, { id: 'month', label: 'This month' }, { id: 'all', label: 'All time' }];

/** Where a period starts: "This week" reaches back to last Monday, so early in the week it is not nearly empty; "This month" a month back. */
export function periodStart(period: Period, now: number, entries: LedgerEntry[]): number {
  if (period === 'week') return weekStart(now) - 7 * 86_400_000;
  if (period === 'month') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() - 1);
    return d.getTime();
  }
  const d = new Date(Math.min(now, ...entries.map((e) => e.firstAt)));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "26 Oct" */
export const dayMonth = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const AI: Service[] = ['groq', 'openai', 'openrouter', 'anthropic', 'deepgram'];
// Services Rekord can connect to: listed even before anything went to them.
const CONNECTABLE: Service[] = ['google-calendar', 'google-tasks', 'notion', 'linear'];
const ALL_ICONS: Partial<Record<Service, LedgerIcon>> = { 'google-calendar': 'calendar', 'google-tasks': 'tasks', notion: 'page', huggingface: 'down' };

export interface ServiceTotal { service: Service; name: string; detail: string; icon: LedgerIcon; none: boolean }

const sum = (entries: LedgerEntry[], keep: (e: LedgerEntry) => boolean = () => true) => entries.filter(keep).reduce((n, e) => n + e.count, 0);

function serviceDetail(service: Service, entries: LedgerEntry[]): string {
  if (AI.includes(service)) {
    const meetings = new Set(entries.map((e) => e.meetingId).filter(Boolean)).size;
    return `Audio and text from ${plural(meetings, 'meeting')} · ${plural(sum(entries), 'request')}`;
  }
  if (service === 'google-calendar') return `Read ${plural(sum(entries), 'event')}`;
  if (service === 'google-tasks') return `${plural(sum(entries, (e) => e.what === 'Tasks'), 'task')} sent`;
  if (service === 'notion') return plural(sum(entries, (e) => e.what !== 'Database list'), 'page');
  if (service === 'linear') return plural(sum(entries, (e) => e.what === 'Issues'), 'issue');
  if (service === 'huggingface') {
    const n = sum(entries);
    return `Search model, ${n === 1 ? 'once' : `${n} times`} · ${dayMonth(Math.max(...entries.map((e) => e.lastAt)))}`;
  }
  return [...new Set(entries.map((e) => e.what))].join(' · ');
}

/** V4LedgerAll: what went to each service from `from` to `now`, in order of first use; connectable services with nothing say so, last. */
export function periodTotals(entries: LedgerEntry[], from: number, now: number): ServiceTotal[] {
  const by = new Map<Service, LedgerEntry[]>();
  for (const e of entries) {
    if (LOCAL.includes(e.service) || e.lastAt < from || e.firstAt > now) continue;
    by.set(e.service, [...(by.get(e.service) ?? []), e]);
  }
  const first = (list: LedgerEntry[]) => Math.min(...list.map((e) => e.firstAt));
  const used = [...by.entries()].sort((a, b) => first(a[1]) - first(b[1]));
  const name = (s: Service) => (s === 'huggingface' ? 'huggingface.co' : SERVICE_NAMES[s]);
  return [
    ...used.map(([service, list]) => ({ service, name: name(service), detail: serviceDetail(service, list), icon: ALL_ICONS[service] ?? 'up', none: false })),
    ...CONNECTABLE.filter((s) => !by.has(s)).map((service) => ({ service, name: name(service), detail: 'Nothing yet', icon: 'none' as const, none: true })),
  ];
}
