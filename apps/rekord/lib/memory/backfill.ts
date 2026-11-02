import { listMeetings, listSegments } from '../db';
import { LLMError, type FetchLike } from '../llm';
import { getSettings, updateSettings } from '../settings';
import { extractMeeting, partsSaved, type ExtractDeps } from './extract';
import { itemsForMeeting, listItems, listPeople } from './store';

export const BACKFILL_KEY = 'rekord.backfill';
export const BACKFILL_ALARM = 'rekord.backfill';
export const QUEUE_KEY = 'rekord.extract.queue';
export const RATE_LIMIT_WAIT_MS = 60_000;
// Rate limits in a row, with no new part answered, before a meeting is given up on.
export const MAX_RATE_LIMITS = 5;
// If the worker is stopped mid-meeting, this alarm picks the queue up again.
export const WATCHDOG_MS = 5 * 60_000;

export interface BackfillMeeting { id: string; title: string; status: 'done' | 'working' | 'waiting' | 'failed'; found?: number; rateLimits?: number }
export interface BackfillProgress {
  meetings: BackfillMeeting[];
  /** Meetings finished, failed ones included. */
  done: number;
  failed?: number;
  total: number;
  resumeAt?: number;
  /** Set when the AI connection needs fixing; the backfill stops and "Build memory" resumes it. */
  error?: 'key' | 'model';
  totals?: { promises: number; decisions: number; people: number };
}

/** Meetings finished after their summary, waiting for extraction in the background. */
export interface ExtractQueue {
  ids: string[]; rateLimits: Record<string, number>; resumeAt?: number;
  /** Set while the queue waits for the AI connection to be fixed (V4States "Memory is waiting for Groq"). */
  stopped?: 'key' | 'model';
  /** Meetings whose extraction failed; "Try again" queues them again. */
  failed?: string[];
}

export async function readBackfill(): Promise<BackfillProgress | undefined> {
  return (await browser.storage.local.get(BACKFILL_KEY))[BACKFILL_KEY] as BackfillProgress | undefined;
}

async function save(p: BackfillProgress): Promise<void> {
  const done = p.meetings.filter((m) => m.status === 'done' || m.status === 'failed').length;
  const failed = p.meetings.filter((m) => m.status === 'failed').length;
  await browser.storage.local.set({ [BACKFILL_KEY]: { ...p, done, failed, total: p.meetings.length } });
}

export async function readQueue(): Promise<ExtractQueue> {
  return ((await browser.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as ExtractQueue | undefined) ?? { ids: [], rateLimits: {} };
}

/** Read and write in one step, so an id added from the side panel meanwhile is kept. */
async function changeQueue(change: (q: ExtractQueue) => void): Promise<ExtractQueue> {
  const q = await readQueue();
  change(q);
  await browser.storage.local.set({ [QUEUE_KEY]: q });
  return q;
}

/** After a summary: hands the meeting to the background, so extraction survives the panel closing. */
export async function enqueueExtraction(meetingId: string): Promise<void> {
  const q = await changeQueue((x) => {
    if (!x.ids.includes(meetingId)) x.ids.push(meetingId);
    if (x.failed) x.failed = x.failed.filter((id) => id !== meetingId);
  });
  if (!q.resumeAt) await browser.alarms.create(BACKFILL_ALARM, { when: Date.now() });
}

/** The queue: every earlier finished meeting with speech in it, oldest first. */
export async function backfillQueue(): Promise<BackfillMeeting[]> {
  const meetings = (await listMeetings()).filter((m) => m.status === 'done').sort((a, b) => a.startedAt - b.startedAt);
  const withSpeech = await Promise.all(meetings.map(async (m) => (await listSegments(m.id)).some((s) => s.text.trim())));
  return meetings.filter((_, i) => withSpeech[i]).map((m) => ({ id: m.id, title: m.title, status: 'waiting' }));
}

/** "Build memory": queues the earlier meetings and wakes the background. Already running: nothing, unless it stopped on an error, which it resumes. */
export async function requestBackfill(): Promise<BackfillProgress> {
  const current = await readBackfill();
  if ((await getSettings()).memory.backfill === 'running' && current) {
    if (!current.error) return current;
    delete current.error;
    await save(current);
  } else {
    await save({ meetings: await backfillQueue(), done: 0, total: 0 });
    await updateSettings({ memory: { ...(await getSettings()).memory, backfill: 'running' } });
  }
  await browser.alarms.create(BACKFILL_ALARM, { when: Date.now() });
  return (await readBackfill())!;
}

let running: Promise<void> | undefined;

/** Works through the extraction queue, then the backfill, one meeting at a time. A second call joins the running one. */
export function runBackfill(deps: ExtractDeps & { fetchFn?: FetchLike } = {}): Promise<void> {
  running ??= work(deps).finally(() => (running = undefined));
  return running;
}

type Outcome = 'finished' | 'paused' | 'stopped';

const stopCode = (error: unknown): BackfillProgress['error'] => {
  if (!(error instanceof LLMError)) return undefined;
  if (error.code === 'no-key' || error.code === 'auth') return 'key';
  if (error.code === 'model-not-found' || error.code === 'not-for-text') return 'model';
  return undefined;
};
const rateLimited = (error: unknown): error is LLMError => error instanceof LLMError && error.code === 'rate-limited';

async function work(deps: ExtractDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const tried = new Set<string>();
  for (;;) {
    const queue = await readQueue();
    const progress = await readBackfill();
    const backfilling = !!progress && !progress.error && (await getSettings()).memory.backfill === 'running';
    // One provider, one limit: either pause holds both.
    const wait = Math.max(queue.resumeAt ?? 0, backfilling ? progress.resumeAt ?? 0 : 0);
    if (wait > now()) {
      await browser.alarms.create(BACKFILL_ALARM, { when: wait });
      return;
    }
    if (queue.resumeAt) await changeQueue((q) => delete q.resumeAt);
    const fresh = queue.ids.filter((id) => !tried.has(id));
    if (fresh.length) {
      if ((await drainQueue(fresh, tried, deps, now)) === 'paused') return;
      continue;
    }
    if (backfilling && (await drainBackfill(progress, deps, now)) === 'paused') return;
    if ((await readQueue()).ids.some((id) => !tried.has(id))) continue;
    await browser.alarms.clear(BACKFILL_ALARM);
    return;
  }
}

async function drainQueue(ids: string[], tried: Set<string>, deps: ExtractDeps, now: () => number): Promise<Outcome> {
  for (const id of ids) {
    tried.add(id);
    await browser.alarms.create(BACKFILL_ALARM, { when: now() + WATCHDOG_MS });
    const before = await partsSaved(id);
    try {
      await extractMeeting(id, deps);
    } catch (error) {
      if (rateLimited(error)) {
        const progressed = (await partsSaved(id)) > before;
        const resumeAt = now() + (error.retryAfterMs ?? RATE_LIMIT_WAIT_MS);
        await changeQueue((q) => {
          const n = progressed ? 1 : (q.rateLimits[id] ?? 0) + 1;
          q.resumeAt = resumeAt;
          if (n < MAX_RATE_LIMITS) q.rateLimits[id] = n;
          else {
            drop(q, id);
            q.failed = [...new Set([...(q.failed ?? []), id])];
          }
        });
        await browser.alarms.create(BACKFILL_ALARM, { when: resumeAt });
        return 'paused';
      }
      // The AI connection needs fixing: keep the meeting queued for the next wake.
      const code = stopCode(error);
      if (code) {
        await changeQueue((q) => { q.stopped = code; });
        return 'stopped';
      }
      console.error('Rekord: could not extract memory', error);
      await changeQueue((q) => { q.failed = [...new Set([...(q.failed ?? []), id])]; });
    }
    await changeQueue((q) => { drop(q, id); delete q.stopped; });
  }
  return 'finished';
}

function drop(q: ExtractQueue, id: string) {
  q.ids = q.ids.filter((x) => x !== id);
  delete q.rateLimits[id];
}

async function drainBackfill(progress: BackfillProgress, deps: ExtractDeps, now: () => number): Promise<Outcome> {
  delete progress.resumeAt;
  for (const row of progress.meetings) {
    if (row.status === 'done' || row.status === 'failed') continue;
    if ((await getSettings()).memory.backfill !== 'running') return 'stopped';
    row.status = 'working';
    await save(progress);
    await browser.alarms.create(BACKFILL_ALARM, { when: now() + WATCHDOG_MS });
    const before = await partsSaved(row.id);
    try {
      const had = (await itemsForMeeting(row.id)).filter((i) => !i.leftOut).length;
      row.found = had || (await extractMeeting(row.id, deps)).found;
      row.status = 'done';
      delete row.rateLimits;
    } catch (error) {
      if (rateLimited(error)) {
        row.rateLimits = (await partsSaved(row.id)) > before ? 1 : (row.rateLimits ?? 0) + 1;
        row.status = row.rateLimits < MAX_RATE_LIMITS ? 'waiting' : 'failed';
        progress.resumeAt = now() + (error.retryAfterMs ?? RATE_LIMIT_WAIT_MS);
        await save(progress);
        await browser.alarms.create(BACKFILL_ALARM, { when: progress.resumeAt });
        return 'paused';
      }
      const code = stopCode(error);
      if (code) {
        row.status = 'waiting';
        progress.error = code;
        await save(progress);
        return 'stopped';
      }
      console.error('Rekord: could not extract memory', error);
      row.status = 'failed';
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
  await updateSettings({ memory: { ...(await getSettings()).memory, backfill: 'done' } });
  return 'finished';
}
