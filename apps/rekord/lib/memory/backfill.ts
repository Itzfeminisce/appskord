import { listMeetings, listSegments } from '../db';
import { LLMError, type FetchLike } from '../llm';
import { getSettings, updateSettings } from '../settings';
import { extractMeeting, type ExtractDeps } from './extract';
import { itemsForMeeting, listItems, listPeople } from './store';

export const BACKFILL_KEY = 'rekord.backfill';
export const BACKFILL_ALARM = 'rekord.backfill';
export const RATE_LIMIT_WAIT_MS = 60_000;
// If the worker is stopped mid-meeting, this alarm picks the queue up again.
export const WATCHDOG_MS = 5 * 60_000;

export interface BackfillMeeting { id: string; title: string; status: 'done' | 'working' | 'waiting'; found?: number }
export interface BackfillProgress {
  meetings: BackfillMeeting[];
  done: number;
  total: number;
  resumeAt?: number;
  totals?: { promises: number; decisions: number; people: number };
}

export async function readBackfill(): Promise<BackfillProgress | undefined> {
  return (await browser.storage.local.get(BACKFILL_KEY))[BACKFILL_KEY] as BackfillProgress | undefined;
}

async function save(p: BackfillProgress): Promise<void> {
  await browser.storage.local.set({ [BACKFILL_KEY]: { ...p, done: p.meetings.filter((m) => m.status === 'done').length, total: p.meetings.length } });
}

/** The queue: every earlier finished meeting with speech in it, oldest first. */
export async function backfillQueue(): Promise<BackfillMeeting[]> {
  const meetings = (await listMeetings()).filter((m) => m.status === 'done').sort((a, b) => a.startedAt - b.startedAt);
  const withSpeech = await Promise.all(meetings.map(async (m) => (await listSegments(m.id)).some((s) => s.text.trim())));
  return meetings.filter((_, i) => withSpeech[i]).map((m) => ({ id: m.id, title: m.title, status: 'waiting' }));
}

/** "Build memory": queues the earlier meetings and wakes the background, which does the work. */
export async function requestBackfill(): Promise<BackfillProgress> {
  const progress: BackfillProgress = { meetings: await backfillQueue(), done: 0, total: 0 };
  await save(progress);
  await updateSettings({ memory: { ...(await getSettings()).memory, backfill: 'running' } });
  await browser.alarms.create(BACKFILL_ALARM, { when: Date.now() });
  return (await readBackfill())!;
}

let running: Promise<void> | undefined;

/** Works through the queue one meeting at a time. Safe to call again: a second call joins the running one. */
export function runBackfill(deps: ExtractDeps & { fetchFn?: FetchLike } = {}): Promise<void> {
  running ??= work(deps).finally(() => (running = undefined));
  return running;
}

async function work(deps: ExtractDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const progress = await readBackfill();
  if (!progress || (await getSettings()).memory.backfill !== 'running') return;
  if (progress.resumeAt && progress.resumeAt > now()) {
    await browser.alarms.create(BACKFILL_ALARM, { when: progress.resumeAt });
    return;
  }
  delete progress.resumeAt;
  for (const row of progress.meetings) {
    if (row.status === 'done') continue;
    if ((await getSettings()).memory.backfill !== 'running') return;
    row.status = 'working';
    await save(progress);
    await browser.alarms.create(BACKFILL_ALARM, { when: now() + WATCHDOG_MS });
    try {
      const had = (await itemsForMeeting(row.id)).filter((i) => !i.leftOut).length;
      row.found = had || (await extractMeeting(row.id, deps)).found;
      row.status = 'done';
    } catch (error) {
      if (error instanceof LLMError && error.code === 'rate-limited') {
        row.status = 'waiting';
        progress.resumeAt = now() + (error.retryAfterMs ?? RATE_LIMIT_WAIT_MS);
        await save(progress);
        await browser.alarms.create(BACKFILL_ALARM, { when: progress.resumeAt });
        return;
      }
      console.error('Rekord: could not extract memory', error);
      row.status = 'done';
      row.found = 0;
    }
    await save(progress);
  }
  const [items, people] = await Promise.all([listItems(), listPeople()]);
  const live = items.filter((i) => !i.leftOut && i.status !== 'dismissed');
  progress.totals = {
    promises: live.filter((i) => i.kind === 'promise').length,
    decisions: live.filter((i) => i.kind === 'decision').length,
    people: people.length,
  };
  await save(progress);
  await browser.alarms.clear(BACKFILL_ALARM);
  await updateSettings({ memory: { ...(await getSettings()).memory, backfill: 'done' } });
}
