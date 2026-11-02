// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, getDB } from '@/lib/db';
import { SAMPLE_EVENT, SAMPLE_ITEMS, SAMPLE_NOW, seedSample } from '@/lib/memory/sample';
import { getItem, putItem } from '@/lib/memory/store';
import { mount, settle } from '../../../../test/mountRouter';
import { sidepanel } from '../../App';
import { world } from '../../components/v4/world';
import { changedPart, decisionLog, dueChip, snoozeTimes, weekdayDate } from './loops';

const byId = (id: string) => SAMPLE_ITEMS.find((i) => i.id === id)!;
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const rows = (host: HTMLElement) => [...host.querySelectorAll('.lp-row-title')].map((r) => r.textContent);

describe('open loops helpers', () => {
  it('labels due chips the way the frames do', () => {
    expect(dueChip(byId('i-deck'), SAMPLE_NOW)).toEqual({ label: '4 days late', tone: 'late' });
    expect(dueChip(byId('i-q3'), SAMPLE_NOW)).toEqual({ label: 'Due today', tone: 'today' });
    expect(dueChip(byId('i-launch-copy'), SAMPLE_NOW)).toEqual({ label: 'Thu 5 Nov', tone: 'plain' });
    expect(dueChip(byId('i-proposal'), SAMPLE_NOW)).toEqual({ label: 'No date', tone: 'plain' });
    expect(dueChip(byId('i-checklist'), SAMPLE_NOW).label).toBe('Looks done');
  });

  it('snoozes to 09:00 tomorrow and next Monday', () => {
    const { tomorrow, nextWeek } = snoozeTimes(SAMPLE_NOW);
    expect(weekdayDate(tomorrow)).toBe('Wed 4 Nov');
    expect(weekdayDate(nextWeek)).toBe('Mon 9 Nov');
    expect(new Date(nextWeek).getHours()).toBe(9);
  });

  it('shows what changed in a replace chain', () => {
    expect(changedPart('Team plan is $12 a seat', 'Team plan is $10 a seat')).toEqual(['$12 a seat', '$10 a seat']);
    expect(changedPart('Ship on Friday', 'Wait for review')).toEqual(['Ship on Friday', 'Wait for review']);
  });

  it('puts the decision that replaced another first', () => {
    const { cards } = decisionLog(SAMPLE_ITEMS, new Map(), SAMPLE_NOW);
    expect(cards[0]!.item.id).toBe('d-team-12');
    expect(cards[0]!.before?.id).toBe('d-team-10');
    expect(cards.some((c) => c.item.id === 'd-team-10')).toBe(false);
  });
});

describe('open loops screens', () => {
  let send: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB());
    world.now = () => SAMPLE_NOW;
    world.events = [SAMPLE_EVENT];
    send = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);
  });
  afterEach(() => { world.now = () => Date.now(); world.events = undefined; });

  it('home shows the brief card, the Looks done banner, counts and sections', async () => {
    const view = await mount(sidepanel, 'home');
    await settle();
    const text = view.host.textContent!;
    expect(text).toContain('1:1 with Sarah · in 5 min');
    expect(text).toContain('Today 10:00 · Google Meet');
    expect(text).toContain('1 promise looks done');
    expect([...view.host.querySelectorAll('.lp-seg button')].map((b) => b.textContent)).toEqual(['You owe3', 'Owed to you2', 'Questions1']);
    expect([...view.host.querySelectorAll('.lp-section h2')].map((h) => h.textContent)).toEqual(['Overdue', 'No date']);
    expect(rows(view.host)).toEqual(['Send the revised pricing deck', 'A short proposal', 'Share the onboarding checklist']);
    // T9 registered the brief route, so the card's link is live.
    expect(button(view.host, 'Open brief')?.getAttribute('aria-disabled')).toBeNull();
  });

  it('the check marks a promise done with an undo toast', async () => {
    const view = await mount(sidepanel, 'home');
    await settle();
    send.mockClear();
    click(view.host.querySelector('[aria-label="Mark done: Send the revised pricing deck"]'));
    await settle();
    expect((await getItem('i-deck'))!.status).toBe('done');
    expect(send).toHaveBeenCalledWith({ type: 'rekord.badge.refresh' });
    expect(view.host.querySelector('.lp-toast')?.textContent).toBe('Marked “Send the revised pricing deck” as doneUndo');
    expect(rows(view.host)).not.toContain('Send the revised pricing deck');
    click(button(view.host, 'Undo'));
    await settle();
    expect((await getItem('i-deck'))!.status).toBe('open');
    expect(rows(view.host)).toContain('Send the revised pricing deck');
  });

  it('snooze hides the promise until it wakes', async () => {
    const view = await mount(sidepanel, 'home');
    act(() => view.router.navigate('promise', { itemId: 'i-deck' }));
    await settle();
    expect(view.host.querySelector('[role="dialog"]')?.textContent).toContain('Mentioned again in 1:1 with Sarah · 27 Oct: “I’m still finishing the deck.”');
    expect(button(view.host, 'Before my next meeting with Sarah')).toBeTruthy();
    click(button(view.host, 'Next week'));
    await settle();
    expect(view.router.route.screen).toBe('home');
    expect(view.host.querySelector('.lp-toast')?.textContent).toContain('Snoozed “Send the revised pricing deck” to Mon 9 Nov');
    expect(rows(view.host)).not.toContain('Send the revised pricing deck');
    const snoozed = (await getItem('i-deck'))!;
    world.now = () => snoozed.snoozedUntil! + 1;
    const later = await mount(sidepanel, 'home');
    await settle();
    expect(rows(later.host)).toContain('Send the revised pricing deck');
  });

  it('hides the next-meeting snooze when the calendar has no meeting with them', async () => {
    world.events = [];
    const view = await mount(sidepanel, 'home');
    act(() => view.router.navigate('promise', { itemId: 'i-deck' }));
    await settle();
    expect(button(view.host, 'Tomorrow')).toBeTruthy();
    expect(button(view.host, 'Before my next meeting with Sarah')).toBeUndefined();
  });

  it('drops a promise with a reason', async () => {
    const view = await mount(sidepanel, 'home');
    act(() => view.router.navigate('promise', { itemId: 'i-proposal' }));
    await settle();
    click(button(view.host, 'Drop this promise'));
    click(button(view.host, 'Someone else took it'));
    await settle();
    const dropped = (await getItem('i-proposal'))!;
    expect(dropped).toMatchObject({ status: 'dropped', dropReason: 'someoneElse' });
    expect(rows(view.host)).not.toContain('A short proposal');
  });

  it('Send to Google Tasks waits for its screen; Edit opens', async () => {
    const view = await mount(sidepanel, 'home');
    act(() => view.router.navigate('promise', { itemId: 'i-deck' }));
    await settle();
    expect(button(view.host, 'Send to Google Tasks')?.getAttribute('aria-disabled')).toBe('true');
    expect(button(view.host, 'Edit')?.getAttribute('aria-disabled')).toBeNull();
  });

  it('looks done: Yes closes it, Not yet keeps it open', async () => {
    const view = await mount(sidepanel, 'home');
    click(view.host.querySelector('.lp-looks'));
    await settle();
    expect(view.router.route).toEqual({ screen: 'looksDone', params: { itemId: 'i-checklist' } });
    expect(view.host.textContent).toContain('I shared the onboarding checklist with Sam this morning.');
    click(button(view.host, 'Not yet'));
    await settle();
    expect((await getItem('i-checklist'))).toMatchObject({ status: 'open', evidence: undefined });

    await putItem(byId('i-checklist'));
    act(() => view.router.navigate('looksDone', { itemId: 'i-checklist' }));
    await settle();
    click(button(view.host, 'Yes, it’s done'));
    await settle();
    expect((await getItem('i-checklist'))!.status).toBe('done');
    expect(view.host.querySelector('.lp-toast')?.textContent).toContain('Marked “Share the onboarding checklist” as done');
  });

  it('nudge drafts from the quote and opens a Gmail compose URL', async () => {
    const tabs = vi.spyOn(browser.tabs, 'create').mockResolvedValue({} as never);
    await browser.storage.session.set({ 'rekord.nudge.i-q3.friendly': 'Hi Sarah, could you send the Q3 usage numbers? Thank you, Alex' });
    const view = await mount(sidepanel, 'home');
    act(() => view.router.navigate('nudge', { itemId: 'i-q3' }));
    await settle();
    expect(view.host.querySelector('h1')?.textContent).toBe('Remind Sarah about Q3 usage numbers');
    expect(view.host.querySelector('textarea')?.value).toBe('Hi Sarah, could you send the Q3 usage numbers? Thank you, Alex');
    expect(view.host.querySelector('.lp-seg [aria-checked="true"]')?.textContent).toBe('Owed to you2');
    click(button(view.host, 'Open in Gmail'));
    const url = new URL((tabs.mock.calls[0]![0] as { url: string }).url);
    expect(url.searchParams.get('to')).toBe('sarah@northwind.co');
    expect(url.searchParams.get('su')).toBe('Q3 usage numbers');
    expect(url.searchParams.get('body')).toContain('Q3 usage numbers');
  });

  it('decisions: chain, person filter and Undo replace', async () => {
    const view = await mount(sidepanel, 'decisions');
    await settle();
    const text = view.host.textContent!;
    expect(text).toContain('Now: $12 a seat (26 Oct)');
    expect(text).toContain('Before: $10 a seat (3 Oct)');
    expect([...view.host.querySelectorAll('.dc-filter button')].map((b) => b.textContent)).toEqual(['Everyone', 'Sarah', 'Priya', 'Sam', 'Dana']);
    click(button(view.host, 'Sarah'));
    expect([...view.host.querySelectorAll('.dc-card h2')].map((h) => h.textContent)).toContain('Northwind rollout starts 9 Nov');
    expect(view.host.textContent).not.toContain('Team plan is $12 a seat');
    click(button(view.host, 'Everyone'));
    click(button(view.host, 'Undo replace'));
    await settle();
    expect((await getItem('d-team-10'))).toMatchObject({ status: 'open', replacedById: undefined });
    expect((await getItem('d-team-12'))!.replacesId).toBeUndefined();
    expect(view.host.textContent).toContain('Team plan is $10 a seat');
  });
});
