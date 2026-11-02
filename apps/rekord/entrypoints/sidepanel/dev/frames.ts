// Dev frame routes: one entry per FRAMES.md frame, opened at `#/dev/<Frame>`. Later tasks add their frames here.
import { askMemory, askMemorySession } from '@/lib/askAll';
import { getDB, listMeetings } from '@/lib/db';
import { getItem } from '@/lib/memory/store';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { world } from '../components/v4/world';
import { M, SAMPLE_AFTER, SAMPLE_MEETINGS, SAMPLE_ONE_ON_ONE, SAMPLE_PERSON_SUGGESTION } from '@/lib/memory/sample';
import { getSettings, updateSettings } from '@/lib/settings';
import type { RouteParams, ScreenName } from '../router';
import { BACKFILL_KEY, type BackfillMeeting, type BackfillProgress } from '@/lib/memory/backfill';
import { personView } from '../screens/v4/Person';
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
