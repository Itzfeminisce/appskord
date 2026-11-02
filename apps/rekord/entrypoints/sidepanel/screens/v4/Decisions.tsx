import { useCallback, useEffect, useState } from 'react';
import { listMeetings } from '@/lib/db';
import { listItems, listPeople, undoReplaceDecision } from '@/lib/memory/store';
import type { MemoryItem, Person } from '@/lib/memory/types';
import { useCalendar } from '../../components/CalendarCard';
import { BackIcon } from '../../components/v4/icons';
import { Shell } from '../../components/v4/Shell';
import { world } from '../../components/v4/world';
import { changedPart, dayMonth, decisionLog, filterPeople, firstName, saidAt, type Meetings } from './loops';
import { DecisionIcon, QuoteBlock, refreshBadge, useCloseSheet } from './parts';

interface Data { items: MemoryItem[]; people: Person[]; meetings: Meetings; ready: boolean }

/** Decisions log: each standing decision with its quote, the replace chain, a person filter and "Undo replace". */
export default function Decisions() {
  const back = useCloseSheet();
  const calendar = useCalendar();
  const [data, setData] = useState<Data>({ items: [], people: [], meetings: new Map(), ready: false });
  const [personId, setPersonId] = useState<string>();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    void Promise.all([listItems(), listPeople(), listMeetings()])
      .then(([items, people, meetings]) => alive && setData({ items, people, meetings: new Map(meetings.map((m) => [m.id, m])), ready: true }))
      .catch((error) => console.error('Rekord: could not load decisions', error));
    return () => { alive = false; };
  }, [tick]);

  const now = world.now();
  const events = world.events ?? (calendar.status === 'ready' ? calendar.events : []);
  const people = filterPeople(data.people, data.items, data.meetings, events, now);
  const { cards } = decisionLog(data.items, data.meetings, now, personId);
  const { recent } = decisionLog(data.items, data.meetings, now);
  const date = (i: MemoryItem) => dayMonth(saidAt(i, data.meetings));
  const undo = async (old: MemoryItem) => {
    if (await undoReplaceDecision(old.id, Date.now())) { refreshBadge(); reload(); }
  };

  return (
    <Shell tab="loops">
      <div className="dc-page">
        <div className="dc-head">
          <button type="button" className="dc-back" aria-label="Back to Open loops" onClick={back}><BackIcon /></button>
          <h1>Decisions</h1>
          {data.ready && <span className="dc-count">{`${recent} recent`}</span>}
        </div>
        <div role="group" aria-label="Filter by person" className="lp-pills dc-filter">
          <button type="button" className="lp-pill" aria-pressed={!personId} onClick={() => setPersonId(undefined)}><span>Everyone</span></button>
          {people.map((p) => (
            <button key={p.id} type="button" className="lp-pill" aria-pressed={personId === p.id} onClick={() => setPersonId(p.id)}><span>{firstName(p.name)}</span></button>
          ))}
        </div>
        <div className="dc-list">
          {cards.map(({ item, before }) => {
            const [nowPart, beforePart] = before ? changedPart(item.text, before.text) : ['', ''];
            return (
              <article key={item.id} className={before ? 'dc-card dc-card-chain' : 'dc-card'}>
                <div className="dc-card-head">
                  <span className="dc-icon"><DecisionIcon size={16} stroke={2.2} /></span>
                  <div><h2>{item.text}</h2><span className="dc-date">{date(item)}</span></div>
                </div>
                <QuoteBlock quote={item.quote} meetings={data.meetings} accent="#1A6B40" variant="log" />
                {before && (
                  <div className="dc-chain">
                    <span className="dc-chain-text">
                      <span><strong className="dc-now">Now:</strong> {`${nowPart} (${date(item)})`}</span>
                      <span><strong>Before:</strong> {`${beforePart} (${date(before)})`}</span>
                    </span>
                    <button type="button" className="dc-undo" onClick={() => void undo(before)}>Undo replace</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
