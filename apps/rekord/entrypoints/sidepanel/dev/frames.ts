// Dev frame routes: one entry per FRAMES.md frame, opened at `#/dev/<Frame>`. Later tasks add their frames here.
import { getDB } from '@/lib/db';
import { M, SAMPLE_MEETINGS } from '@/lib/memory/sample';
import { getSettings, updateSettings } from '@/lib/settings';
import type { RouteParams, ScreenName } from '../router';
import { BACKFILL_KEY, type BackfillMeeting, type BackfillProgress } from '@/lib/memory/backfill';
import { putVectors } from '@/lib/memory/store';
import { putRecordingPart } from '@/lib/db';
import { settingsDev } from '../screens/v4/SettingsMemory';
import { folderDev } from '../screens/v4/Folder';
import { moveDev } from '../screens/v4/Move';

const MB = 1024 * 1024;

/** Search windows for every sample meeting, so "Memory size" reads about 3 MB as in the frames. */
async function seedVectors() {
  const text = 'We agreed to send the revised pricing deck to Northwind before the next sync.';
  for (const m of SAMPLE_MEETINGS) {
    await putVectors(Array.from({ length: 250 }, (_, i) => ({
      id: `${m.id}-v${i}`, meetingId: m.id, atMs: i * 10_000, endMs: i * 10_000 + 30_000, text, v: new Int8Array(384).fill(i % 100), scale: 0.01,
    })));
  }
}

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
};
