// Dev frame routes: one entry per FRAMES.md frame, opened at `#/dev/<Frame>`. Later tasks add their frames here.
import { askMemory, askMemorySession } from '@/lib/askAll';
import { getDB, listMeetings } from '@/lib/db';
import { getItem, itemsForMeeting } from '@/lib/memory/store';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { world } from '../components/v4/world';
import { SAMPLE_EVENT, SAMPLE_PEOPLE } from '@/lib/memory/sample';
import { withGoal } from '@/lib/memory/agenda';
import { lastTimeKey } from '@/lib/reminders';
import { putAgenda } from '@/lib/memory/store';
import type { MemoryItem } from '@/lib/memory/types';
import type { CalendarEvent } from '@/lib/types';
import type { ComponentType } from 'react';
import { M, SAMPLE_AFTER, SAMPLE_MEETINGS, SAMPLE_ONE_ON_ONE, SAMPLE_PERSON_SUGGESTION } from '@/lib/memory/sample';
import { redactSpan } from '@/lib/redact';
import type { Segment } from '@/lib/types';
import { getSettings, updateSettings } from '@/lib/settings';
import type { RouteParams, ScreenName } from '../router';
import { BACKFILL_KEY, type BackfillMeeting, type BackfillProgress } from '@/lib/memory/backfill';
import { personView } from '../screens/v4/Person';
import { draftKey } from '../screens/v4/Nudge';
import { putVectors } from '@/lib/memory/store';
import { putRecordingPart } from '@/lib/db';
import { settingsDev } from '../screens/v4/SettingsMemory';
import { folderDev } from '../screens/v4/Folder';
import { moveDev } from '../screens/v4/Move';

const MB = 1024 * 1024;
const at = (month: number, day: number, h: number, m: number) => new Date(2026, month - 1, day, h, m).getTime();

/** The 1:1 invite as the brief frames show it: Priya is invited too, and the invite names the rollout date. */
const BRIEF_EVENT: CalendarEvent = {
  ...SAMPLE_EVENT,
  attendees: [...SAMPLE_EVENT.attendees, { name: 'Priya Nair', email: 'priya@rekord-team.com' }],
  description: 'Agenda:\n- Northwind rollout date',
};

/** The brief's world: the invite, and "Last time" as the AI wrote it for 27 Oct. */
async function briefWorld() {
  world.events = [BRIEF_EVENT];
  await browser.storage.session.set({
    [lastTimeKey(M.sarah27)]: ['Northwind wants to start the rollout on 9 Nov.', 'Sarah owes you the Q3 usage numbers.', 'You were still finishing the pricing deck.'],
  });
}

/** V4BriefNew: "Intro with Halcyon · Thu 5 Nov · 15:00" with Marco Bell, and the goal Alex typed. */
const HALCYON: CalendarEvent = {
  id: 'evt-halcyon-1105', title: 'Intro with Halcyon', start: at(11, 5, 15, 0), end: at(11, 5, 15, 30), app: 'meet',
  attendees: [{ name: 'Alex', email: 'alex@rekord-team.com', self: true }, { name: 'Marco Bell', email: 'marco@halcyon.studio' }],
  description: 'Hi Alex, Marco here from Halcyon. Let’s use 30 minutes to walk through how your team could keep track of client calls. I’ll bring two examples from our studio.',
};

/** V4LookBack, Fri 30 Oct 16:00: 9 meetings, 6 h 40 min, 12 promises made, 8 kept, 5 decisions. */
async function weekWorld() {
  const db = await getDB();
  const extra: [string, string, number, number][] = [
    ['m-lb-design', 'Design review', at(10, 26, 16, 0), 45], ['m-lb-roadmap', 'Roadmap planning', at(10, 27, 14, 0), 60],
    ['m-lb-northwind', 'Northwind check-in', at(10, 28, 11, 0), 30], ['m-lb-launch', 'Launch prep', at(10, 29, 10, 0), 48],
    ['m-lb-retro', 'Team retro', at(10, 30, 11, 0), 60],
  ];
  for (const [id, title, start, minutes] of extra) {
    await db.put('meetings', { id, title, startedAt: start, endedAt: start + minutes * 60_000, status: 'done', language: 'en', source: 'tab' });
  }
  const add = async (id: string, ids: string[]) => {
    const p = SAMPLE_PEOPLE.find((x) => x.id === id)!;
    await db.put('people', { ...p, meetingIds: [...p.meetingIds, ...ids] });
  };
  await add('p-priya', ['m-lb-design', 'm-lb-roadmap', 'm-lb-launch']);
  await add('p-sam', ['m-lb-design', 'm-lb-roadmap', 'm-lb-launch']);
  await add('p-sarah', ['m-lb-northwind']);
  const item = (id: string, kind: MemoryItem['kind'], status: MemoryItem['status'], text: string, meetingId: string, when: number, extra: Partial<MemoryItem> = {}): MemoryItem => ({
    id, kind, status, text, meetingId, quote: { speaker: 'Alex', text: `${text}.`, meetingId, atMs: 60_000 }, personIds: [], history: [], createdAt: when, updatedAt: when, ...extra,
  });
  const kept: [string, number][] = [
    ['Send the pricing review notes', at(10, 30, 12, 0)], ['Book the Lumen intro', at(10, 30, 11, 30)], ['Update the plan page', at(10, 29, 17, 0)],
    ['Share the roadmap draft', at(10, 28, 15, 0)], ['Reply to Northwind legal', at(10, 27, 16, 0)], ['Book the design review', at(10, 27, 15, 0)],
  ];
  for (const [n, [text, when]] of kept.entries()) await db.put('items', item(`k-${n}`, 'promise', 'done', text, 'm-lb-roadmap', when - 3_600_000, { ownerId: 'me', toId: 'p-priya', personIds: ['p-priya'], updatedAt: when }));
  await db.put('items', item('d-retro', 'decision', 'open', 'Team retro moves to Fridays', 'm-lb-design', at(10, 26, 16, 10)));
  await db.put('items', item('d-design', 'decision', 'open', 'Design review every Monday', 'm-lb-design', at(10, 26, 16, 20)));
  // The fifth decision, behind "and 3 more".
  await db.put('items', item('d-design-notes', 'decision', 'open', 'Design review notes go in the doc', 'm-lb-design', at(10, 26, 16, 5)));
  await db.put('items', item('i-pricing-copy', 'promise', 'open', 'Update the pricing page copy', 'm-sync-10-12', at(10, 12, 10, 20), { ownerId: 'p-priya', toId: 'me', personIds: ['p-priya'], due: '2026-10-22' }));
}

/** Search windows for every sample meeting, so "Memory size" reads about 3 MB as in the frames. */
async function seedVectors() {
  const text = 'We agreed to send the revised pricing deck to Northwind before the next sync.';
  for (const m of SAMPLE_MEETINGS) {
    await putVectors(Array.from({ length: 250 }, (_, i) => ({
      id: `${m.id}-v${i}`, meetingId: m.id, atMs: i * 10_000, endMs: i * 10_000 + 30_000, text, v: new Int8Array(384).fill(i % 100), scale: 0.01,
    })));
  }
}
import { followUpDeps } from '../screens/v4/FollowUp';
import { sendTasksSession } from '../screens/v4/SendTasks';
import { linearConnectDeps } from '../screens/v4/LinearConnect';
import { putItem } from '@/lib/memory/store';
import { TASKS_ON_KEY } from '@/lib/services/gtasks';

export interface DevFrame {
  screen: ScreenName;
  params?: RouteParams;
  /** Sample world moment: 'before' the 1:1 (09:55) or 'after' it (10:35). Default 'before'. */
  moment?: 'before' | 'after';
  /** Puts the screen in the frame's state once the sample world is seeded. */
  setup?: () => Promise<void>;
  /** The frame's clock when it is not one of the two moments (V4LookBack: Fri 30 Oct 16:00). */
  now?: number;
  /** Full-tab and notification frames: the page drawn instead of a side panel screen. */
  page?: () => Promise<ComponentType>;
}

async function setMemory(memory: Partial<Awaited<ReturnType<typeof getSettings>>['memory']>) {
  const settings = await getSettings();
  await updateSettings({ memory: { ...settings.memory, ...memory } });
}

/** "9 of 23 meetings", paused by Groq's limit until 14:05. */
function backfillState(): BackfillProgress {
  const byId = (id: string) => SAMPLE_MEETINGS.find((m) => m.id === id)!;
  const row = (id: string, status: BackfillMeeting['status'], found?: number): BackfillMeeting =>
    ({ id, title: byId(id).title, status, ...(found !== undefined ? { found } : {}) });
  const named = [M.lumen, M.sarah27, M.review, M.sarah20, 'm-sync-10-19'];
  const others = SAMPLE_MEETINGS.filter((m) => m.id !== M.sync2 && !named.includes(m.id)).map((m) => m.id);
  const meetings = [
    ...others.slice(0, 6).map((id) => row(id, 'done', 2)),
    row(M.lumen, 'done', 3), row(M.sarah27, 'done', 4), row(M.review, 'done', 5),
    row(M.sarah20, 'working'), row('m-sync-10-19', 'waiting'),
    ...others.slice(6).map((id) => row(id, 'waiting')),
  ];
  return {
    meetings, done: 9, total: meetings.length,
    resumeAt: new Date(2026, 10, 3, 14, 5).getTime(),
    totals: { promises: 14, decisions: 6, people: 5 },
  };
}

/** After the 1:1: its summary, and "Tom" heard in the call beside Tom Becker from the invite. */
async function afterOneOnOne() {
  const db = await getDB();
  const { name } = SAMPLE_PERSON_SUGGESTION;
  const email = SAMPLE_PERSON_SUGGESTION.email!;
  const event = SAMPLE_ONE_ON_ONE.event!;
  await db.put('meetings', {
    ...SAMPLE_ONE_ON_ONE,
    event: { ...event, attendees: [...event.attendees, { name, email }] },
    summary: {
      overview: 'The Northwind rollout moves from 9 Nov to 16 Nov. You send Sarah the revised pricing deck today; Sarah sends the seat count by Fri 6 Nov. Northwind asked whether it can pay yearly.',
      decisions: [], actions: [], questions: [], generatedAt: SAMPLE_AFTER, model: 'sample',
    },
  });
  const base = { meetingIds: [M.sarah3], createdAt: SAMPLE_AFTER, updatedAt: SAMPLE_AFTER };
  await db.put('people', { id: 'p-tom', name, email, aliases: [], ...base });
  await db.put('people', { id: 'p-tom-heard', name: SAMPLE_PERSON_SUGGESTION.aliases[0]!, aliases: [], ...base });
}

const mmss = (m: number, s: number) => (m * 60 + s) * 1000;
/** V4Redact: 21:10 to 21:52 of the 1:1 (the "Can Northwind pay yearly?" question). */
const REDACT_SPAN = { startMs: mmss(21, 10), endMs: mmss(21, 52) };

/** The 1:1 around the redaction example, its summary line, a search entry, kept audio and the Rekord folder on. */
async function redactWorld() {
  const db = await getDB();
  const line = (m: number, s: number, end: [number, number], who: 'you' | 'Sarah', text: string): Segment => ({
    id: `s-redact-${m}-${s}`, meetingId: M.sarah3, speaker: who === 'you' ? 'you' : 'others', ...(who === 'Sarah' ? { speakerLabel: 'A' } : {}),
    startMs: mmss(m, s), endMs: mmss(...end), text, chunkId: 'sample',
  });
  await db.delete('segments', `s-${M.sarah3}-${mmss(21, 30)}`);
  for (const seg of [
    line(20, 44, [21, 8], 'you', 'Okay, the new date works for me.'),
    line(21, 10, [21, 28], 'Sarah', 'Before I forget, a quick one on budget.'),
    line(21, 30, [21, 42], 'Sarah', 'Can Northwind pay yearly?'),
    line(21, 44, [21, 52], 'you', 'Let me think about that and come back to you.'),
    line(21, 52, [22, 0], 'Sarah', 'Okay. Back to the seat count.'),
  ]) await db.put('segments', seg);
  await db.put('meetings', {
    ...SAMPLE_ONE_ON_ONE, speakers: { A: { name: 'Sarah' } },
    summary: { overview: 'Sarah moved the Northwind rollout to 16 Nov.', decisions: [{ text: 'Northwind rollout starts 16 Nov', atMs: mmss(19, 2) }], actions: [], questions: ['Can Northwind pay yearly?'], generatedAt: SAMPLE_ONE_ON_ONE.endedAt!, model: 'sample' },
  });
  await db.put('vectors', { id: 'v-redact', meetingId: M.sarah3, atMs: mmss(21, 0), endMs: mmss(21, 40), text: 'sample', v: new Int8Array(4), scale: 1 });
  await db.put('recordings', { id: 'r-redact', meetingId: M.sarah3, seq: 0, blob: new Blob(['sample'], { type: 'audio/webm' }), mimeType: 'audio/webm' });
  await setMemory({ folder: true });
}

const noRecord = async () => ({ id: '', service: 'groq' as const, what: '', count: 0, firstAt: 0, lastAt: 0 });
const json = (body: unknown) => new Response(JSON.stringify(body));

/** The AI's draft in the frame: the plain draft it was asked to reword, unchanged. */
function echoDraft() {
  followUpDeps.current = {
    config: { settings: DEFAULT_SETTINGS, keys: { GROQ_API_KEY: 'gsk_test' } },
    record: noRecord,
    fetch: async (_url, init) => {
      const prompt = (JSON.parse(String(init?.body)) as { messages: { content: string }[] }).messages[1]!.content;
      const draft = prompt.split('exactly:\n\n')[1]!.split('\n\nMeeting summary')[0]!;
      return json({ choices: [{ message: { content: draft } }] });
    },
  };
}

/** After "Send 2 to Google Tasks": both of your promises are in My Tasks. */
async function sentTwo() {
  await afterOneOnOne();
  await browser.storage.local.set({ [TASKS_ON_KEY]: true });
  for (const id of ['n-deck', 'n-demo']) {
    const item = (await getItem(id))!;
    await putItem({ ...item, sentTo: [{ service: 'gtasks', url: 'https://tasks.google.com/', at: world.now() }] });
  }
  sendTasksSession.done = { meetingId: M.sarah3, service: 'gtasks', target: 'My Tasks', sentIds: ['n-deck', 'n-demo'] };
}

export const DEV_FRAMES: Record<string, DevFrame> = {
  V4Home: { screen: 'home' },
  V4Promise: { screen: 'promise', params: { itemId: 'i-deck' } },
  V4LooksDone: { screen: 'looksDone', params: { itemId: 'i-checklist' } },
  V4Nudge: {
    screen: 'nudge', params: { itemId: 'i-q3' },
    // The AI's Friendly draft in the frame, so the route opens without a key.
    setup: async () => {
      await browser.storage.session.set({ [draftKey('i-q3', 'friendly')]: 'Hi Sarah, could you send over the Q3 usage numbers today? You mentioned them in our 1:1 last week, and I’d like them before we talk at 10:00. Thank you, Alex' });
    },
  },
  V4Decisions: { screen: 'decisions' },
  V4WhatsNew: {
    screen: 'whatsnew',
    // Before the update: the 23 earlier meetings, without the 2 Nov sync.
    setup: async () => {
      await (await getDB()).delete('meetings', M.sync2);
      await setMemory({ backfill: 'ask' });
    },
  },
  V4Review: { screen: 'review', params: { meetingId: M.sarah3 }, moment: 'after', setup: afterOneOnOne },
  V4ReviewEdit: { screen: 'reviewEdit', params: { meetingId: M.sarah3, itemId: 'n-intro' }, moment: 'after', setup: afterOneOnOne },
  V4Summary: { screen: 'summary', params: { meetingId: M.sarah3 }, moment: 'after', setup: afterOneOnOne },
  V4Backfill: {
    screen: 'backfill',
    setup: async () => {
      await setMemory({ backfill: 'running' });
      await browser.storage.local.set({ [BACKFILL_KEY]: backfillState() });
    },
  },
  V4People: { screen: 'people' },
  V4Person: {
    screen: 'person', params: { personId: 'p-sarah' },
    setup: async () => { personView.menuOpen = true; },
  },
  V4PersonMerge: { screen: 'personMerge', params: { personId: 'p-sam-guest', otherId: 'p-sam' } },
  V4Forget: {
    screen: 'forget', params: { personId: 'p-sarah' },
    setup: async () => { await setMemory({ folder: true }); },
  },
  V4AskAll: {
    screen: 'askall',
    // First use: the question already answered from the decision and the promise, with the model card above.
    setup: async () => {
      await setMemory({ searchModel: 'none' });
      const hit = async (id: string) => ({ item: (await getItem(id))!, score: 1 });
      const reply = 'The Team plan is $12 a seat, up from $10, agreed at the Pricing review on 26 Oct. [1] You still owe Sarah the revised pricing deck, 4 days late. [2]';
      const result = await askMemory('What did we agree with Sarah about pricing?', 'all', await listMeetings(), {
        now: world.now(),
        search: async () => ({ mode: 'hybrid', items: [await hit('d-team-12'), await hit('i-deck')], meetings: [] }),
        config: { settings: DEFAULT_SETTINGS, keys: { GROQ_API_KEY: 'gsk_test' } },
        fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: reply } }] })),
        record: async () => ({ id: '', service: 'groq', what: '', count: 0, firstAt: 0, lastAt: 0 }),
      });
      askMemorySession.scope = 'all';
      askMemorySession.turns = [result];
    },
  },
  V4Redact: { screen: 'redact', moment: 'after', params: { meetingId: M.sarah3, ...redactParams() }, setup: redactWorld },
  V4RedactAfter: {
    screen: 'redact', moment: 'after', params: { meetingId: M.sarah3, ...redactParams() },
    setup: async () => {
      await redactWorld();
      await redactSpan(M.sarah3, REDACT_SPAN, { now: new Date(2026, 10, 3, 10, 41).getTime(), decode: async () => undefined, notify: () => undefined, recording: async () => undefined });
    },
  },
  V4Ledger: { screen: 'ledger', moment: 'after', params: { meetingId: M.sarah3 } },
  V4SettingsMemory: {
    screen: 'settingsMemory',
    setup: async () => {
      settingsDev.model = { state: 'ready', bytes: 22 * MB };
      await seedVectors();
    },
  },
  V4Folder: {
    screen: 'folder',
    moment: 'after',
    setup: async () => {
      folderDev.board = {
        label: 'On, and after Chrome restarts',
        on: { state: 'needsPermission', name: 'C:\\Users\\Alex\\Documents\\Rekord', lastWrittenAt: new Date(2026, 10, 3, 10, 49).getTime(), queued: 0, past: 24 },
      };
    },
  },
  V4Move: {
    screen: 'move',
    setup: async () => {
      // A kept recording, so the file reads "with audio" at about the frame's size.
      await putRecordingPart({ id: 'rec-sample', meetingId: M.sync2, seq: 0, mimeType: 'audio/webm', blob: new Blob([new Uint8Array(30.5 * MB)], { type: 'audio/webm' }) });
      moveDev.chosen = { name: 'rekord-2026-10-30.rekord', preview: { meetings: 312, people: 48, already: 6 } };
    },
  },
  V4FollowUp: {
    screen: 'followUp', params: { meetingId: M.sarah3 }, moment: 'after',
    setup: async () => { await afterOneOnOne(); echoDraft(); },
  },
  V4SendTasks: {
    screen: 'sendTasks', params: { meetingId: M.sarah3 }, moment: 'after',
    // First time: Google Tasks is not turned on yet.
    setup: async () => { await afterOneOnOne(); await browser.storage.local.remove(TASKS_ON_KEY); },
  },
  V4SendTasksDone: { screen: 'sendTasks', params: { meetingId: M.sarah3 }, moment: 'after', setup: sentTwo },
  V4LinearConnect: {
    screen: 'linearConnect',
    // LINEAR_API_KEY found in Penv Cloud, Linear already allowed: its one team, Product.
    setup: async () => {
      linearConnectDeps.current = {
        loadKeys: async () => ({ LINEAR_API_KEY: 'lin_api_test' }),
        penvKeys: async () => true,
        hasHosts: async () => true,
        record: noRecord,
        fetch: async () => json({ data: { teams: { nodes: [{ id: 't-product', name: 'Product' }] } } }),
      };
    },
  },
};

Object.assign(DEV_FRAMES, {
  V4Brief: { screen: 'brief', params: { eventId: SAMPLE_EVENT.id }, setup: briefWorld },
  V4AgendaEdit: { screen: 'agendaEdit', params: { eventId: SAMPLE_EVENT.id }, setup: briefWorld },
  V4BriefNew: {
    screen: 'brief', params: { eventId: HALCYON.id },
    setup: async () => {
      world.events = [HALCYON];
      await putAgenda(withGoal({ meetingKey: HALCYON.id, items: [], totalMinutes: 30 }, 'Learn what Halcyon needs and agree on a next step.'));
    },
  },
  V4BriefTab: { screen: 'brief', setup: briefWorld, page: async () => (await import('../../brief/BriefTab')).default },
  V4Notification: { screen: 'brief', setup: briefWorld, page: async () => (await import('./NotificationPreview')).default },
  V4LookBack: { screen: 'home', now: at(10, 30, 16, 0), setup: weekWorld, page: async () => (await import('../../lookback/LookBack')).default },
  // T14: every V4States card stacked on one 400-wide board.
  V4States: {
    screen: 'home',
    // The board's "Intro with Lumen" holds 3 memory items; the sample world keeps one, so two dismissed ones join it.
    setup: async () => {
      const [lumen] = await itemsForMeeting(M.lumen);
      if (!lumen) return;
      for (const id of ['i-lumen-2', 'i-lumen-3']) await putItem({ ...lumen, id, status: 'dismissed' });
    },
    page: async () => (await import('./StatesBoard')).default,
  },
} satisfies Record<string, DevFrame>);

function redactParams() { return { atMs: REDACT_SPAN.startMs, endMs: REDACT_SPAN.endMs }; }

// T10 during the meeting: the 1:1 at recording time 18:42 (10:18), staged without a recorder.
import { liveDev } from '../screens/Live';
import { startDev } from '../screens/Start';
import { liveAskSession } from '../screens/Ask';
import { recallCard } from '@/lib/live/recall';
import { whatDidIMiss } from '@/lib/live/missed';
import { confirmClash } from '@/lib/live/clash';
import { listPeople } from '@/lib/memory/store';
import { SAMPLE_ITEMS } from '@/lib/memory/sample';
import type { RecordingState } from '@/lib/types';

const ONE_ON_ONE_START = at(11, 3, 10, 0);
const DURING = ONE_ON_ONE_START + mmss(18, 42);
const AI = { settings: DEFAULT_SETTINGS, keys: { GROQ_API_KEY: 'gsk_test' } };
const aiSays = (content: string) => async () => json({ choices: [{ message: { content } }] });

/** What was said up to 18:42: the agenda talk (items 1 and 2 covered at 04:10 and 12:30) and the lines the frames show. */
const DURING_LINES: [number, number, 'you' | 'Sarah', string][] = [
  [0, 20, 'Sarah', 'Let’s start with the Q3 usage numbers.'],
  [4, 10, 'Sarah', 'The Q3 usage numbers are in the doc I shared.'],
  [4, 40, 'you', 'Great. Next, the revised pricing deck.'],
  [12, 30, 'you', 'I’ll finish the pricing deck changes.'],
  [15, 42, 'Sarah', 'Now the Northwind rollout date.'],
  [16, 5, 'Sarah', 'Can you send the deck today?'],
  [16, 30, 'you', 'For the rollout date, the 9th is still the plan.'],
  [18, 14, 'you', 'The 9th still works on our side.'],
  [18, 26, 'Sarah', 'I need to check one thing with our IT lead.'],
  [18, 36, 'you', 'Want the seat count before or after that?'],
];
const duringSegment = (m: number, s: number, who: 'you' | 'Sarah', text: string, extra: Partial<Segment> = {}): Segment => ({
  id: `s-live-${m}-${s}`, meetingId: M.sarah3, speaker: who === 'you' ? 'you' : 'others', ...(who === 'Sarah' ? { speakerLabel: 'A' } : {}),
  startMs: mmss(m, s), endMs: mmss(m, s) + 8_000, text, chunkId: 'sample', ...extra,
});

/** The 1:1 recording at 18:42, its transcript, and the recorder state the panel would hear from the background. */
async function duringWorld(opts: { skip?: number[]; extra?: Segment[]; offSince?: number } = {}) {
  const db = await getDB();
  const { endedAt: _ended, ...meeting } = SAMPLE_ONE_ON_ONE;
  await db.put('meetings', { ...meeting, status: 'recording', speakers: { A: { name: 'Sarah' } } });
  const lines = DURING_LINES.filter((l) => !opts.skip?.includes(l[0] * 60 + l[1])).map((l) => duringSegment(...l));
  for (const seg of [...lines, ...(opts.extra ?? [])]) await db.put('segments', seg);
  const rec: RecordingState = {
    status: 'recording', meetingId: M.sarah3, startedAt: ONE_ON_ONE_START, micLevel: 0, tabLevel: 0,
    ...(opts.offSince !== undefined ? { offRecord: { since: opts.offSince, spans: [] } } : {}),
  };
  Object.assign(liveDev, { rec, stream: 'live', view: 'transcript', recall: undefined, missed: undefined, clash: undefined, interim: undefined });
  return lines;
}
const sarahNow = (text: string) => duringSegment(18, 40, 'Sarah', text, { id: 's-live-now', interim: true, chunkId: 'live' });
const item = (id: string) => SAMPLE_ITEMS.find((i) => i.id === id)!;

Object.assign(DEV_FRAMES, {
  V4TellPeople: {
    screen: 'start',
    setup: async () => {
      startDev.tab = { id: 1, title: '1:1 with Sarah', url: 'https://meet.google.com/xyz-abcd-efg' };
      startDev.keysReady = true;
    },
  },
  V4Live: {
    screen: 'live', params: { meetingId: M.sarah3 }, now: DURING,
    setup: async () => {
      await duringWorld();
      liveDev.interim = sarahNow('After. Let me think about the date first.');
      liveDev.recall = recallCard([item('d-team-12'), item('i-q3')], SAMPLE_MEETINGS, await listPeople(), DURING);
    },
  },
  V4LiveAgenda: {
    screen: 'live', params: { meetingId: M.sarah3 }, now: DURING,
    setup: async () => {
      await duringWorld();
      liveDev.view = 'agenda';
    },
  },
  V4Missed: {
    screen: 'live', params: { meetingId: M.sarah3 }, now: DURING,
    // The AI's catch-up in the frame, through the real call with a fake reply.
    setup: async () => {
      const lines = await duringWorld();
      liveDev.interim = sarahNow('After. Let me think about the date first.');
      const reply = JSON.stringify({
        lines: [
          { atMs: mmss(18, 39), text: 'Sarah wants to settle the Northwind rollout date today.' },
          { atMs: mmss(18, 40), text: 'She needs to check the date with her IT lead first.' },
          { atMs: mmss(18, 41), text: 'You offered the seat count once the date is set.' },
        ],
        forYou: 'Sarah asked if you can join Thursday’s rollout demo.',
      });
      const result = await whatDidIMiss({ id: M.sarah3, speakers: { A: { name: 'Sarah' } } }, lines, 3, mmss(18, 42), { config: AI, record: noRecord, fetch: aiSays(reply) });
      liveDev.missed = { minutes: 3, result };
    },
  },
  V4OffRecord: {
    // 11 s after going off the record at 18:42; the 18:36 line is left out, as the frame draws it.
    screen: 'live', params: { meetingId: M.sarah3 }, now: DURING + 11_000,
    setup: async () => { await duringWorld({ skip: [18 * 60 + 36], offSince: DURING }); },
  },
  V4Clash: {
    screen: 'live', params: { meetingId: M.sarah3 }, now: DURING,
    // Clash alerts turned on for this story; the AI confirms through the real call with a fake reply.
    setup: async () => {
      await setMemory({ clash: true });
      const line = duringSegment(18, 40, 'Sarah', 'Let’s move the rollout to the 16th.', { id: 's-live-clash' });
      await duringWorld({ extra: [line] });
      const decision = item('d-rollout-9');
      const found = await confirmClash(M.sarah3, { decision, segment: line }, 'Sarah', '27 Oct', {
        config: AI, record: noRecord, fetch: aiSays(JSON.stringify({ changes: true, decision: 'Northwind rollout starts 16 Nov' })),
      });
      liveDev.clash = found && { clash: found, decidedAt: SAMPLE_MEETINGS.find((m) => m.id === M.sarah27)!.startedAt };
    },
  },
  V4LiveAsk: {
    screen: 'live', params: { meetingId: M.sarah3 }, now: DURING,
    // "What did Sarah say about seats last time?" answered from the decision and the 27 Oct 1:1.
    setup: async () => {
      await duringWorld();
      liveDev.view = 'ask';
      const db = await getDB();
      const sarah27 = SAMPLE_MEETINGS.find((m) => m.id === M.sarah27)!;
      await db.put('meetings', { ...sarah27, speakers: { A: { name: 'Sarah' } } });
      await db.put('segments', { id: 's-seats-27', meetingId: M.sarah27, speaker: 'others', speakerLabel: 'A', startMs: mmss(4, 12), endMs: mmss(4, 18), text: 'Ten seats to start is realistic for us.', chunkId: 'sample' });
      const result = await askMemory('What did Sarah say about seats last time?', 'all', await listMeetings(), {
        now: DURING, config: AI, record: noRecord,
        search: async () => ({ mode: 'hybrid', items: [{ item: (await getItem('d-team-12'))!, score: 1 }], meetings: [{ meeting: sarah27, score: 1, atMs: mmss(4, 12), text: 'Ten seats to start is realistic for us.' }] }),
        fetch: aiSays('On 27 Oct Sarah said ten seats to start is realistic. The team plan was set at $12 a seat on 26 Oct. [1] [2]'),
      });
      Object.assign(liveAskSession, { meetingId: M.sarah3, scope: 'all', turns: [result] });
    },
  },
} satisfies Record<string, DevFrame>);
