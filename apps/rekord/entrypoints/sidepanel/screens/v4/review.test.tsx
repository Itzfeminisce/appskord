// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, getDB } from '@/lib/db';
import { M, SAMPLE_AFTER, seedSample } from '@/lib/memory/sample';
import { getItem, getPerson } from '@/lib/memory/store';
import type { MemoryItem } from '@/lib/memory/types';
import { mount, settle } from '../../../../test/mountRouter';
import { sidepanel } from '../../App';
import { confirmable, dueChip, dueFor, ownerChip, personSuggestions } from '../../components/v4/review';
import type { Person } from '@/lib/memory/types';
import { world } from '../../components/v4/world';
import { DEV_FRAMES } from '../../dev/frames';

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const card = (host: HTMLElement, title: string) =>
  [...host.querySelectorAll('article')].find((a) => a.querySelector('h3')?.textContent === title)!;
const button = (root: Element, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text)!;

describe('review labels', () => {
  const nameOf = (id?: string) => (id === 'p-sarah' ? 'Sarah Chen' : undefined);
  it('names who owes whom and the due day', () => {
    const base: MemoryItem = { id: 'x', kind: 'promise', status: 'suggested', text: 't', meetingId: 'm', personIds: [], history: [], createdAt: 0, updatedAt: 0, quote: { speaker: 'A', text: 'q', meetingId: 'm', atMs: 0 } };
    expect(ownerChip({ ...base, ownerId: 'me', toId: 'p-sarah' }, nameOf)).toBe('You owe Sarah');
    expect(ownerChip({ ...base, ownerId: 'p-sarah', toId: 'me' }, nameOf)).toBe('Sarah owes you');
    expect(dueChip({ ...base, due: '2026-11-05' }, SAMPLE_AFTER)).toBe('Thu 5 Nov');
    expect(dueChip({ ...base, due: '2026-11-03' }, SAMPLE_AFTER, { ...base, due: '2026-10-30' })).toBe('Due today (moved from Fri 30 Oct)');
    expect(dueChip(base, SAMPLE_AFTER)).toBe('No date');
    expect(dueFor('friday', SAMPLE_AFTER)).toBe('2026-11-06');
  });
});

describe('person suggestions', () => {
  const p = (id: string, name: string, more: Partial<Person> = {}): Person => ({ id, name, aliases: [], meetingIds: ['m'], createdAt: 0, updatedAt: 0, ...more });
  it('shows one card per loose name, picks the likeliest candidate and keeps it out of Confirm all', () => {
    const tom = p('tom', 'Tom', { meetingIds: ['now'] });
    const people = [tom, p('a', 'Tom Ash', { meetingIds: ['1', '2', '3'] }), p('b', 'Tom Becker', { email: 'tom@example.test' })];
    const out = personSuggestions(people, 'now', []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'same', loose: tom, person: { id: 'b' }, ambiguous: true });
    expect(confirmable(out)).toEqual([]);
  });
});

describe('review card and summary strip', () => {
  const send = vi.fn().mockResolvedValue(undefined);
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    const db = await getDB();
    await seedSample(db, 'after');
    await DEV_FRAMES.V4Review!.setup!();
    world.now = () => SAMPLE_AFTER;
    vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(send);
    send.mockClear();
  });

  it('confirm all saves every item, folds the moved promise into the earlier one and links Tom', async () => {
    const view = await mount(sidepanel, 'review', `/review?meeting=${M.sarah3}`);
    expect(view.host.querySelector('h1')?.textContent).toBe('Rekord found 7 things in 1:1 with Sarah');
    click(view.host.querySelector('.rv-all'));
    await settle();
    for (const id of ['n-demo', 'n-seats', 'n-intro', 'n-rollout-16', 'n-yearly']) expect((await getItem(id))?.status).toBe('open');
    expect(await getItem('n-deck')).toBeUndefined();
    expect((await getItem('i-deck'))?.due).toBe('2026-11-03');
    expect((await getItem('n-left-1'))?.status).toBe('suggested');
    expect(await getPerson('p-tom-heard')).toBeUndefined();
    expect((await getPerson('p-tom'))?.aliases).toContain('Tom');
    expect(send).toHaveBeenCalledWith({ type: 'rekord.badge.refresh' });
    expect(view.router.route.screen).toBe('summary');
  });

  it('edit saves the date chosen', async () => {
    const view = await mount(sidepanel, 'reviewEdit', `/reviewEdit?meeting=${M.sarah3}&item=n-intro`);
    expect(view.host.textContent).toContain('Promises with a date get done far more often.');
    click(button(view.host, 'Friday'));
    click(button(view.host, 'Save'));
    await settle();
    expect((await getItem('n-intro'))?.due).toBe('2026-11-06');
    expect((await getItem('n-intro'))?.status).toBe('suggested');
  });

  it('dismiss asks nothing and saves the reason chip', async () => {
    const view = await mount(sidepanel, 'review', `/review?meeting=${M.sarah3}`);
    click(button(card(view.host, 'Join Thursday’s rollout demo'), 'Dismiss'));
    await settle();
    expect((await getItem('n-demo'))?.status).toBe('dismissed');
    click(button(card(view.host, 'Join Thursday’s rollout demo'), 'Wrong person'));
    await settle();
    expect((await getItem('n-demo'))?.dismissReason).toBe('wrongPerson');
  });

  it('add anyway keeps an item whose quote was not found', async () => {
    const view = await mount(sidepanel, 'review', `/review?meeting=${M.sarah3}`);
    const disclosure = view.host.querySelector('.rv-left')!;
    expect(disclosure.textContent).toBe('2 left out: their quote wasn’t in the transcriptAdd anyway');
    click(disclosure);
    click(button(card(view.host, 'Review the security questionnaire'), 'Add anyway'));
    await settle();
    const item = await getItem('n-left-1');
    expect(item?.status).toBe('open');
    expect(item?.leftOut).toBeUndefined();
  });

  it('summary shows the memory strip, the after-the-meeting card and the ledger link', async () => {
    const view = await mount(sidepanel, 'summary', `/summary?meeting=${M.sarah3}`);
    const text = view.host.textContent!;
    expect(text).toContain('Not saved to memory yet');
    expect(text).toContain('Your 2 promises, to Google Tasks');
    expect(button(view.host, 'Draft follow-up emailWritten in your voice, for you to check')?.getAttribute('aria-disabled')).toBeNull();
    expect(view.host.querySelector('.sm-ledger')?.textContent).toBe('What left this computer');
    click(button(view.host, 'Review 7 things'));
    await settle();
    expect(view.router.route).toEqual({ screen: 'review', params: { meetingId: M.sarah3 } });
  });
});
