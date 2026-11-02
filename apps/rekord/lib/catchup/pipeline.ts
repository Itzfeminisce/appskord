// After a telling: the one follow-up questions call, then the v3/v4 summary and extraction (CONTRACT "Where a catch-up differs").
import { deleteChunk, deleteSegment, deleteTellingAudioFrom, getMeeting, listSegments, pendingChunks, putMeeting } from '../db';
import { record } from '../ledger';
import { chat, LLMError, type FetchLike } from '../llm';
import { readQueue } from '../memory/backfill';
import { draftExtraction, extractAgain, isExtracted, LEDGER_SERVICE, NOT_SENT, type ExtractDeps } from '../memory/extract';
import { isoDay } from '../memory/rank';
import { itemsForMeeting } from '../memory/store';
import { getSettings } from '../settings';
import { summarize, SummarizeError } from '../summarize';
import type { CatchupStart, Meeting } from '../types';
import { isCatchup } from './label';
import { buildQuestionsPrompt, parseQuestions, QUESTIONS_REPLY_TOKENS, QUESTIONS_SYSTEM } from './questions';
import { addPart } from './session';
import type { CatchupProgress, CatchupQuestion } from './types';

export const QUESTIONS_LEDGER_WHAT = 'Telling text for follow-up questions';
/** How long the questions step waits for the last of the telling to become text. */
export const TEXT_WAIT_MS = 120_000;
const TEXT_POLL_MS = 1_000;
/** A 'waiting' older than this was left by a stopped worker: it reads as failed so the page can offer "Try again". */
export const STALE_MS = TEXT_WAIT_MS + 3 * 60_000;

export interface QuestionsState {
  status: 'waiting' | 'ready' | 'failed';
  questions: CatchupQuestion[];
  /** When 'waiting' began: a worker stopped mid-step leaves it behind, so an old one runs again. */
  since?: number;
  failed?: CatchupProgress['failed'];
  resumesAt?: number;
  error?: string;
}

export const questionsKey = (meetingId: string) => `catchup.questions.${meetingId}`;
export const failedKey = (meetingId: string) => `catchup.failed.${meetingId}`;
/** Set when the telling grew after its summary: the summary step shows as not done until "Finish" runs again. */
export const summaryStaleKey = (meetingId: string) => `catchup.summaryStale.${meetingId}`;

export interface PipelineDeps extends ExtractDeps {
  wait?: (ms: number) => Promise<void>;
}

/** The follow-up questions of a catch-up (V41Questions), undefined before the questions step starts. */
export async function readQuestions(meetingId: string, now: () => number = Date.now): Promise<QuestionsState | undefined> {
  const kept = await keptQuestions(meetingId);
  if (kept?.status === 'waiting' && !inFlight.has(meetingId) && isStale(kept, now)) {
    return { status: 'failed', questions: [], failed: 'ai', error: 'The questions step stopped. Try again.' };
  }
  return kept;
}

const keptQuestions = async (meetingId: string) =>
  (await browser.storage.local.get(questionsKey(meetingId)))[questionsKey(meetingId)] as QuestionsState | undefined;
const isStale = (state: QuestionsState, now: () => number) => now() - (state.since ?? 0) >= STALE_MS;
const inFlight = new Map<string, Promise<QuestionsState>>();

const saveQuestions = (meetingId: string, state: QuestionsState) => browser.storage.local.set({ [questionsKey(meetingId)]: state });

/** Waits until no chunk of the telling is still waiting for transcription; false when it took too long. */
async function textReady(meetingId: string, wait: (ms: number) => Promise<void>, now: () => number): Promise<boolean> {
  const until = now() + TEXT_WAIT_MS;
  while ((await pendingChunks(meetingId)).length > 0) {
    if (now() >= until) return false;
    await wait(TEXT_POLL_MS);
  }
  return true;
}

const failure = (error: unknown): Pick<QuestionsState, 'failed' | 'resumesAt' | 'error'> => {
  if (error instanceof LLMError && error.code === 'rate-limited') return { failed: 'limit', resumesAt: Date.now() + (error.retryAfterMs ?? 60_000), error: error.message };
  return { failed: 'ai', error: error instanceof Error ? error.message : 'Something went wrong. Try again.' };
};

/**
 * After a telling stops (not after a voice answer): its draft is read with the v4 extraction calls, then one AI call
 * asks about its gaps (T1 core). Kept in storage for V41Questions; a second call returns what is kept. Never throws.
 */
export async function askQuestions(meetingId: string, deps: PipelineDeps = {}): Promise<QuestionsState> {
  let run = inFlight.get(meetingId);
  if (!run) {
    run = askOnceKept(meetingId, deps).finally(() => inFlight.delete(meetingId));
    inFlight.set(meetingId, run);
  }
  return run;
}

async function askOnceKept(meetingId: string, deps: PipelineDeps): Promise<QuestionsState> {
  const now = deps.now ?? Date.now;
  const kept = await keptQuestions(meetingId);
  if (kept?.status === 'ready' || (kept?.status === 'waiting' && !isStale(kept, now))) return kept;
  const meeting = await getMeeting(meetingId);
  if (!isCatchup(meeting) || !meeting) return { status: 'ready', questions: [] };
  await saveQuestions(meetingId, { status: 'waiting', questions: [], since: now() });
  let state: QuestionsState;
  try {
    if (!(await textReady(meetingId, deps.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms))), now))) {
      state = { status: 'failed', questions: [], failed: 'transcribe' };
    } else {
      const draft = await draftExtraction(meetingId, deps);
      const attendees = (meeting.event?.attendees ?? []).filter((a) => !a.self).map((a) => a.name?.trim() || a.email).filter(Boolean);
      const prompt = buildQuestionsPrompt({ title: meeting.title, date: isoDay(meeting.startedAt), items: draft, attendees });
      state = { status: 'ready', questions: prompt ? parseQuestions(await askOnce(meetingId, prompt, deps.fetchFn)) : [] };
    }
  } catch (error) {
    console.error('Rekord: could not ask the follow-up questions', error);
    state = { status: 'failed', questions: [], ...failure(error) };
  }
  await saveQuestions(meetingId, state);
  return state;
}

/** The one follow-up questions call, with its one ledger entry when the text left the browser. */
async function askOnce(meetingId: string, prompt: string, fetchFn?: FetchLike): Promise<string> {
  const service = LEDGER_SERVICE[(await getSettings()).summary.provider];
  let sent = true;
  try {
    return await chat([{ role: 'system', content: QUESTIONS_SYSTEM }, { role: 'user', content: prompt }], { json: true, maxTokens: QUESTIONS_REPLY_TOKENS }, fetchFn);
  } catch (error) {
    sent = !(error instanceof LLMError && NOT_SENT.has(error.code));
    throw error;
  } finally {
    if (service && sent) await record({ meetingId, service, what: QUESTIONS_LEDGER_WHAT });
  }
}

/**
 * A telling stopped (voice or typed). A part added after processing re-runs summary and extraction on "Finish".
 * Questions are asked after a telling, never after a voice answer; with no start (a worker restart lost it) they are
 * asked only if they never were, since the lost start may have been an answer.
 */
export async function afterTelling(meetingId: string, start: CatchupStart | null, deps: PipelineDeps = {}): Promise<void> {
  await reopenCatchup(meetingId);
  if (start?.questionId) return;
  if (!start && (await keptQuestions(meetingId))) return;
  await askQuestions(meetingId, deps);
}

/** "Add more" on a processed catch-up: clears the extraction marker and marks the summary out of date. */
export async function reopenCatchup(meetingId: string): Promise<void> {
  const meeting = await getMeeting(meetingId);
  if (!isCatchup(meeting)) return;
  if (await isExtracted(meetingId)) await extractAgain(meetingId);
  if (meeting?.summary) await browser.storage.local.set({ [summaryStaleKey(meetingId)]: true });
}

/** The telling as it stood before a part that is being thrown away: its length, part count and status. */
export type ToldBefore = { ms: number; parts: number; status: Meeting['status'] };

/** "Discard" (or a skipped voice answer): the meeting goes back to the telling it had before. Stop with `discard` first. */
export async function trimTelling(meetingId: string, before: ToldBefore): Promise<void> {
  for (const c of await pendingChunks(meetingId)) if (c.startMs >= before.ms) await deleteChunk(c.id);
  await deleteTellingAudioFrom(meetingId, before.parts);
  for (const s of await listSegments(meetingId)) if (s.startMs >= before.ms) await deleteSegment(s.id);
  const m = await getMeeting(meetingId);
  if (m?.told) await putMeeting({ ...m, status: before.status, told: { ...m.told, ms: before.ms, parts: m.told.parts.slice(0, before.parts) } });
}

/** "Skip": the question stays open. A voice or typed answer is saved by the telling itself (`questionId`). */
export async function skipQuestion(meetingId: string, questionId: string): Promise<void> {
  const meeting = await getMeeting(meetingId);
  if (!meeting?.told) return;
  await putMeeting({ ...meeting, told: addPart(meeting.told, null, { questionId, skipped: true }) });
}

/**
 * "Finish": the v3 summary (with the catch-up preamble), which queues the v4 extraction in the background; items
 * reach the v4 review card as suggested. Throws SummarizeError, also kept for the progress.
 */
export async function finishCatchup(meetingId: string, deps: { fetchFn?: FetchLike } = {}): Promise<Meeting> {
  await browser.storage.local.remove(failedKey(meetingId));
  try {
    const meeting = await summarize(meetingId, deps.fetchFn);
    await browser.storage.local.remove(summaryStaleKey(meetingId));
    return meeting;
  } catch (error) {
    await browser.storage.local.set({ [failedKey(meetingId)]: error instanceof SummarizeError ? error.message : 'Something went wrong.' });
    throw error;
  }
}

export type QuestionState = CatchupQuestion & { state: 'open' | 'answered' | 'skipped' };
/** found: every memory item kept from the catch-up (promises, decisions, questions); people are not counted. */
export interface CatchupStatus { steps: CatchupProgress[]; decisions: number; promises: number; found: number; questions: QuestionState[] }

/** V41Processing: each step's state, read from what is saved, so any page (or a reopened panel) can show it. */
export async function catchupProgress(meetingId: string, now: () => number = Date.now): Promise<CatchupStatus> {
  const [meeting, pending, questions, extracted, items, queue, failedSummary, stale] = await Promise.all([
    getMeeting(meetingId), pendingChunks(meetingId), readQuestions(meetingId, now), isExtracted(meetingId), itemsForMeeting(meetingId), readQueue(),
    browser.storage.local.get(failedKey(meetingId)).then((r) => r[failedKey(meetingId)] as string | undefined),
    browser.storage.local.get(summaryStaleKey(meetingId)).then((r) => !!r[summaryStaleKey(meetingId)]),
  ]);
  const answers = new Map((meeting?.told?.answers ?? []).map((a) => [a.questionId, a]));
  const limited = extracted ? {} : queue.resumeAt && queue.ids.includes(meetingId) ? { failed: 'limit' as const, resumesAt: queue.resumeAt } : queue.failed?.includes(meetingId) ? { failed: 'ai' as const } : {};
  const kept = items.filter((i) => !i.leftOut);
  return {
    steps: [
      { step: 'text', done: pending.length === 0, ...(questions?.failed === 'transcribe' && { failed: 'transcribe' as const }) },
      { step: 'questions', done: questions?.status === 'ready', ...(questions?.failed && questions.failed !== 'transcribe' && { failed: questions.failed, ...(questions.resumesAt && { resumesAt: questions.resumesAt }) }) },
      { step: 'decisions', done: extracted, ...limited },
      { step: 'promises', done: extracted, ...limited },
      { step: 'summary', done: !!meeting?.summary && !stale, ...(failedSummary && { failed: 'ai' as const }) },
    ],
    decisions: kept.filter((i) => i.kind === 'decision').length,
    promises: kept.filter((i) => i.kind === 'promise').length,
    found: kept.length,
    questions: (questions?.questions ?? []).map((q) => {
      const a = answers.get(q.id);
      return { ...q, state: !a ? 'open' : a.skipped ? 'skipped' : 'answered' };
    }),
  };
}
