// Ledger rows as V4Ledger shows them: per meeting, and "All meetings · this week" with totals per service.
import type { LedgerEntry } from '@/lib/memory/types';
import type { RedactionMark } from '@/lib/redact';
import { formatClock } from '@/lib/time';

type Service = LedgerEntry['service'];
export type LedgerIcon = 'calendar' | 'up' | 'check' | 'power' | 'lock';

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

export interface ServiceTotal { service: Service; name: string; count: number; meetings: number; whats: string[]; icon: LedgerIcon; dark: boolean }

/** "All meetings · this week": calls this week added up per service, services in order of first use. */
export function weekTotals(entries: LedgerEntry[], now: number): ServiceTotal[] {
  const from = weekStart(now);
  const by = new Map<Service, { total: ServiceTotal; first: number; ids: Set<string> }>();
  for (const e of entries.filter((x) => x.lastAt >= from && x.firstAt <= now)) {
    const g = by.get(e.service) ?? {
      total: { service: e.service, name: SERVICE_NAMES[e.service], count: 0, meetings: 0, whats: [], icon: ICONS[e.service] ?? 'up', dark: e.service === 'off-record' },
      first: e.firstAt, ids: new Set<string>(),
    };
    g.total.count += e.count;
    g.first = Math.min(g.first, e.firstAt);
    if (e.meetingId) g.ids.add(e.meetingId);
    if (!g.total.whats.includes(e.what)) g.total.whats.push(e.what);
    by.set(e.service, g);
  }
  return [...by.values()]
    .sort((a, b) => Number(LOCAL.includes(a.total.service)) - Number(LOCAL.includes(b.total.service)) || a.first - b.first)
    .map((g) => ({ ...g.total, meetings: g.ids.size }));
}
