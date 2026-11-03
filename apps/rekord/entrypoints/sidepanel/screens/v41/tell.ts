// Catch up telling screens (V41Tell, V41TellType, V41Questions, V41Processing): pure view logic, no I/O.
import { CATCHUP_PROMPTS, cover, PROMPT_TEXT, talkingAbout } from '@/lib/catchup/coverage';
import { TELL_LIMIT_MS } from '@/lib/catchup/session';
import type { CatchupStatus } from '@/lib/catchup/pipeline';
import type { CatchupPrompt, PickedMeeting } from '@/lib/catchup/types';
import type { Meeting, Segment } from '@/lib/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Telling time as the frames show it: "06:15", "55:00", "1:02:03". */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export interface PromptRow { prompt: CatchupPrompt; text: string; state: 'covered' | 'now' | 'todo'; atMs?: number }

/** "Cover these": the prompt the newest line speaks to is "Now"; the others tick once a line covered them. */
export function promptRows(segments: readonly Segment[]): { rows: PromptRow[]; covered: number } {
  const now = talkingAbout(segments);
  const rows = cover(segments).map(({ prompt, coveredAtMs }): PromptRow => ({
    prompt,
    text: PROMPT_TEXT[prompt],
    state: prompt === now ? 'now' : coveredAtMs !== undefined ? 'covered' : 'todo',
    ...(coveredAtMs !== undefined && { atMs: coveredAtMs }),
  }));
  return { rows, covered: rows.filter((r) => r.state === 'covered').length };
}
export const PROMPT_COUNT = CATCHUP_PROMPTS.length;

/** Typed text as lines after the voice telling, so the prompts tick over both. */
export function typedLines(text: string, afterMs: number, meetingId = ''): Segment[] {
  return text.split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .map((line, i) => ({ id: `typed-${i}`, meetingId, speaker: 'you', startMs: afterMs + i + 1, endMs: afterMs + i + 1, text: line, chunkId: 'typed' }));
}

export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** A new telling needs a few sentences: too few words, and too short to still be turning into text. */
export const MIN_WORDS = 12;
export const MIN_VOICE_MS = 20_000;
export function tooSoon(words: number, voiceMs: number): boolean {
  return words < MIN_WORDS && voiceMs < MIN_VOICE_MS;
}

/** Back on the Catch up screen: while the microphone is telling (or paused), ask "Stop catching up?" first. */
export function backAction(telling: boolean): 'confirm' | 'leave' {
  return telling ? 'confirm' : 'leave';
}

/** "5 min left" from 55:00. */
export function minutesLeft(partMs: number): number {
  return Math.max(0, Math.ceil((TELL_LIMIT_MS - partMs) / 60_000));
}

/** A stop nobody clicked: at 60:00 the offscreen document stops by itself. */
export const atLimit = (partMs: number): boolean => partMs >= TELL_LIMIT_MS - 2_000;

/** Level meter bars: 3 to 22 px; quieter than speech is grey. */
export const SILENT = 0.04;
export const METER_BARS = 20;
export function bar(level: number): { h: number; on: boolean } {
  return { h: Math.round(3 + Math.min(1, Math.max(0, level) / 0.4) * 19), on: level >= SILENT };
}

/** The meeting a later telling or answer appends to (`append` ignores it; the type requires one). */
export function pickedOf(meeting: Pick<Meeting, 'title' | 'startedAt' | 'endedAt' | 'event'>): PickedMeeting {
  if (meeting.event) return { kind: 'event', event: meeting.event };
  const d = new Date(meeting.startedAt);
  return {
    kind: 'form',
    form: {
      name: meeting.title, date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, start: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      lengthMin: Math.max(0, Math.round(((meeting.endedAt ?? meeting.startedAt) - meeting.startedAt) / 60_000)), attendees: [],
    },
  };
}

/** What you answered: the typed text, or the voice answer's lines (from its `atMs` to the next part). */
export function answerText(meeting: Pick<Meeting, 'told'> | undefined, segments: readonly Segment[], questionId: string): string | undefined {
  const answer = meeting?.told?.answers?.findLast((a) => a.questionId === questionId);
  if (!answer || answer.skipped) return undefined;
  if (answer.text) return answer.text;
  if (answer.atMs === undefined) return undefined;
  let offset = 0;
  let end = Infinity;
  for (const p of meeting?.told?.parts ?? []) {
    offset += p.ms;
    if (offset > answer.atMs) { end = offset; break; }
  }
  const text = segments.filter((s) => !s.interim && s.startMs >= answer.atMs! && s.startMs < end).map((s) => s.text.trim()).join(' ').trim();
  return text || undefined;
}

export type CardState = 'active' | 'answered' | 'skipped' | 'open';
type Q = CatchupStatus['questions'][number];

/** The card the user is answering: one they reopened (Change, Answer), else the first still open. */
export function activeQuestion(questions: readonly Q[], reopened?: string): string | undefined {
  if (reopened && questions.some((q) => q.id === reopened)) return reopened;
  return questions.find((q) => q.state === 'open')?.id;
}

export function cardState(q: Q, active: string | undefined): CardState {
  if (q.id === active) return 'active';
  return q.state === 'answered' ? 'answered' : q.state === 'skipped' ? 'skipped' : 'open';
}

/** "3 of 3": the active question's number, or all of them once none is open. */
export function questionCount(questions: readonly Q[], active: string | undefined): string {
  const i = questions.findIndex((q) => q.id === active);
  return `${i >= 0 ? i + 1 : questions.length} of ${questions.length}`;
}

export type StepView = { key: 'text' | 'decisions' | 'promises' | 'summary'; label: string; state: 'done' | 'active' | 'todo'; note?: string };
const STEP_LABEL = { text: 'Your telling, as text', decisions: 'Decisions', promises: 'Promises, owners and due dates', summary: 'Summary' } as const;

/** V41Processing's four rows: done ones say what they found, the first not done spins. */
export function stepViews(status: CatchupStatus): StepView[] {
  const keys = ['text', 'decisions', 'promises', 'summary'] as const;
  let active = false;
  return keys.map((key) => {
    const step = status.steps.find((s) => s.step === key);
    const done = !!step?.done;
    const note = !done ? undefined : key === 'decisions' ? `${status.decisions} found` : key === 'promises' ? `${status.promises} found` : 'done';
    let state: StepView['state'] = 'done';
    if (!done) { state = active ? 'todo' : 'active'; active = true; }
    return { key, label: STEP_LABEL[key], state, ...(note && { note }) };
  });
}

/** When the meeting page opens by itself: the summary is there and memory finished, failed, or took too long. */
export function processingDone(status: CatchupStatus, summaryDoneFor: number, waitMs = 90_000): boolean {
  const step = (k: string) => status.steps.find((s) => s.step === k);
  if (!step('summary')?.done) return false;
  const memory = ['decisions', 'promises'].map(step);
  if (memory.some((s) => s?.failed === 'limit')) return false;
  return memory.every((s) => s?.done || s?.failed) || summaryDoneFor >= waitMs;
}

/** "Nothing to remember yet": memory finished (not failed) and kept nothing from the telling. */
export function nothingFound(status: CatchupStatus): boolean {
  const memory = ['decisions', 'promises'].map((k) => status.steps.find((s) => s.step === k));
  return memory.every((s) => s?.done && !s.failed) && status.found === 0;
}

/** "12:40 of your telling and 2 answers, for “Q4 planning with Northwind”." */
export function tellingLine(meeting: Pick<Meeting, 'title' | 'told'>): string {
  const answers = (meeting.told?.answers ?? []).filter((a) => !a.skipped).length;
  const and = answers === 0 ? '' : ` and ${answers} ${answers === 1 ? 'answer' : 'answers'}`;
  return `${mmss(meeting.told?.ms ?? 0)} of your telling${and}, for “${meeting.title}”. This usually takes under a minute.`;
}

/** "Mon 2 Nov". */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
}
