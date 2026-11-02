// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, getDB, listMeetings } from '@/lib/db';
import { detectSeries, nextMeeting, seriesLine } from '@/lib/memory/series';
import { SAMPLE_EVENT, SAMPLE_ITEMS, SAMPLE_MEETINGS, SAMPLE_NOW, SAMPLE_PEOPLE, seedSample } from '@/lib/memory/sample';
import { getItem, getPerson, itemsByKind, itemsForPerson, listItems, listPeople } from '@/lib/memory/store';
import { mount, settle, waitFor } from '../../../../test/mountRouter';
import { sidepanel } from '../../App';
import { world } from '../../components/v4/world';
import { dueBadge, personRows } from './peopleView';
import { pickList } from './PersonSheets';

const person = (id: string) => SAMPLE_PEOPLE.find((p) => p.id === id)!;
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);
const type = (el: Element | null, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el!.dispatchEvent(new Event('input', { bubbles: true }));
});

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
    expect(detectSeries([6, 13, 20].map((d) => new Date(2026, 9, d, 10, d === 13 ? 4 : 0).getTime()))?.label).toBe('Every Tuesday 10:00');
    expect(detectSeries([6, 20, 3 + 31].map((d) => new Date(2026, 9, d, 10).getTime()))).toBeUndefined();
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
    expect(view.host.querySelector<HTMLInputElement>('#pf-redact')!.disabled).toBe(false);
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
    await waitFor(() => {
      expect(view.host.querySelector('.pp-banner')?.textContent).toBe('2 people to check: are they the same person?');
      expect(view.host.querySelectorAll('.pp-row')).toHaveLength(12);
    });
    click(view.host.querySelector('.pp-banner'));
    await waitFor(() => expect(view.router.route).toEqual({ screen: 'personMerge', params: { personId: 'p-sam-guest', otherId: 'p-sam' } }));
    click(await waitFor(() => button(view.host, 'Same person, merge') ?? false));
    await waitFor(() => expect(view.router.route.params.personId).toBe('p-sam'));
    await waitFor(async () => expect(await listPeople()).toHaveLength(11));
    const merged = await getPerson('p-sam');
    expect(merged?.aliases).toContain('Sam');
    expect(merged?.meetingIds).toHaveLength(5);
  });

  it('Rename saves name, email and company in one sheet', async () => {
    const view = await mount(sidepanel, 'person', '/person?person=p-sarah');
    await settle();
    click(view.host.querySelector('[aria-label="More for Sarah"]'));
    click(button(view.host, 'Rename'));
    const sheet = view.host.querySelector('[role=dialog]')!;
    expect(sheet.querySelector('h1')?.textContent).toBe('Rename Sarah Chen');
    expect([...sheet.querySelectorAll('input')].map((i) => i.value)).toEqual(['Sarah Chen', 'sarah@northwind.co', 'Northwind']);
    expect(sheet.textContent).toContain('Rekord uses this name in briefs, follow-ups and your Rekord folder.');
    type(sheet.querySelector('#ps-name'), 'Sarah Chen-Li');
    type(sheet.querySelector('#ps-company'), '');
    click(button(view.host, 'Save'));
    await settle();
    expect(view.host.querySelector('[role=dialog]')).toBeNull();
    const saved = await getPerson('p-sarah');
    expect(saved).toMatchObject({ name: 'Sarah Chen-Li', email: 'sarah@northwind.co', company: undefined });
    expect(saved?.aliases).toContain('Sarah Chen');
    expect(view.host.querySelector('.pp-head-title')?.textContent).toBe('Sarah Chen-Li');
  });

  it('Cancel renames nothing', async () => {
    const view = await mount(sidepanel, 'person', '/person?person=p-sarah');
    await settle();
    click(view.host.querySelector('[aria-label="More for Sarah"]'));
    click(button(view.host, 'Rename'));
    type(view.host.querySelector('#ps-name'), 'Someone else');
    click(button(view.host, 'Cancel'));
    await settle();
    expect((await getPerson('p-sarah'))?.name).toBe('Sarah Chen');
  });

  it('Merge with someone, with no suggestion, picks a person, merges and undoes', async () => {
    const view = await mount(sidepanel, 'person', '/person?person=p-sarah');
    await settle();
    click(view.host.querySelector('[aria-label="More for Sarah"]'));
    const menuItem = button(view.host, 'Merge with someone')!;
    expect(menuItem.getAttribute('aria-disabled')).toBeNull();
    click(menuItem);
    const sheet = view.host.querySelector('[role=dialog]')!;
    expect(sheet.querySelector('h1')?.textContent).toBe('Merge Sarah Chen with…');
    expect(sheet.textContent).toContain('Their meetings, promises and decisions move to Sarah Chen. You can split them out again.');
    const merge = button(view.host, 'Merge into Sarah Chen')!;
    expect(merge.disabled).toBe(true);
    type(sheet.querySelector('input[type=search]'), 'lumen');
    expect([...sheet.querySelectorAll('.ps-person-name')].map((n) => n.textContent)).toEqual(['Dana Ruiz']);
    expect(sheet.querySelector('.ps-person')?.textContent).toBe('DRDana Ruizdana@lumen.io1 meeting');
    click(sheet.querySelector('#ps-p-p-dana'));
    expect(merge.disabled).toBe(false);
    click(merge);
    await settle();
    expect(await getPerson('p-dana')).toBeUndefined();
    expect((await getPerson('p-sarah'))?.meetingIds).toContain('m-intro-lumen');
    expect((await getItem('i-proposal'))?.toId).toBe('p-sarah');
    expect(view.host.querySelector('.lp-toast')?.textContent).toBe('Merged.Undo');
    click(button(view.host, 'Undo'));
    await settle();
    expect(await getPerson('p-dana')).toMatchObject({ name: 'Dana Ruiz', meetingIds: ['m-intro-lumen'] });
    expect((await getPerson('p-sarah'))?.meetingIds).not.toContain('m-intro-lumen');
    expect((await getItem('i-proposal'))?.toId).toBe('p-dana');
    expect(view.host.querySelector('.lp-toast')).toBeNull();
  });

  it('the pick list leaves the person out, most meetings first, and names a guest’s meeting', () => {
    const list = pickList(person('p-sarah'), SAMPLE_PEOPLE, '');
    expect(list.map((p) => p.id).slice(0, 3)).toEqual(['p-priya', 'p-sam', 'p-sam-guest']);
    expect(list.some((p) => p.id === 'p-sarah')).toBe(false);
    expect(pickList(person('p-sarah'), SAMPLE_PEOPLE, 'sam').map((p) => p.id)).toEqual(['p-sam', 'p-sam-guest']);
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
    expect(boxes.some((b) => b.checked)).toBe(false);
    expect(button(view.host, 'Move 0 meetings to a new person')?.disabled).toBe(true);
    for (const box of boxes) click(box);
    await settle();
    expect(button(view.host, 'Move 5 meetings to a new person')?.disabled).toBe(true);
    for (const box of boxes.slice(1)) click(box);
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
