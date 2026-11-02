// The FRAMES.md sample world, for dev frame routes and tests. Story day: Tue 3 Nov 2026.
import type { CalendarEvent, Meeting, Segment } from '../types';
import type { Agenda, LedgerEntry, MemoryItem, Person, Quote } from './types';

const at = (month: number, day: number, h: number, m: number) => new Date(2026, month - 1, day, h, m).getTime();
const mmss = (m: number, s: number) => (m * 60 + s) * 1000;

/** "Before, 09:55": the 1:1 with Sarah is in 5 min. */
export const SAMPLE_NOW = at(11, 3, 9, 55);
/** "After, 10:35": the recording ran 10:00 to 10:32. */
export const SAMPLE_AFTER = at(11, 3, 10, 35);

const ME = { name: 'Alex', email: 'alex@rekord-team.com', self: true };
const SARAH = { name: 'Sarah Chen', email: 'sarah@northwind.co' };

export const SAMPLE_EVENT: CalendarEvent = {
  id: 'evt-sarah-1103', title: '1:1 with Sarah', start: at(11, 3, 10, 0), end: at(11, 3, 10, 30),
  attendees: [ME, SARAH], app: 'meet',
};

const meeting = (id: string, title: string, start: number, minutes: number, event?: CalendarEvent): Meeting => ({
  id, title, startedAt: start, endedAt: start + minutes * 60_000, status: 'done', language: 'en', source: 'tab', ...(event ? { event } : {}),
});
const day = (m: number, d: number) => `${m}-${String(d).padStart(2, '0')}`;

const SYNC_DAYS: [number, number][] = [[7, 27], [8, 3], [8, 10], [8, 17], [8, 24], [8, 31], [9, 7], [9, 14], [9, 21], [9, 28], [10, 5], [10, 12], [10, 19], [10, 26], [11, 2]];
const SARAH_DAYS: [number, number][] = [[9, 22], [9, 29], [10, 6], [10, 13], [10, 20], [10, 27]];
const syncId = ([m, d]: [number, number]) => `m-sync-${day(m, d)}`;
const sarahId = ([m, d]: [number, number]) => `m-sarah-${day(m, d)}`;

export const M = {
  kickoff: 'm-pricing-kickoff', review: 'm-pricing-review', lumen: 'm-intro-lumen',
  sarah27: 'm-sarah-10-27', sarah20: 'm-sarah-10-20', sync2: 'm-sync-11-02', sync26: 'm-sync-10-26', sarah3: 'm-sarah-11-03',
} as const;

/** The 24 meetings Rekord holds before the 1:1: 23 recorded before v4, plus Weekly product sync on 2 Nov. */
export const SAMPLE_MEETINGS: Meeting[] = [
  meeting(M.kickoff, 'Pricing kickoff', at(10, 3, 14, 0), 45),
  meeting(M.review, 'Pricing review', at(10, 26, 14, 0), 50),
  meeting(M.lumen, 'Intro with Lumen', at(10, 29, 15, 0), 30),
  ...SARAH_DAYS.map((d) => meeting(sarahId(d), '1:1 with Sarah', at(d[0], d[1], 10, 0), 30)),
  ...SYNC_DAYS.map((d) => meeting(syncId(d), 'Weekly product sync', at(d[0], d[1], 10, 0), 47)),
];
/** The 1:1 itself, only after the recording. */
export const SAMPLE_ONE_ON_ONE: Meeting = meeting(M.sarah3, '1:1 with Sarah', at(11, 3, 10, 0), 32, SAMPLE_EVENT);

const startOf = (id: string) => [...SAMPLE_MEETINGS, SAMPLE_ONE_ON_ONE].find((m) => m.id === id)!.startedAt;
const quote = (speaker: string, text: string, meetingId: string, atMs: number): Quote => ({ speaker, text, meetingId, atMs });

const person = (id: string, name: string, meetingIds: string[], extra: Partial<Person> = {}): Person => ({
  id, name, aliases: [], meetingIds, createdAt: startOf(meetingIds[0]!), updatedAt: SAMPLE_NOW, ...extra,
});
const FILLER_PEOPLE = 7;

/** 12 people. "Sam" (no email) is the merge suggestion for Sam Ortiz. */
export const SAMPLE_PEOPLE: Person[] = [
  person('p-sarah', 'Sarah Chen', SARAH_DAYS.map(sarahId), {
    email: 'sarah@northwind.co', company: 'Northwind', aliases: ['Sarah'], series: { label: 'Every Tuesday 10:00', since: at(9, 22, 10, 0) },
  }),
  person('p-priya', 'Priya Nair', [M.kickoff, M.review, ...SYNC_DAYS.map(syncId)], { email: 'priya@rekord-team.com', aliases: ['Priya'] }),
  person('p-sam', 'Sam Ortiz', SYNC_DAYS.slice(-5).map(syncId), { email: 'sam@rekord-team.com' }),
  person('p-sam-guest', 'Sam', [M.sync26, M.sync2]),
  person('p-dana', 'Dana Ruiz', [M.lumen], { email: 'dana@lumen.io', company: 'Lumen', aliases: ['Dana'] }),
  ...Array.from({ length: FILLER_PEOPLE }, (_, i) =>
    person(`p-filler-${i + 1}`, `Contact ${i + 1}`, [syncId(SYNC_DAYS[i]!)], { email: `contact${i + 1}@example.com` })),
];

const item = (id: string, kind: MemoryItem['kind'], status: MemoryItem['status'], text: string, q: Quote, extra: Partial<MemoryItem> = {}): MemoryItem => {
  const createdAt = startOf(q.meetingId) + q.atMs;
  return { id, kind, status, text, quote: q, meetingId: q.meetingId, personIds: [], history: [], createdAt, updatedAt: createdAt, ...extra };
};

/** Open loops at 09:55: "You owe 3", "Owed to you 2", "Questions 1", one overdue. */
const OPEN_LOOPS: MemoryItem[] = [
  item('i-deck', 'promise', 'open', 'Send the revised pricing deck',
    quote('Alex', 'I’ll send Sarah the revised pricing deck by Friday.', M.review, mmss(33, 40)), {
      ownerId: 'me', toId: 'p-sarah', personIds: ['p-sarah'], due: '2026-10-30',
      history: [quote('Alex', 'I’m still finishing the deck.', M.sarah27, mmss(19, 30))],
    }),
  item('i-proposal', 'promise', 'open', 'A short proposal',
    quote('Alex', 'I’ll put together a short proposal for you.', M.lumen, mmss(22, 5)),
    { ownerId: 'me', toId: 'p-dana', personIds: ['p-dana'] }),
  item('i-checklist', 'promise', 'looksDone', 'Share the onboarding checklist',
    quote('Alex', 'I’ll share the onboarding checklist with Sam.', M.sync26, mmss(6, 20)), {
      ownerId: 'me', toId: 'p-sam', personIds: ['p-sam'],
      evidence: quote('Alex', 'I shared the onboarding checklist with Sam this morning.', M.sync2, mmss(4, 12)),
    }),
  item('i-q3', 'promise', 'open', 'Q3 usage numbers',
    quote('Sarah', 'I’ll get you the Q3 usage numbers by next Tuesday.', M.sarah27, mmss(8, 12)),
    { ownerId: 'p-sarah', toId: 'me', personIds: ['p-sarah'], due: '2026-11-03' }),
  item('i-launch-copy', 'promise', 'open', 'Launch email copy',
    quote('Priya', 'I’ll write the launch email copy by Thursday.', M.sync2, mmss(9, 30)),
    { ownerId: 'p-priya', toId: 'me', personIds: ['p-priya'], due: '2026-11-05' }),
  item('q-free-plan', 'question', 'open', 'Do we keep the free plan?',
    quote('Priya', 'Do we keep the free plan?', M.review, mmss(40, 18)), { personIds: ['p-priya'] }),
];

/** Decisions, one quote each. $12 replaces $10. */
const DECISIONS: MemoryItem[] = [
  item('d-team-12', 'decision', 'open', 'Team plan is $12 a seat',
    quote('Priya', 'Let’s settle it: twelve a seat for the team plan.', M.review, mmss(31, 4)), { personIds: ['p-priya'], replacesId: 'd-team-10' }),
  item('d-team-10', 'decision', 'replaced', 'Team plan is $10 a seat',
    quote('Priya', 'Ten a seat for the team plan for now.', M.kickoff, mmss(12, 40)), { personIds: ['p-priya'], replacedById: 'd-team-12' }),
  item('d-rollout-9', 'decision', 'open', 'Northwind rollout starts 9 Nov',
    quote('Sarah', 'Northwind wants to start the rollout on the 9th.', M.sarah27, mmss(14, 50)), { personIds: ['p-sarah'] }),
  item('d-launch-14', 'decision', 'open', 'Launch email goes out on 14 Nov',
    quote('Sam', 'Fine, the launch email goes out on the 14th.', M.sync2, mmss(12, 15)), { personIds: ['p-sam'] }),
];

// Closed history so the totals match "74 items (41 promises, 18 decisions, 15 questions)"; none touch Sarah's open loops.
function filler(): MemoryItem[] {
  const out: MemoryItem[] = [];
  const earlier = SYNC_DAYS.slice(0, -1).map(syncId);
  const add = (kind: MemoryItem['kind'], status: MemoryItem['status'], label: string, count: number) => {
    for (let n = 1; n <= count; n++) {
      const meetingId = earlier[n % earlier.length]!;
      const who = `p-filler-${(n % FILLER_PEOPLE) + 1}`;
      const text = `${label} ${n}`;
      out.push(item(`f-${kind}-${n}`, kind, status, text, quote('Alex', `${text}.`, meetingId, mmss(5 + n, 0)), {
        personIds: [who], ...(kind === 'promise' ? { ownerId: n % 2 ? 'me' : who, toId: n % 2 ? who : 'me' } : {}),
      }));
    }
  };
  add('promise', 'done', 'Earlier promise', 36);
  add('decision', 'open', 'Earlier decision', 14);
  add('question', 'answered', 'Earlier question', 14);
  // The second decision Sarah is linked to ("2 decision links" on V4Forget).
  const linked = out.find((i) => i.id === 'f-decision-1')!;
  Object.assign(linked, { meetingId: M.sarah20, personIds: ['p-sarah'], quote: { ...linked.quote, speaker: 'Sarah', meetingId: M.sarah20 } });
  return out;
}

export const SAMPLE_ITEMS: MemoryItem[] = [...OPEN_LOOPS, ...DECISIONS, ...filler()];

const sug = (id: string, kind: MemoryItem['kind'], text: string, q: Quote, extra: Partial<MemoryItem> = {}) =>
  item(id, kind, 'suggested', text, q, { personIds: ['p-sarah'], ...extra });
const one = (speaker: string, text: string, m: number, s: number) => quote(speaker, text, M.sarah3, mmss(m, s));

/** "What the 1:1 produced": 4 promises, 1 decision, 1 question and 2 left out, all waiting for review. */
export const SAMPLE_ONE_ON_ONE_ITEMS: MemoryItem[] = [
  sug('n-deck', 'promise', 'Send the revised pricing deck', one('Sarah', 'Can you send the deck today?', 16, 5),
    { ownerId: 'me', toId: 'p-sarah', due: '2026-11-03' }),
  sug('n-demo', 'promise', 'Join Thursday’s rollout demo', one('Alex', 'I’ll join the rollout demo on Thursday.', 17, 20),
    { ownerId: 'me', toId: 'p-sarah', due: '2026-11-05' }),
  sug('n-seats', 'promise', 'Northwind seat count', one('Sarah', 'I’ll get you the Northwind seat count by Friday.', 24, 10),
    { ownerId: 'p-sarah', toId: 'me', due: '2026-11-06' }),
  sug('n-intro', 'promise', 'Intro to Northwind’s IT lead', one('Sarah', 'I’ll introduce you to our IT lead.', 26, 45),
    { ownerId: 'p-sarah', toId: 'me' }),
  sug('n-rollout-16', 'decision', 'Northwind rollout starts 16 Nov', one('Sarah', 'Let’s start the rollout on the 16th instead.', 19, 2),
    { replacesId: 'd-rollout-9' }),
  sug('n-yearly', 'question', 'Can Northwind pay yearly?', one('Sarah', 'Can Northwind pay yearly?', 21, 30)),
  // Quotes the transcript does not hold: shown under "left out".
  sug('n-left-1', 'promise', 'Review the security questionnaire', one('Alex', 'I’ll review the security questionnaire.', 12, 40),
    { ownerId: 'me', toId: 'p-sarah', leftOut: true }),
  sug('n-left-2', 'promise', 'Book the follow-up call', one('Sarah', 'I’ll book the follow-up call.', 28, 30),
    { ownerId: 'p-sarah', toId: 'me', leftOut: true }),
];

/** The person suggestion from the invite: "Is “Tom” Tom Becker (tom@northwind.co)?" */
export const SAMPLE_PERSON_SUGGESTION: Pick<Person, 'name' | 'email' | 'aliases'> = {
  name: 'Tom Becker', email: 'tom@northwind.co', aliases: ['Tom'],
};

/** The 1:1 agenda: "4 items · 25 of 30 min". */
export const SAMPLE_AGENDA: Agenda = {
  meetingKey: SAMPLE_EVENT.id,
  totalMinutes: 30,
  items: [
    { id: 'a-q3', text: 'Q3 usage numbers', source: 'promise', minutes: 5 },
    { id: 'a-deck', text: 'Revised pricing deck', source: 'promise', minutes: 10 },
    { id: 'a-rollout', text: 'Northwind rollout date', source: 'invite', minutes: 5 },
    { id: 'a-seats', text: 'Seat count for the rollout', source: 'you', minutes: 5 },
  ],
};

const row = (id: string, service: LedgerEntry['service'], what: string, count: number, first: [number, number], last = first): LedgerEntry => ({
  id, meetingId: M.sarah3, service, what, count, firstAt: at(11, 3, ...first), lastAt: at(11, 3, ...last),
});
/** Ledger for the 1:1, after the recording. */
export const SAMPLE_LEDGER: LedgerEntry[] = [
  row('l-calendar', 'google-calendar', 'Read this event', 1, [9, 55]),
  row('l-audio', 'groq', 'Audio for transcription', 32, [10, 0], [10, 32]),
  row('l-ask', 'groq', 'Ask and What did I miss?', 2, [10, 14], [10, 21]),
  row('l-clash', 'groq', 'Clash checks', 30, [10, 1], [10, 30]),
  row('l-summary', 'groq', 'Transcript text for summary and memory', 1, [10, 33]),
  row('l-tasks', 'google-tasks', 'Tasks', 2, [10, 36]),
  row('l-off', 'off-record', 'Off the record', 1, [10, 18], [10, 20]),
];

/** One transcript segment per quote, so the quote checker finds every sample quote. */
export function sampleSegments(items: MemoryItem[] = SAMPLE_ITEMS): Segment[] {
  const quotes = items.filter((i) => !i.leftOut).flatMap((i) => [i.quote, ...i.history, ...(i.evidence ? [i.evidence] : [])]);
  return quotes.map((q) => ({
    id: `s-${q.meetingId}-${q.atMs}`, meetingId: q.meetingId, speaker: q.speaker === 'Alex' ? 'you' : 'others',
    startMs: q.atMs - 1_000, endMs: q.atMs + 6_000, text: q.text, chunkId: 'sample',
  }));
}

export type SampleStore = 'meetings' | 'segments' | 'people' | 'items' | 'ledger' | 'agendas';
export interface SampleDB { put(store: SampleStore, value: unknown): Promise<unknown> }

/** Writes the sample world into a (scratch) DB. 'after' adds the recorded 1:1 and its ledger. */
export async function seedSample(db: SampleDB, moment: 'before' | 'after' = 'before'): Promise<void> {
  const after = moment === 'after';
  const all = (store: SampleStore, values: unknown[]) => values.map((v) => [store, v] as const);
  const writes = [
    ...all('meetings', after ? [...SAMPLE_MEETINGS, SAMPLE_ONE_ON_ONE] : SAMPLE_MEETINGS),
    ...all('segments', sampleSegments(after ? [...SAMPLE_ITEMS, ...SAMPLE_ONE_ON_ONE_ITEMS] : SAMPLE_ITEMS)),
    ...all('people', SAMPLE_PEOPLE),
    ...all('items', after ? [...SAMPLE_ITEMS, ...SAMPLE_ONE_ON_ONE_ITEMS] : SAMPLE_ITEMS),
    ...all('agendas', [SAMPLE_AGENDA]),
    ...all('ledger', after ? SAMPLE_LEDGER : []),
  ];
  for (const [store, value] of writes) await db.put(store, value);
}
