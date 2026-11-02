// Dev frame routes: one entry per FRAMES.md frame, opened at `#/dev/<Frame>`. Later tasks add their frames here.
import { askMemory, askMemorySession } from '@/lib/askAll';
import { getDB, listMeetings } from '@/lib/db';
import { getItem } from '@/lib/memory/store';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { world } from '../components/v4/world';
import { M, SAMPLE_MEETINGS } from '@/lib/memory/sample';
import { getSettings, updateSettings } from '@/lib/settings';
import type { RouteParams, ScreenName } from '../router';
import { BACKFILL_KEY, type BackfillMeeting, type BackfillProgress } from '@/lib/memory/backfill';
import { personView } from '../screens/v4/Person';

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
};
