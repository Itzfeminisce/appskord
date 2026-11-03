// The FRAMES.md sample world, for dev frame routes and tests. Story day: Tue 3 Nov 2026.
import type { CatchupQuestion, SomethingElseForm } from '../catchup/types';
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
    // Filler decisions stay older than last week, so V4Decisions shows "3 recent".
    const pool = kind === 'decision' ? earlier.slice(0, -1) : earlier;
    for (let n = 1; n <= count; n++) {
      const meetingId = pool[n % pool.length]!;
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
  sug('n-deck', 'promise', 'Send the revised pricing deck', one('Alex', 'Yes, I’ll send the deck today.', 16, 5),
    { ownerId: 'me', toId: 'p-sarah', due: '2026-11-03' }),
  sug('n-demo', 'promise', 'Join Thursday’s rollout demo', one('Alex', 'I’ll join Thursday’s rollout demo.', 17, 20),
    { ownerId: 'me', toId: 'p-sarah', due: '2026-11-05' }),
  sug('n-seats', 'promise', 'Northwind seat count', one('Sarah', 'I’ll send you the seat count by Friday.', 24, 10),
    { ownerId: 'p-sarah', toId: 'me', due: '2026-11-06' }),
  sug('n-intro', 'promise', 'Intro to Northwind’s IT lead', one('Sarah', 'I’ll introduce you to our IT lead.', 26, 45),
    { ownerId: 'p-sarah', toId: 'me' }),
  sug('n-rollout-16', 'decision', 'Northwind rollout starts 16 Nov', one('Sarah', 'Let’s move the rollout to the 16th.', 19, 2),
    { replacesId: 'd-rollout-9' }),
  sug('n-yearly', 'question', 'Can Northwind pay yearly?', one('Sarah', 'Could we pay yearly instead of monthly?', 21, 30)),
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

// v4.1 "Catch up": v4's world one day earlier (FRAMES v4.1 "Sample world"). Story day: Mon 2 Nov 2026.

/** Home is staged at 17:05; the Northwind meeting ended at 17:00 and Rekord did not record it. */
export const V41_NOW = at(11, 2, 17, 5);
/** You tell it at 17:10. */
export const V41_TOLD_AT = at(11, 2, 17, 10);

const TOM = { name: 'Tom Becker', email: 'tom@northwind.co' };
const PRIYA = { name: 'Priya Nair', email: 'priya@rekord-team.com' };
const SAM = { name: 'Sam Ortiz', email: 'sam@rekord-team.com' };

export const V41_EVENT: CalendarEvent = {
  id: 'evt-northwind-1102', title: 'Q4 planning with Northwind', start: at(11, 2, 13, 0), end: at(11, 2, 17, 0),
  attendees: [ME, SARAH, TOM, PRIYA], app: 'meet',
};

/** The calendar's last 7 days: the Northwind meeting, two older misses, and the recorded Weekly product sync (not listed). */
export const V41_EVENTS: CalendarEvent[] = [
  V41_EVENT,
  { id: 'evt-sync-1102', title: 'Weekly product sync', start: at(11, 2, 10, 0), end: at(11, 2, 10, 47), attendees: [ME, PRIYA, SAM], app: 'meet' },
  { id: 'evt-hiring-1029', title: 'Hiring sync', start: at(10, 29, 15, 0), end: at(10, 29, 15, 30), attendees: [ME, PRIYA, SAM], app: 'meet' },
  { id: 'evt-retro-1028', title: 'Team retro', start: at(10, 28, 16, 0), end: at(10, 28, 16, 45), attendees: [ME, PRIYA, SAM], app: 'meet' },
];

/** V41PickOther's example: not a calendar meeting. */
export const V41_FORM: SomethingElseForm = {
  name: 'Lunch with Dana', date: '2026-10-30', start: '12:30', lengthMin: 60, attendees: [{ name: 'Dana Ruiz', email: 'dana@lumen.io' }],
};

const CATCHUP_ID = 'm-northwind-11-02';
/** The telling is 12:34 of voice, then 6 s of voice answer: "12:40" in all. */
const TELLING_MS = mmss(12, 34);
const ANSWER_AT = TELLING_MS + 1_000;

export const V41_QUESTIONS: CatchupQuestion[] = [
  { id: 'q1', text: 'Tom is setting up admin access for the pilot. By when?', about: 'due' },
  { id: 'q2', text: 'Who signs off on the training budget?', about: 'outcome' },
  { id: 'q3', text: 'Priya was there. Did she take anything on?', about: 'owner' },
];

/** The catch-up meeting: startedAt and endedAt are the meeting's, `told` is the telling's. */
export const V41_CATCHUP: Meeting = {
  id: CATCHUP_ID, title: V41_EVENT.title, startedAt: V41_EVENT.start, endedAt: V41_EVENT.end, status: 'done', language: 'en',
  source: 'catchup', event: V41_EVENT,
  told: {
    at: V41_TOLD_AT, ms: mmss(12, 40),
    parts: [{ at: V41_TOLD_AT, ms: TELLING_MS, kind: 'voice' }, { at: V41_TOLD_AT + TELLING_MS + 60_000, ms: mmss(0, 6), kind: 'voice' }],
    answers: [
      { questionId: 'q1', text: 'By Friday.', atMs: ANSWER_AT },
      { questionId: 'q2', skipped: true },
      { questionId: 'q3', text: 'No, she was there to listen.' },
    ],
  },
};

/** What you said; every segment is yours. */
export const V41_LINES: [number, string][] = [
  [mmss(0, 40), 'Sarah, Tom and Priya were there.'],
  [mmss(3, 5), 'We agreed the pilot starts with Northwind’s Support team.'],
  [mmss(5, 12), 'Then we went through the timeline for the pilot.'],
  [mmss(5, 48), 'I said I’d send Sarah the Q4 plan draft by Wednesday.'],
  [mmss(6, 15), 'And Tom is setting up admin access for the pilot.'],
  // FRAMES names this question but not its words; the quote is ours.
  [mmss(8, 20), 'Nobody knew who signs off on the training budget.'],
  [ANSWER_AT, 'By Friday.'],
];

export const V41_SEGMENTS: Segment[] = V41_LINES.map(([startMs, text]) => ({
  id: `s-${CATCHUP_ID}-${startMs}`, meetingId: CATCHUP_ID, speaker: 'you', startMs, endMs: startMs + 4_000, text, chunkId: 'sample',
}));

const told = (text: string) => quote('Alex', text, CATCHUP_ID, V41_LINES.find(([, t]) => t === text)![0]);
const fromTelling = (id: string, kind: MemoryItem['kind'], text: string, q: Quote, extra: Partial<MemoryItem> = {}): MemoryItem => {
  const createdAt = V41_TOLD_AT + q.atMs;
  return { id, kind, status: 'suggested', text, quote: q, meetingId: CATCHUP_ID, personIds: [], history: [], createdAt, updatedAt: createdAt, ...extra };
};

/** Tom Becker, new from the invite. */
export const V41_TOM: Person = {
  id: 'p-tom', name: 'Tom Becker', email: 'tom@northwind.co', company: 'Northwind', aliases: ['Tom'], meetingIds: [CATCHUP_ID],
  createdAt: V41_TOLD_AT + mmss(12, 40), updatedAt: V41_TOLD_AT + mmss(12, 40),
};

/** "5 things": 2 promises, 1 decision, 1 question (the 4 memory items), plus Tom. All wait for review. */
export const V41_ITEMS: MemoryItem[] = [
  fromTelling('c-pilot', 'decision', 'The pilot starts with Northwind’s Support team', told('We agreed the pilot starts with Northwind’s Support team.'),
    { personIds: ['p-sarah'] }),
  fromTelling('c-plan-draft', 'promise', 'Send the Q4 plan draft', told('I said I’d send Sarah the Q4 plan draft by Wednesday.'),
    { ownerId: 'me', toId: 'p-sarah', personIds: ['p-sarah'], due: '2026-11-04' }),
  fromTelling('c-admin', 'promise', 'Admin access for the pilot', told('And Tom is setting up admin access for the pilot.'),
    { ownerId: 'p-tom', toId: 'me', personIds: ['p-tom'], due: '2026-11-06', history: [told('By Friday.')] }),
  fromTelling('c-training', 'question', 'Who signs off on the training budget?', told('Nobody knew who signs off on the training budget.')),
];

/** Writes v4's world as of 2 Nov ('before'), plus the catch-up, its telling, items and Tom ('after'). */
export async function seedSampleV41(db: SampleDB, moment: 'before' | 'after' = 'before'): Promise<void> {
  await seedSample(db, 'before');
  if (moment === 'before') return;
  const writes: [SampleStore, unknown][] = [
    ['meetings', V41_CATCHUP], ...V41_SEGMENTS.map((v) => ['segments', v] as [SampleStore, unknown]),
    ['people', V41_TOM], ...V41_ITEMS.map((v) => ['items', v] as [SampleStore, unknown]),
  ];
  for (const [store, value] of writes) await db.put(store, value);
}
