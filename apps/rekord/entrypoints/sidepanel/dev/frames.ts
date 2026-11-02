// Dev frame routes: one entry per FRAMES.md frame, opened at `#/dev/<Frame>`. Later tasks add their frames here.
import { getDB } from '@/lib/db';
import { M, SAMPLE_MEETINGS, SAMPLE_ONE_ON_ONE } from '@/lib/memory/sample';
import { redactSpan } from '@/lib/redact';
import type { Segment } from '@/lib/types';
import { getSettings, updateSettings } from '@/lib/settings';
import type { RouteParams, ScreenName } from '../router';
import { BACKFILL_KEY, type BackfillMeeting, type BackfillProgress } from '@/lib/memory/backfill';

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
  V4Redact: { screen: 'redact', moment: 'after', params: { meetingId: M.sarah3, ...redactParams() }, setup: redactWorld },
  V4RedactAfter: {
    screen: 'redact', moment: 'after', params: { meetingId: M.sarah3, ...redactParams() },
    setup: async () => {
      await redactWorld();
      await redactSpan(M.sarah3, REDACT_SPAN, { now: new Date(2026, 10, 3, 10, 41).getTime(), decode: async () => undefined, notify: () => undefined });
    },
  },
  V4Ledger: { screen: 'ledger', moment: 'after', params: { meetingId: M.sarah3 } },
};

function redactParams() { return { atMs: REDACT_SPAN.startMs, endMs: REDACT_SPAN.endMs }; }
