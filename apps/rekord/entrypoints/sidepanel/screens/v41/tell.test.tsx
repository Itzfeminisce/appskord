// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatchupStatus } from '@/lib/catchup/pipeline';
import { closeDB, getDB, getMeeting } from '@/lib/db';
import { seedSample, V41_CATCHUP, V41_QUESTIONS, V41_SEGMENTS } from '@/lib/memory/sample';
import type { Segment } from '@/lib/types';
import { mount, settle, waitFor } from '../../../../test/mountRouter';
import { sidepanel } from '../../App';
import { world } from '../../components/v4/world';
import { DEV_FRAMES } from '../../dev/frames';
import { processingDev } from './CatchupProcessing';
import { followUpsDev } from './FollowUps';
import { tellDev } from './Tell';
import {
  activeQuestion, answerText, backAction, cardState, minutesLeft, mmss, pickedOf, processingDone, promptRows, questionCount, stepViews,
  tellingLine, tooSoon, typedLines,
} from './tell';

const line = (startMs: number, text: string): Segment => ({ id: `s${startMs}`, meetingId: 'm', speaker: 'you', startMs, endMs: startMs + 1000, text, chunkId: 'c' });
const qs = (states: ('open' | 'answered' | 'skipped')[]) => V41_QUESTIONS.map((q, i) => ({ ...q, state: states[i]! }));
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text)!;

describe('prompt ticks', () => {
  it('ticks each prompt at the first line that covers it; the newest line\'s prompt is "Now" and not counted', () => {
    const { rows, covered } = promptRows(V41_SEGMENTS.filter((s) => s.startMs <= 6 * 60_000 + 15_000));
    expect(rows.map((r) => [r.text, r.state, r.atMs === undefined ? '' : mmss(r.atMs)])).toEqual([
      ['Who was there', 'covered', '00:40'],
      ['What was decided', 'covered', '03:05'],
      ['Who promised what, and by when', 'now', '05:48'],
      ['What is still open', 'todo', ''],
    ]);
    expect(covered).toBe(2);
  });

  it('nothing said: nothing ticked', () => {
    expect(promptRows([]).covered).toBe(0);
    expect(promptRows([]).rows.every((r) => r.state === 'todo')).toBe(true);
  });

  it('typed text ticks the same prompts, line by line, after what was said', () => {
    const typed = typedLines('Sarah and Tom were there.\n\nWe agreed on the pilot.', 5_000);
    expect(typed.map((s) => s.startMs)).toEqual([5_001, 5_002]);
    const { rows, covered } = promptRows([line(1_000, 'Then we went through the timeline.'), ...typed]);
    expect(rows.map((r) => r.state)).toEqual(['covered', 'now', 'todo', 'todo']);
    expect(covered).toBe(1);
  });
});

describe('telling rules', () => {
  it('back while talking asks first; otherwise it leaves', () => {
    expect(backAction(true)).toBe('confirm');
    expect(backAction(false)).toBe('leave');
  });

  it('stopping with too little said asks for more, unless the audio may still be turning into text', () => {
    expect(tooSoon(4, 5_000)).toBe(true);
    expect(tooSoon(30, 5_000)).toBe(false);
    expect(tooSoon(4, 60_000)).toBe(false);
  });

  it('counts minutes left from 55:00', () => {
    expect(minutesLeft(55 * 60_000)).toBe(5);
    expect(minutesLeft(59 * 60_000 + 30_000)).toBe(1);
    expect(mmss(55 * 60_000)).toBe('55:00');
  });

  it('a later telling appends to the same meeting it came from', () => {
    expect(pickedOf(V41_CATCHUP)).toEqual({ kind: 'event', event: V41_CATCHUP.event });
    const form = pickedOf({ title: 'Lunch with Dana', startedAt: new Date(2026, 9, 30, 12, 30).getTime(), endedAt: new Date(2026, 9, 30, 13, 30).getTime() });
    expect(form).toEqual({ kind: 'form', form: { name: 'Lunch with Dana', date: '2026-10-30', start: '12:30', lengthMin: 60, attendees: [] } });
  });
});

describe('questions: skip and change', () => {
  it('the first open question is active until one is reopened', () => {
    const list = qs(['answered', 'skipped', 'open']);
    expect(activeQuestion(list)).toBe('q3');
    expect(list.map((q) => cardState(q, 'q3'))).toEqual(['answered', 'skipped', 'active']);
    expect(questionCount(list, 'q3')).toBe('3 of 3');
    // Change reopens an answered card; Answer reopens a skipped one.
    expect(activeQuestion(list, 'q1')).toBe('q1');
    expect(list.map((q) => cardState(q, 'q1'))).toEqual(['active', 'skipped', 'open']);
    expect(questionCount(list, 'q1')).toBe('1 of 3');
  });

  it('none open: every card shows its outcome and the count is complete', () => {
    const list = qs(['answered', 'skipped', 'skipped']);
    expect(activeQuestion(list)).toBeUndefined();
    expect(questionCount(list, undefined)).toBe('3 of 3');
  });

  it('a typed answer is its text; a voice answer is what was said from its time to the next part', () => {
    expect(answerText(V41_CATCHUP, V41_SEGMENTS, 'q1')).toBe('By Friday.');
    expect(answerText(V41_CATCHUP, V41_SEGMENTS, 'q2')).toBeUndefined();
    const at = V41_CATCHUP.told!.parts[0]!.ms;
    const voice = { told: { ...V41_CATCHUP.told!, answers: [{ questionId: 'q1', atMs: at }] } };
    expect(answerText(voice, [...V41_SEGMENTS, line(at + 99_000, 'Not this.')], 'q1')).toBe('By Friday.');
  });
});

describe('processing', () => {
  const status = (done: Record<string, boolean>, extra: Partial<CatchupStatus> = {}): CatchupStatus => ({
    steps: (['text', 'questions', 'decisions', 'promises', 'summary'] as const).map((step) => ({ step, done: !!done[step] })),
    decisions: 1, promises: 2, questions: [], ...extra,
  });

  it('done steps say what they found; the first one not done spins', () => {
    expect(stepViews(status({ text: true, decisions: true })).map((s) => [s.label, s.state, s.note ?? ''])).toEqual([
      ['Your telling, as text', 'done', 'done'],
      ['Decisions', 'done', '1 found'],
      ['Promises, owners and due dates', 'active', ''],
      ['Summary', 'todo', ''],
    ]);
  });

  it('opens the meeting once the summary and memory are done, and waits through an AI limit', () => {
    expect(processingDone(status({ text: true, summary: true }), 0)).toBe(false);
    expect(processingDone(status({ text: true, summary: true, decisions: true, promises: true }), 0)).toBe(true);
    expect(processingDone(status({ text: true, summary: true }), 120_000)).toBe(true);
    const limited = status({ text: true, summary: true });
    limited.steps[2] = { step: 'decisions', done: false, failed: 'limit', resumesAt: 1 };
    expect(processingDone(limited, 120_000)).toBe(false);
  });

  it('says how much was told and answered', () => {
    expect(tellingLine(V41_CATCHUP)).toBe('12:40 of your telling and 2 answers, for “Q4 planning with Northwind”. This usually takes under a minute.');
  });
});

describe('telling screens', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB(), 'before');
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dev of [tellDev, followUpsDev, processingDev]) for (const k of Object.keys(dev)) delete (dev as Record<string, unknown>)[k];
  });

  async function open(frame: string) {
    const f = DEV_FRAMES[frame]!;
    world.now = () => f.now!;
    await f.setup!();
    return mount(sidepanel, f.screen, `/${f.screen}?${new URLSearchParams(Object.entries(f.params ?? {}).map(([k, v]) => [k === 'eventId' ? 'event' : k === 'meetingId' ? 'meeting' : k, String(v)]))}`);
  }

  it('back while talking asks "Stop catching up?"; Keep talking stays, Stop and save goes on to the questions', async () => {
    const view = await open('V41Tell');
    await waitFor(() => view.host.textContent?.includes('Q4 planning with Northwind'));
    click(view.host.querySelector('[aria-label="Back"]'));
    const dialog = await waitFor(() => view.host.querySelector('[role="dialog"]') ?? false);
    expect(dialog.textContent).toContain('What you said so far is kept. You can add more later.');
    click(button(dialog, 'Keep talking'));
    expect(view.host.querySelector('[role="dialog"]')).toBeNull();
    click(view.host.querySelector('[aria-label="Back"]'));
    click(button(await waitFor(() => view.host.querySelector('[role="dialog"]') ?? false), 'Stop and save'));
    await waitFor(() => view.router.route.screen === 'catchupQuestions');
    expect(view.router.route.params.meetingId).toBe(V41_CATCHUP.id);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'recording/stop' });
  });

  it('Discard while talking stops and deletes the new catch-up', async () => {
    const view = await open('V41Tell');
    await waitFor(() => view.host.textContent?.includes('Q4 planning with Northwind'));
    click(view.host.querySelector('[aria-label="Back"]'));
    click(button(await waitFor(() => view.host.querySelector('[role="dialog"]') ?? false), 'Discard'));
    await waitFor(() => view.router.route.screen === 'home');
    expect(await getMeeting(V41_CATCHUP.id)).toBeUndefined();
  });

  it('Change reopens an answer with Cancel; Skip sends the skip', async () => {
    const view = await open('V41Questions');
    const first = await waitFor(() => view.host.querySelector('[aria-label="Question 1"]') ?? false);
    await waitFor(() => first.textContent?.includes('You said “By Friday.”'));
    click(button(first, 'Change'));
    const reopened = view.host.querySelector('[aria-label="Question 1"]')!;
    expect((reopened.querySelector('input') as HTMLInputElement).value).toBe('By Friday.');
    expect(reopened.textContent).toContain('Your answer was “By Friday.”');
    expect(view.host.querySelector('.ct-q-count')?.textContent).toBe('1 of 3');
    click(button(reopened, 'Cancel'));
    expect(view.host.querySelector('[aria-label="Question 1"]')?.textContent).toContain('You said “By Friday.”');
    click(button(view.host.querySelector('[aria-label="Question 3"]')!, 'Skip'));
    await settle();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'catchup/skip', meetingId: V41_CATCHUP.id, questionId: 'q3' });
  });
});
