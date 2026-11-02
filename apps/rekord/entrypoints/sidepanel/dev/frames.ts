// Dev frame routes: one entry per FRAMES.md frame, opened at `#/dev/<Frame>`. Later tasks add their frames here.
import { getDB } from '@/lib/db';
import { M, SAMPLE_AFTER, SAMPLE_MEETINGS, SAMPLE_ONE_ON_ONE, SAMPLE_PERSON_SUGGESTION } from '@/lib/memory/sample';
import { getSettings, updateSettings } from '@/lib/settings';
import type { RouteParams, ScreenName } from '../router';
import { BACKFILL_KEY, type BackfillMeeting, type BackfillProgress } from '../screens/v4/backfillView';

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
};
