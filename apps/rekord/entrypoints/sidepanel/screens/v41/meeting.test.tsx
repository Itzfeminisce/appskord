// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, getDB, getMeeting, listSegments, listTellingAudio } from '@/lib/db';
import { itemsForMeeting } from '@/lib/memory/store';
import { seedSample, V41_CATCHUP, V41_ITEMS, V41_SEGMENTS, V41_QUESTIONS } from '@/lib/memory/sample';
import { mount, waitFor } from '../../../../test/mountRouter';
import { sidepanel } from '../../App';
import { quoteMeta as reviewQuoteMeta } from '../../components/v4/review';
import { world } from '../../components/v4/world';
import { DEV_FRAMES } from '../../dev/frames';
import { summaryView } from '../Summary';
import { answerCaption, meetingLine, quoteCaption, type Meetings } from '../v4/loops';
import { quoteMeta as peopleQuoteMeta } from '../v4/peopleView';

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const text = (root: Element) => root.textContent ?? '';
const tellQuote = V41_ITEMS[1]!.quote;
const recorded = { id: 'm-rec', title: 'Pricing review', startedAt: new Date(2026, 9, 26, 10, 0).getTime() };
const told: Meetings = new Map([[V41_CATCHUP.id, V41_CATCHUP], [recorded.id, recorded]]);

describe('catch-up labels on each surface', () => {
  const CAUGHT = 'Q4 planning with Northwind · 2 Nov · From your catch-up';
  it('Open loops rows, the promise sheet, the brief and Nudge use "From your catch-up"; a recorded meeting keeps its clock', () => {
    expect(meetingLine(V41_CATCHUP.id, told)).toBe(CAUGHT);
    expect(quoteCaption(tellQuote, told)).toBe(`Alex · ${CAUGHT}`);
    expect(meetingLine(recorded.id, told)).toBe('Pricing review · 26 Oct');
    expect(quoteCaption({ speaker: 'Alex', text: 'x', meetingId: recorded.id, atMs: 33 * 60_000 + 40_000 }, told)).toBe('Alex · Pricing review · 26 Oct · 33:40');
  });
  it('captions an answer with the question it answered', () => {
    expect(answerCaption(V41_ITEMS[2]!.history[0]!, V41_QUESTIONS[0]!.text, told))
      .toBe(`Alex, answering “Tom is setting up admin access for the pilot. By when?” · ${CAUGHT}`);
  });
  it('the review card and the person page say the same', () => {
    expect(reviewQuoteMeta(tellQuote, V41_CATCHUP)).toBe(CAUGHT);
    expect(peopleQuoteMeta(tellQuote, V41_CATCHUP)).toBe(`Alex · ${CAUGHT}`);
    expect(peopleQuoteMeta({ ...tellQuote, atMs: 94_000 }, { ...V41_CATCHUP, source: undefined })).toBe('Alex · Q4 planning with Northwind · 2 Nov · 01:34');
  });
});

describe('the catch-up meeting page', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB(), 'before');
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);
    summaryView.undoMs = 30;
  });
  afterEach(() => { vi.restoreAllMocks(); summaryView.undoMs = 8000; summaryView.menuOpen = false; });

  async function open(frame: string) {
    const f = DEV_FRAMES[frame]!;
    world.now = () => f.now!;
    await f.setup!();
    return mount(sidepanel, f.screen, `/${f.screen}?meeting=${V41_CATCHUP.id}`);
  }

  it('shows the tag, the meeting\'s date and length, the telling and the summary label', async () => {
    const view = await open('V41Meeting');
    await waitFor(() => text(view.host).includes('Told 2 Nov, 17:10 · 12:40'));
    const page = text(view.host);
    for (const s of ['Q4 planning with Northwind', 'Catch up', 'Mon 2 Nov · 13:00 · 4 h', 'Your telling', 'Add more', 'Summary · from your catch-up', 'Review 5 things', 'Says it comes from your catch-up']) expect(page).toContain(s);
    expect(view.host.querySelector('[aria-label="Play your telling"]')).not.toBeNull();
  });

  it('"Add more" opens the telling screen in adding mode', async () => {
    const view = await open('V41Meeting');
    click(await waitFor(() => [...view.host.querySelectorAll('button')].find((b) => b.textContent === 'Add more') ?? false));
    await waitFor(() => view.router.route.screen === 'catchupTell');
    expect(view.router.route.params.meetingId).toBe(V41_CATCHUP.id);
  });

  it('More lists Share, Delete audio of your telling and Delete this catch-up', async () => {
    const view = await open('V41MeetingMore');
    const menu = await waitFor(() => view.host.querySelector('[role="menu"]') ?? false);
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Share', 'Delete audio of your telling', 'Delete this catch-up']);
    expect(view.host.querySelector('[aria-haspopup="menu"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('deleting the audio keeps the text, the items and the told line; Undo keeps the audio', async () => {
    const view = await open('V41MeetingMore');
    expect(await listTellingAudio(V41_CATCHUP.id)).toHaveLength(1);
    const menu = await waitFor(() => view.host.querySelector('[role="menu"]') ?? false);
    click([...menu.querySelectorAll('button')].find((b) => b.textContent === 'Delete audio of your telling'));
    const toast = await waitFor(() => view.host.querySelector('[role="status"]') ?? false);
    expect(toast.textContent).toContain('Audio of your telling deleted. The notes stay.');
    await waitFor(async () => (await getMeeting(V41_CATCHUP.id))?.told?.audioDeleted === true);
    expect(await listTellingAudio(V41_CATCHUP.id)).toHaveLength(0);
    expect((await listSegments(V41_CATCHUP.id)).map((s) => s.text)).toEqual(V41_SEGMENTS.map((s) => s.text));
    expect((await itemsForMeeting(V41_CATCHUP.id)).length).toBe(V41_ITEMS.length);
    expect(text(view.host)).toContain('Told 2 Nov, 17:10 · 12:40');
    expect(view.host.querySelector('[aria-label="Play your telling"]')).toBeNull();
  });

  it('Undo within the wait keeps the audio', async () => {
    summaryView.undoMs = 60_000;
    const view = await open('V41MeetingMore');
    const menu = await waitFor(() => view.host.querySelector('[role="menu"]') ?? false);
    click([...menu.querySelectorAll('button')].find((b) => b.textContent === 'Delete audio of your telling'));
    const toast = await waitFor(() => view.host.querySelector('[role="status"]') ?? false);
    click([...toast.querySelectorAll('button')].find((b) => b.textContent === 'Undo'));
    expect(view.host.querySelector('[role="status"]')).toBeNull();
    expect(await listTellingAudio(V41_CATCHUP.id)).toHaveLength(1);
  });

  it('hides "Delete audio of your telling" once the audio is gone, keeping the segments and the told line', async () => {
    const view = await open('V41MeetingMore');
    click([...(await waitFor(() => view.host.querySelector('[role="menu"]') ?? false)).querySelectorAll('button')].find((b) => b.textContent === 'Delete audio of your telling'));
    await waitFor(async () => (await getMeeting(V41_CATCHUP.id))?.told?.audioDeleted === true);
    expect((await listSegments(V41_CATCHUP.id)).length).toBe(V41_SEGMENTS.length);
    click(view.host.querySelector('[aria-haspopup="menu"]'));
    const menu = await waitFor(() => view.host.querySelector('[role="menu"]') ?? false);
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Share', 'Delete this catch-up']);
  });

  it('Undo after "Delete this catch-up" restores the meeting and its items', async () => {
    summaryView.undoMs = 60_000;
    const view = await open('V41MeetingMore');
    click([...(await waitFor(() => view.host.querySelector('[role="menu"]') ?? false)).querySelectorAll('button')].find((b) => b.textContent === 'Delete this catch-up'));
    click([...(await waitFor(() => view.host.querySelector('[role="dialog"]') ?? false)).querySelectorAll('button')].find((b) => b.textContent === 'Delete'));
    click(await waitFor(() => [...view.host.querySelectorAll('button')].find((b) => b.textContent === 'Undo') ?? false));
    await waitFor(() => text(view.host).includes('Your telling'));
    expect(text(view.host)).not.toContain('catch-up was deleted');
    expect(await getMeeting(V41_CATCHUP.id)).toBeDefined();
    expect((await itemsForMeeting(V41_CATCHUP.id)).length).toBe(V41_ITEMS.length);
  });

  it('Delete this catch-up asks first, then removes the meeting and its items', async () => {
    const view = await open('V41MeetingMore');
    const menu = await waitFor(() => view.host.querySelector('[role="menu"]') ?? false);
    click([...menu.querySelectorAll('button')].find((b) => b.textContent === 'Delete this catch-up'));
    const dialog = await waitFor(() => view.host.querySelector('[role="dialog"]') ?? false);
    expect(dialog.textContent).toContain('Delete this catch-up?');
    expect(dialog.textContent).toContain('Your telling and its 4 memory items are deleted from this computer.');
    click([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Cancel'));
    expect(view.host.querySelector('[role="dialog"]')).toBeNull();
    expect(await getMeeting(V41_CATCHUP.id)).toBeDefined();
    click(view.host.querySelector('[aria-haspopup="menu"]'));
    click([...(await waitFor(() => view.host.querySelector('[role="menu"]') ?? false)).querySelectorAll('button')].find((b) => b.textContent === 'Delete this catch-up'));
    click([...(await waitFor(() => view.host.querySelector('[role="dialog"]') ?? false)).querySelectorAll('button')].find((b) => b.textContent === 'Delete'));
    expect(text(view.host)).toContain('catch-up was deleted');
    await waitFor(async () => (await getMeeting(V41_CATCHUP.id)) === undefined);
    await waitFor(() => view.router.route.screen === 'library');
    expect(await itemsForMeeting(V41_CATCHUP.id)).toEqual([]);
  });
});

describe('the Meetings list', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB(), 'before');
  });
  it('tags a catch-up "Catch up" with its time, length, guests and open promises', async () => {
    const f = DEV_FRAMES.V41Library!;
    world.now = () => f.now!;
    await f.setup!();
    const view = await mount(sidepanel, 'library', '/library');
    const card = await waitFor(() => [...view.host.querySelectorAll('.lib-card')].find((c) => text(c).includes('Q4 planning with Northwind')) ?? false);
    for (const s of ['13:00 · 4 h', 'With Sarah, Tom and Priya', 'Catch up', '2 open promises']) expect(text(card)).toContain(s);
    expect(text(view.host)).toContain('Today');
    expect(view.host.querySelector('[placeholder^="Search "]')).not.toBeNull();
  });
});
