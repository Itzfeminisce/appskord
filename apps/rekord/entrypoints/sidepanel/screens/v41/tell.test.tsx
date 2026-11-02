// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatchupStatus } from '@/lib/catchup/pipeline';
import { addCatchupPart, beginCatchup, closeDB, getDB, getMeeting, listSegments, putSegment } from '@/lib/db';
import { seedSample, V41_CATCHUP, V41_EVENT, V41_QUESTIONS, V41_SEGMENTS, V41_TOLD_AT } from '@/lib/memory/sample';
import { EVENTS_KEY } from '@/lib/reminders';
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
  it('processing: an empty poll between the extracted marker and the items does not show the empty state', async () => {
    await open('V41Tell');
    delete processingDev.status;
    const full = (found: number): CatchupStatus => ({
      steps: (['text', 'questions', 'decisions', 'promises', 'summary'] as const).map((step) => ({ step, done: true })),
      decisions: found, promises: 0, found, questions: [],
    });
    const replies = [full(0), full(2)];
    vi.spyOn(browser.runtime, 'sendMessage').mockImplementation((async () => replies.shift() ?? full(2)) as never);
    const view = await mount(sidepanel, 'catchupProcessing', `/catchupProcessing?meeting=${V41_CATCHUP.id}`);
    await waitFor(() => view.router.route.screen === 'summary', 6000);
    expect(view.host.textContent).not.toContain('Nothing to remember yet');
  });

  it('processing: two empty polls in a row show the empty state without the opens-by-itself line or the read link', async () => {
    await open('V41Tell');
    delete processingDev.status;
    const empty: CatchupStatus = {
      steps: (['text', 'questions', 'decisions', 'promises', 'summary'] as const).map((step) => ({ step, done: true })),
      decisions: 0, promises: 0, found: 0, questions: [],
    };
    vi.spyOn(browser.runtime, 'sendMessage').mockImplementation((async () => empty) as never);
    const view = await mount(sidepanel, 'catchupProcessing', `/catchupProcessing?meeting=${V41_CATCHUP.id}`);
    await waitFor(() => view.host.textContent?.includes('Nothing to remember yet'), 6000);
    expect(view.host.textContent).not.toContain('opens by itself');
    expect(view.host.textContent).not.toContain('Read your telling meanwhile');
  });

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

  it('a question answered again shows the latest answer', () => {
    const told = { ...V41_CATCHUP.told!, answers: [{ questionId: 'q1', text: 'By Friday.' }, { questionId: 'q1', text: 'By Monday.' }] };
    expect(answerText({ told }, V41_SEGMENTS, 'q1')).toBe('By Monday.');
  });
});

describe('processing', () => {
  const status = (done: Record<string, boolean>, extra: Partial<CatchupStatus> = {}): CatchupStatus => ({
    steps: (['text', 'questions', 'decisions', 'promises', 'summary'] as const).map((step) => ({ step, done: !!done[step] })),
    decisions: 1, promises: 2, found: 3, questions: [], ...extra,
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

  it('Stop with typed text sends it with the stop, in one call, so the questions read it too', async () => {
    tellDev.typed = 'Priya will book the venue.';
    await browser.storage.local.set({ [EVENTS_KEY]: { savedAt: V41_TOLD_AT, events: [], past: { [V41_EVENT.id]: V41_EVENT } } });
    vi.mocked(browser.runtime.sendMessage).mockImplementation((async (m: { type: string }) => (m.type === 'recording/stop' ? { ok: true } : undefined)) as never);
    const view = await open('V41Tell');
    await waitFor(() => view.host.textContent?.includes('Q4 planning with Northwind'));
    click(button(view.host, 'Stop'));
    await waitFor(() => view.router.route.screen === 'catchupQuestions');
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'recording/stop', typed: { catchup: { meetingId: V41_CATCHUP.id, picked: expect.anything(), append: true }, text: 'Priya will book the venue.' },
    });
    expect(vi.mocked(browser.runtime.sendMessage).mock.calls.some(([m]) => (m as unknown as { type: string }).type === 'catchup/typed')).toBe(false);
  });

  it('Discard after Add more leaves the meeting exactly as it was', async () => {
    const f = DEV_FRAMES.V41Tell!;
    world.now = () => f.now!;
    await f.setup!();
    const was = await getMeeting(V41_CATCHUP.id);
    const segs = await listSegments(V41_CATCHUP.id);
    const start = { meetingId: V41_CATCHUP.id, picked: pickedOf(was!)!, append: true };
    const view = await mount(sidepanel, 'catchupTell', `/catchupTell?meeting=${V41_CATCHUP.id}`);
    await waitFor(() => view.host.textContent?.includes('Q4 planning with Northwind'));
    await settle();
    // What the worker saved of the new telling: a paused part and its words.
    await beginCatchup(start, 'en', f.now!);
    await addCatchupPart(V41_CATCHUP.id, { at: f.now!, ms: 30_000, kind: 'voice' });
    await putSegment({ ...line(was!.told!.ms + 1_000, 'Thrown away.'), meetingId: V41_CATCHUP.id });
    click(view.host.querySelector('[aria-label="Back"]'));
    click(button(await waitFor(() => view.host.querySelector('[role="dialog"]') ?? false), 'Discard'));
    await waitFor(() => view.router.route.screen !== 'catchupTell');
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'recording/stop', discard: true });
    expect(await getMeeting(V41_CATCHUP.id)).toEqual(was);
    expect(await listSegments(V41_CATCHUP.id)).toEqual(segs);
  });

  it('Skip during a voice answer keeps none of it', async () => {
    const view = await open('V41Questions');
    const was = await getMeeting(V41_CATCHUP.id);
    const segs = await listSegments(V41_CATCHUP.id);
    vi.mocked(browser.runtime.sendMessage).mockImplementation((async (m: { type: string; catchup?: Parameters<typeof beginCatchup>[0] }) => {
      if (m.type !== 'recording/start') return undefined;
      await beginCatchup(m.catchup!, 'en', V41_CATCHUP.told!.at);
      await addCatchupPart(V41_CATCHUP.id, { at: V41_CATCHUP.told!.at, ms: 20_000, kind: 'voice' });
      await putSegment({ ...line(was!.told!.ms + 1_000, 'Half an answer.'), meetingId: V41_CATCHUP.id });
      return { ok: true, meetingId: V41_CATCHUP.id };
    }) as never);
    vi.spyOn(browser.runtime, 'connect').mockReturnValue({ disconnect: () => undefined } as never);
    const card = await waitFor(() => view.host.querySelector('[aria-label="Question 3"]') ?? false);
    click(card.querySelector('[aria-label="Answer by voice"]'));
    await waitFor(() => view.host.querySelector('[aria-label="Stop answering by voice"]') ?? false);
    click(button(view.host.querySelector('[aria-label="Question 3"]')!, 'Skip'));
    await waitFor(() => vi.mocked(browser.runtime.sendMessage).mock.calls.some(([m]) => (m as unknown as { type: string }).type === 'catchup/skip'));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'recording/stop', discard: true });
    expect(await getMeeting(V41_CATCHUP.id)).toEqual(was);
    expect(await listSegments(V41_CATCHUP.id)).toEqual(segs);
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
