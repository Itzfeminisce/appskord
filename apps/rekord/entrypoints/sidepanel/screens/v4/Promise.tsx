import { useEffect, useState } from 'react';
import { transition, type ItemEvent } from '@/lib/memory/promise';
import { tabOf } from '@/lib/memory/rank';
import { getItem, putItem } from '@/lib/memory/store';
import type { MemoryItem } from '@/lib/memory/types';
import { useCalendar } from '../../components/CalendarCard';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { LoopsHome, toastOnHome } from './Home';
import { counterpartId, dueChip, firstName, fromIso, meetingLine, nextMeetingWith, snoozeTimes, weekdayDate } from './loops';
import { Avatar, BigCheck, CloseButton, DueChip, KindTag, QuoteBlock, refreshBadge, Sheet, useCloseSheet, useMemoryView, type MemoryView } from './parts';

/** The item a sheet route names, loaded fresh (it may be snoozed or closed). */
export function useSheetItem(): [MemoryItem | undefined, (i: MemoryItem) => void] {
  const { route } = useRouter();
  const [item, setItem] = useState<MemoryItem>();
  useEffect(() => {
    let alive = true;
    if (route.params.itemId) void getItem(route.params.itemId).then((i) => alive && setItem(i));
    return () => { alive = false; };
  }, [route.params.itemId]);
  return [item, setItem];
}

/** Applies a click to the item and saves it; false when it does not apply. */
export async function apply(item: MemoryItem, event: ItemEvent): Promise<MemoryItem | undefined> {
  const next = transition(item, event, Date.now());
  if (next === item) return undefined;
  await putItem(next);
  refreshBadge();
  return next;
}

/** "You owe [SC] Sarah Chen" or "[SC] Sarah Chen owes you". */
export function FromTo({ item, view, size = 28 }: { item: MemoryItem; view: MemoryView; size?: number }) {
  const person = view.people.get(counterpartId(item) ?? '');
  const me = item.quote.speaker && item.ownerId === 'me' ? item.quote.speaker : 'You';
  if (item.kind !== 'promise') return person ? <><Avatar name={person.name} size={size} /><span className="lp-who">{person.name}</span></> : null;
  if (item.ownerId === 'me') {
    return <><Avatar name={me} me size={size} /><span className="lp-owe">You owe</span>{person && <><Avatar name={person.name} size={size} /><span className="lp-who">{person.name}</span></>}</>;
  }
  return <>{person && <><Avatar name={person.name} size={size} /><span className="lp-who">{person.name}</span></>}<span className="lp-owe">owes you</span></>;
}

function PromiseSheet({ item, view, onChange }: { item: MemoryItem; view: MemoryView; onChange: (i: MemoryItem) => void }) {
  const { navigate, has } = useRouter();
  const close = useCloseSheet();
  const calendar = useCalendar();
  const [dropping, setDropping] = useState(false);
  const now = world.now();
  const person = view.people.get(counterpartId(item) ?? '');
  const events = world.events ?? (calendar.status === 'ready' ? calendar.events : []);
  const before = item.kind === 'promise' ? nextMeetingWith(person, events, now) : undefined;
  const { tomorrow, nextWeek } = snoozeTimes(now);
  const chip = dueChip(item, now);
  const mention = item.history.at(-1);
  const edit: string = 'reviewEdit';
  const tasks: string = 'sendTasks';
  const canSnooze = item.kind === 'promise' && item.status === 'open';
  const owedToYou = item.kind === 'promise' && item.ownerId !== 'me';

  const snooze = async (until: number) => {
    if (!(await apply(item, { type: 'snooze', until }))) return;
    toastOnHome(`Snoozed “${item.text}” to ${weekdayDate(until)}`, item);
    close();
  };
  const done = async () => {
    if (!(await apply(item, item.kind === 'question' ? { type: 'answer' } : { type: 'done' }))) return;
    toastOnHome(`Marked “${item.text}” as done`, item);
    close();
  };
  const drop = async (reason: 'notNeeded' | 'someoneElse') => {
    const next = await apply(item, { type: 'drop', reason });
    if (next) { onChange(next); close(); }
  };

  return (
    <Sheet label="Promise detail" onClose={close}>
      <div className="lp-sheet-head">
        <div className="lp-sheet-title"><KindTag kind={item.kind} /><h1>{item.text}</h1></div>
        <CloseButton onClose={close} />
      </div>
      <div className="lp-fromto">
        <FromTo item={item} view={view} />
        <span className="lp-grow" />
        <DueChip chip={chip} />
        {item.due && <span className="lp-due-date">{weekdayDate(fromIso(item.due))}</span>}
      </div>
      <QuoteBlock quote={item.quote} meetings={view.meetings} />
      {mention && (
        <p className="lp-mention"><strong>Mentioned again</strong> in {meetingLine(mention.meetingId, view.meetings)}: “{mention.text}”</p>
      )}
      {canSnooze && (
        <div className="lp-snooze">
          <span className="lp-label">Snooze</span>
          <div className="lp-pills">
            <button type="button" className="lp-pill" onClick={() => void snooze(tomorrow)}><span>Tomorrow</span></button>
            <button type="button" className="lp-pill" onClick={() => void snooze(nextWeek)}><span>Next week</span></button>
          </div>
          {before && person && (
            <button type="button" className="lp-pill lp-pill-wide" onClick={() => void snooze(before.start)}>
              <span>{`Before my next meeting with ${firstName(person.name)}`}</span>
            </button>
          )}
        </div>
      )}
      <div className="lp-actions">
        <button type="button" className="lp-primary" onClick={() => void done()}><BigCheck />Mark done</button>
        <div className="lp-actions-grid">
          <button type="button" className="lp-secondary" aria-disabled={!has(edit) || undefined}
            onClick={() => { if (has(edit)) navigate(edit, { itemId: item.id }); }}>Edit</button>
          <button type="button" className="lp-secondary" aria-disabled={!has(tasks) || undefined}
            onClick={() => { if (has(tasks)) navigate(tasks, { itemId: item.id }); }}>Send to Google Tasks</button>
        </div>
        {owedToYou && person && (
          <button type="button" className="lp-secondary" onClick={() => navigate('nudge', { itemId: item.id })}>{`Nudge ${firstName(person.name)}`}</button>
        )}
      </div>
      {item.kind === 'promise' && (
        <div className="lp-drop">
          {dropping ? (
            <>
              <button type="button" className="lp-drop-link" onClick={() => void drop('notNeeded')}>No longer needed</button>
              <button type="button" className="lp-drop-link" onClick={() => void drop('someoneElse')}>Someone else took it</button>
            </>
          ) : (
            <>
              <button type="button" className="lp-drop-link" aria-expanded={false} onClick={() => setDropping(true)}>Drop this promise</button>
              <span className="lp-drop-hint">No longer needed · Someone else took it</span>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

export default function PromiseScreen() {
  const [item, setItem] = useSheetItem();
  const [view] = useMemoryView();
  return (
    <LoopsHome tab={item ? tabOf(item) : undefined} sheet>
      {item && view.ready && <PromiseSheet item={item} view={view} onChange={setItem} />}
    </LoopsHome>
  );
}
