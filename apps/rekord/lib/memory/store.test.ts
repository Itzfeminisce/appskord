import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDB, getDB, listMeetings } from '../db';
import { quoteFound } from './check';
import { SAMPLE_ITEMS, SAMPLE_NOW, SAMPLE_ONE_ON_ONE_ITEMS, SAMPLE_PEOPLE, sampleSegments, seedSample } from './sample';
import {
  decisionsChain, forgetAll, forgetPerson, getAgenda, getItem, getPerson, itemsByKind, itemsForMeeting, itemsForPerson,
  listLedger, listPeople, mergePeople, openLoops, personByEmail, putItem, replaceDecision, splitPerson, undoReplaceDecision,
} from './store';

describe('memory store', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB());
  });

  it('loads the sample world', async () => {
    expect(await listMeetings()).toHaveLength(24);
    expect(await listPeople()).toHaveLength(12);
    expect(SAMPLE_ITEMS).toHaveLength(74);
    expect(await itemsByKind('promise')).toHaveLength(41);
    expect(await itemsByKind('decision')).toHaveLength(18);
    expect(await itemsByKind('question')).toHaveLength(15);
    expect((await getAgenda('evt-sarah-1103'))?.items).toHaveLength(4);
    expect(await listLedger()).toEqual([]);
    expect((await personByEmail('sarah@northwind.co'))?.id).toBe('p-sarah');
  });

  it('seeds the ledger and the 1:1 after the recording', async () => {
    await seedSample(await getDB(), 'after');
    expect(await listMeetings()).toHaveLength(25);
    expect((await listLedger()).find((r) => r.what === 'Audio for transcription')?.count).toBe(32);
  });

  it('finds every sample quote in its meeting transcript', () => {
    const segments = sampleSegments();
    for (const i of SAMPLE_ITEMS) {
      for (const q of [i.quote, ...i.history, ...(i.evidence ? [i.evidence] : [])]) {
        expect(quoteFound(q, segments.filter((s) => s.meetingId === q.meetingId)), q.text).toBe(true);
      }
    }
  });

  it('lists open loops, items by person and meeting', async () => {
    expect((await openLoops(SAMPLE_NOW)).map((i) => i.id).sort()).toEqual(
      ['i-checklist', 'i-deck', 'i-launch-copy', 'i-proposal', 'i-q3', 'q-free-plan']);
    expect((await itemsForPerson('p-sarah')).map((i) => i.id).sort()).toEqual(['d-rollout-9', 'f-decision-1', 'i-deck', 'i-q3']);
    expect((await itemsForMeeting('m-pricing-review')).length).toBe(3);
  });

  it('follows a decision chain both ways', async () => {
    expect((await decisionsChain('d-team-12')).map((i) => i.id)).toEqual(['d-team-10', 'd-team-12']);
    expect((await decisionsChain('d-team-10')).map((i) => i.id)).toEqual(['d-team-10', 'd-team-12']);
    expect(await decisionsChain('missing')).toEqual([]);
  });

  it('forgets a person', async () => {
    const plan = await forgetPerson('p-sarah', 7);
    expect(plan).toMatchObject({ promises: 2, decisionLinks: 2 });
    expect(await getPerson('p-sarah')).toBeUndefined();
    expect(await getItem('i-deck')).toBeUndefined();
    expect((await getItem('d-rollout-9'))?.personIds).toEqual([]);
    expect(await itemsForPerson('p-sarah')).toEqual([]);
  });

  it('merges "Sam" into Sam Ortiz', async () => {
    const merged = await mergePeople('p-sam', 'p-sam-guest', 7);
    expect(merged?.aliases).toContain('Sam');
    expect(merged?.meetingIds).toHaveLength(5);
    expect(await getPerson('p-sam-guest')).toBeUndefined();
    expect(await mergePeople('p-sam', 'nobody', 7)).toBeUndefined();
  });

  it('splits meetings out to a new person and moves their items', async () => {
    const fresh = await splitPerson('p-sam', ['m-sync-11-02'], { id: 'p-new', name: 'Sam' }, 7);
    expect(fresh?.meetingIds).toEqual(['m-sync-11-02']);
    expect((await getPerson('p-sam'))?.meetingIds).toHaveLength(4);
    expect((await getItem('d-launch-14'))?.personIds).toEqual(['p-new']);
    expect((await getItem('i-checklist'))?.toId).toBe('p-sam');
  });

  it('forgets all memory but keeps meetings', async () => {
    await forgetAll();
    expect(await listPeople()).toEqual([]);
    expect(await itemsByKind('promise')).toEqual([]);
    expect(await getAgenda('evt-sarah-1103')).toBeUndefined();
    expect(await listMeetings()).toHaveLength(24);
    expect(SAMPLE_PEOPLE).toHaveLength(12);
  });

  it('puts owner and recipient in personIds on every save', async () => {
    const base = SAMPLE_ITEMS.find((i) => i.id === 'i-proposal')!;
    await putItem({ ...base, id: 'x1', ownerId: 'p-dana', toId: 'me', personIds: [] });
    expect((await getItem('x1'))?.personIds).toEqual(['p-dana']);
    expect((await itemsForPerson('p-dana')).map((i) => i.id)).toContain('x1');
  });

  it('finds an item that carries the person only as owner, even when stored without personIds', async () => {
    const base = SAMPLE_ITEMS.find((i) => i.id === 'i-proposal')!;
    await (await getDB()).put('items', { ...base, id: 'raw', ownerId: 'p-dana', toId: 'me', personIds: [] });
    expect((await itemsForPerson('p-dana')).map((i) => i.id)).toContain('raw');
  });

  it('replaces and undoes a replace on both decisions at once', async () => {
    await putItem({ ...SAMPLE_ITEMS.find((i) => i.id === 'd-launch-14')!, id: 'd-launch-16', text: 'Launch email goes out on 16 Nov' });
    expect(await replaceDecision('d-launch-14', 'd-launch-16', 5)).toBe(true);
    expect(await getItem('d-launch-14')).toMatchObject({ status: 'replaced', replacedById: 'd-launch-16' });
    expect(await getItem('d-launch-16')).toMatchObject({ replacesId: 'd-launch-14' });
    expect(await replaceDecision('d-launch-14', 'd-launch-16', 6)).toBe(false);
    expect(await undoReplaceDecision('d-launch-14', 7)).toBe(true);
    expect(await getItem('d-launch-14')).toMatchObject({ status: 'open', replacedById: undefined });
    expect((await getItem('d-launch-16'))?.replacesId).toBeUndefined();
    expect(await undoReplaceDecision('d-launch-14', 8)).toBe(false);
  });

  it('holds what the 1:1 produced after the recording', async () => {
    await seedSample(await getDB(), 'after');
    const made = await itemsForMeeting('m-sarah-11-03');
    const kept = made.filter((i) => !i.leftOut);
    expect(made).toHaveLength(8);
    expect(kept.filter((i) => i.kind === 'promise')).toHaveLength(4);
    expect(kept.filter((i) => i.kind === 'decision' && i.replacesId === 'd-rollout-9')).toHaveLength(1);
    expect(kept.filter((i) => i.kind === 'question')).toHaveLength(1);
    expect(made.filter((i) => i.leftOut)).toHaveLength(2);
    const { getDB: db } = await import('../db');
    const segs = await (await db()).getAllFromIndex('segments', 'meetingId', 'm-sarah-11-03');
    for (const i of SAMPLE_ONE_ON_ONE_ITEMS) expect(quoteFound(i.quote, segs), i.id).toBe(!i.leftOut);
  });
});
