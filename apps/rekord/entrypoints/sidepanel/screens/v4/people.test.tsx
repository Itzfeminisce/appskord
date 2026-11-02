// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, getDB, listMeetings } from '@/lib/db';
import { detectSeries, nextMeeting, seriesLine } from '@/lib/memory/series';
import { SAMPLE_EVENT, SAMPLE_ITEMS, SAMPLE_MEETINGS, SAMPLE_NOW, SAMPLE_PEOPLE, seedSample } from '@/lib/memory/sample';
import { getPerson, itemsByKind, itemsForPerson, listItems, listPeople } from '@/lib/memory/store';
import { mount, settle } from '../../../../test/mountRouter';
import { sidepanel } from '../../App';
import { world } from '../../components/v4/world';
import { dueBadge, personRows } from './peopleView';

const person = (id: string) => SAMPLE_PEOPLE.find((p) => p.id === id)!;
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);

describe('people view', () => {
  it('sorts by next meeting, then last met, and words each row like the frame', () => {
    const rows = personRows(SAMPLE_PEOPLE, SAMPLE_ITEMS, SAMPLE_MEETINGS, [SAMPLE_EVENT], SAMPLE_NOW);
    expect(rows.slice(0, 5).map((r) => [r.person.name, r.line, r.open])).toEqual([
      ['Sarah Chen', 'Northwind · next: today 10:00', 2],
      ['Priya Nair', 'priya@rekord-team.com', 1],
      ['Sam Ortiz', 'sam@rekord-team.com', 1],
      ['Sam', 'Guest in Weekly product sync', 0],
      ['Dana Ruiz', 'Lumen · dana@lumen.io', 1],
    ]);
  });

  it('finds a weekly series and the next meeting', () => {
    const sarah = person('p-sarah');
    expect(seriesLine({ ...sarah, series: undefined }, SAMPLE_MEETINGS)).toEqual({ label: 'Every Tuesday 10:00', count: 6, since: 'Sep' });
    expect(detectSeries([1, 2].map((d) => new Date(2026, 9, d, 10).getTime()))).toBeUndefined();
    expect(nextMeeting(sarah, [SAMPLE_EVENT], SAMPLE_NOW)?.title).toBe('1:1 with Sarah');
    expect(nextMeeting(person('p-dana'), [SAMPLE_EVENT], SAMPLE_NOW)).toBeUndefined();
  });

  it('labels due dates', () => {
    const deck = SAMPLE_ITEMS.find((i) => i.id === 'i-deck')!;
    expect(dueBadge(deck, SAMPLE_NOW)?.text).toBe('Overdue 4 days');
    expect(dueBadge({ ...deck, due: '2026-11-03' }, SAMPLE_NOW)?.text).toBe('Due today');
  });
});

describe('people screens', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB());
    world.now = () => SAMPLE_NOW;
    world.events = [SAMPLE_EVENT];
    await browser.storage.local.clear();
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);
  });

  it('forgets Sarah: her page, 2 promises and 2 decision links', async () => {
    const before = (await itemsByKind('promise')).length;
    const view = await mount(sidepanel, 'forget', '/forget?person=p-sarah');
    await settle();
    const text = view.host.querySelector('[role=dialog]')!.textContent!;
    expect(text).toContain('Forget Sarah Chen?');
    expect(text).toContain('2 promises');
    expect(text).toContain('2 decision links');
    expect(view.host.querySelector<HTMLInputElement>('#pf-redact')!.disabled).toBe(true);
    click(button(view.host, 'Forget Sarah'));
    await settle();
    expect(view.router.route.screen).toBe('people');
    expect(view.host.querySelector('[role=status]')?.textContent).toBe('Sarah is forgotten.');
    expect(await getPerson('p-sarah')).toBeUndefined();
    expect((await itemsByKind('promise')).length).toBe(before - 2);
    expect((await listItems()).filter((i) => i.personIds.includes('p-sarah'))).toEqual([]);
    expect(await listMeetings()).toHaveLength(24);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'rekord.badge.refresh' });
  });

  it('Keep forgets nothing', async () => {
    const view = await mount(sidepanel, 'person', '/person?person=p-sarah');
    await settle();
    view.router.navigate('forget', { personId: 'p-sarah' });
    await settle();
    click(button(view.host, 'Keep'));
    await settle();
    expect(view.router.route.screen).toBe('person');
    expect(await getPerson('p-sarah')).toBeDefined();
  });

  it('merges Sam into Sam Ortiz from the banner', async () => {
    const view = await mount(sidepanel, 'people', '/people');
    await settle();
    expect(view.host.querySelector('.pp-banner')?.textContent).toBe('2 people to check: are they the same person?');
    expect(view.host.querySelectorAll('.pp-row')).toHaveLength(12);
    click(view.host.querySelector('.pp-banner'));
    await settle();
    expect(view.router.route).toEqual({ screen: 'personMerge', params: { personId: 'p-sam-guest', otherId: 'p-sam' } });
    click(button(view.host, 'Same person, merge'));
    await settle();
    expect(view.router.route.params.personId).toBe('p-sam');
    expect(await listPeople()).toHaveLength(11);
    const merged = await getPerson('p-sam');
    expect(merged?.aliases).toContain('Sam');
    expect(merged?.meetingIds).toHaveLength(5);
  });

  it('Different people stops suggesting the pair', async () => {
    const view = await mount(sidepanel, 'people', '/people');
    await settle();
    click(view.host.querySelector('.pp-banner'));
    await settle();
    click(button(view.host, 'Different people'));
    await settle();
    expect(view.router.route.screen).toBe('people');
    expect(view.host.querySelector('.pp-banner')).toBeNull();
    expect(await listPeople()).toHaveLength(12);
  });

  it('splits checked meetings out to a new person with their items', async () => {
    const view = await mount(sidepanel, 'personMerge', '/personMerge?person=p-sam');
    await settle();
    const boxes = [...view.host.querySelectorAll<HTMLInputElement>('.pm-check input')];
    expect(boxes).toHaveLength(5);
    for (const box of boxes.slice(0, 4)) click(box);
    await settle();
    click(button(view.host, 'Move 1 meeting to a new person'));
    await settle();
    const freshId = view.router.route.params.personId!;
    expect(freshId).not.toBe('p-sam');
    expect((await getPerson(freshId))?.meetingIds).toHaveLength(1);
    expect((await getPerson('p-sam'))?.meetingIds).toHaveLength(4);
    expect(await listPeople()).toHaveLength(13);
    const moved = (await getPerson(freshId))!.meetingIds[0]!;
    expect((await itemsForPerson('p-sam')).some((i) => i.meetingId === moved)).toBe(false);
  });

  it('shows Sarah’s page like the frame', async () => {
    const view = await mount(sidepanel, 'person', '/person?person=p-sarah');
    await settle();
    const text = view.host.textContent!;
    for (const line of ['Every Tuesday 10:00 · 6 meetings since Sep', '1:1 with Sarah · in 5 min', 'You owe Sarah', 'Sarah owes you',
      'Decided together', 'Last thing Sarah said', '“Northwind wants to start the rollout on the 9th.”', 'Sarah · 1:1 with Sarah · 27 Oct · 14:50',
      'See all 6 meetings']) expect(text).toContain(line);
    expect(view.host.querySelectorAll('.pp-item')).toHaveLength(3);
  });
});
