import { useEffect, useState } from 'react';
import { isCatchup } from '@/lib/catchup/label';
import { readQuestions } from '@/lib/catchup/pipeline';
import { getMeeting } from '@/lib/db';
import { transition, type ItemEvent } from '@/lib/memory/promise';
import { tabOf } from '@/lib/memory/rank';
import { getItem, putItem } from '@/lib/memory/store';
import type { MemoryItem, Quote } from '@/lib/memory/types';
import { useCalendar } from '../../components/CalendarCard';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { LoopsHome, toastOnHome } from './Home';
import { counterpartId, dueChip, firstName, fromIso, initials, meetingLine, myName, nextMeetingWith, snoozeTimes, weekdayDate } from './loops';
import { AnswerBlock, Avatar, BigCheck, CloseButton, DueChip, KindTag, PromiseIcon, QuoteBlock, refreshBadge, Sheet, useCloseSheet, useMemoryView, type MemoryView } from './parts';

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
  const mine = myName(view.items) ?? 'You';
  return <>{person && <><Avatar name={person.name} size={size} /><span className="lp-who">{person.name}</span></>}<span className="lp-owe">owes you</span><Avatar name={mine} me size={size} /></>;
}

/** The follow-up question a catch-up answer replied to, found by the answer's words. */
function useAnswerQuestion(meetingId: string, answer: Quote | undefined): string | undefined {
  const [question, setQuestion] = useState<string>();
  const answerText = answer?.text;
  const answerMeeting = answer?.meetingId;
  useEffect(() => {
    let alive = true;
    if (answerText === undefined || answerMeeting !== meetingId) { setQuestion(undefined); return; }
    void (async () => {
      const [meeting, asked] = await Promise.all([getMeeting(meetingId), readQuestions(meetingId)]);
      const id = meeting?.told?.answers?.find((a) => a.text === answerText)?.questionId;
      if (alive) setQuestion(asked?.questions.find((q) => q.id === id)?.text);
    })().catch((error) => console.error('Rekord: could not read the question this answered', error));
    return () => { alive = false; };
  }, [meetingId, answerText, answerMeeting]);
  return question;
}

const ToldNote = () => (
  <p className="lp-told">
    <span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /></svg></span>
    You told Rekord this after the meeting. It was not recorded in the meeting.
  </p>
);

export function PromiseSheet({ item, view }: { item: MemoryItem; view: MemoryView }) {
  const { navigate, has } = useRouter();
  const close = useCloseSheet();
  const calendar = useCalendar();
  const [snoozing, setSnoozing] = useState(false);
  const now = world.now();
  const person = view.people.get(counterpartId(item) ?? '');
  const events = world.events ?? (calendar.status === 'ready' ? calendar.events : []);
  const before = item.kind === 'promise' ? nextMeetingWith(person, events, now) : undefined;
  const { tomorrow, nextWeek } = snoozeTimes(now);
  const chip = dueChip(item, now);
  const mention = item.history.at(-1);
  const told = isCatchup(view.meetings.get(item.meetingId));
  const answered = useAnswerQuestion(item.meetingId, mention);
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
      {told && <ToldNote />}
      {mention && answered ? <AnswerBlock quote={mention} question={answered} meetings={view.meetings} /> : mention && (
        <p className="lp-mention"><strong>Mentioned again</strong>{` in ${meetingLine(mention.meetingId, view.meetings)}: “${mention.text}”`}</p>
      )}
      {canSnooze && (!owedToYou || snoozing) && (
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
      {owedToYou && person ? (
        <div className="lp-actions">
          <button type="button" className="lp-primary" onClick={() => navigate('nudge', { itemId: item.id })}><PromiseIcon size={18} />{`Nudge ${firstName(person.name)}`}</button>
          <div className="lp-actions-grid lp-actions-even">
            <button type="button" className="lp-secondary" onClick={() => void done()}>Mark done</button>
            <button type="button" className="lp-secondary" aria-expanded={snoozing} disabled={!canSnooze} onClick={() => setSnoozing(!snoozing)}>Snooze</button>
            <button type="button" className="lp-secondary" aria-disabled={!has(edit) || undefined}
              onClick={() => { if (has(edit)) navigate(edit, { itemId: item.id }); }}>Edit</button>
            <button type="button" className="lp-secondary" aria-disabled={!has(tasks) || undefined}
              onClick={() => { if (has(tasks)) navigate(tasks, { itemId: item.id }); }}>Send to Google Tasks</button>
          </div>
        </div>
      ) : (
        <div className="lp-actions">
          <button type="button" className="lp-primary" onClick={() => void done()}><BigCheck />Mark done</button>
          <div className="lp-actions-grid">
            <button type="button" className="lp-secondary" aria-disabled={!has(edit) || undefined}
              onClick={() => { if (has(edit)) navigate(edit, { itemId: item.id }); }}>Edit</button>
            <button type="button" className="lp-secondary" aria-disabled={!has(tasks) || undefined}
              onClick={() => { if (has(tasks)) navigate(tasks, { itemId: item.id }); }}>Send to Google Tasks</button>
          </div>
        </div>
      )}
      {item.kind === 'promise' && (
        <div className="lp-drop">
          <button type="button" className="lp-drop-link" onClick={() => navigate('promiseDrop', { itemId: item.id })}>Drop this promise</button>
          {!owedToYou && <span className="lp-drop-hint">No longer needed · Someone else took it</span>}
        </div>
      )}
    </Sheet>
  );
}

const DROP_REASONS: { id: NonNullable<MemoryItem['dropReason']>; label: string }[] = [
  { id: 'notNeeded', label: 'No longer needed' }, { id: 'someoneElse', label: 'Someone else took it' }, { id: 'notAPromise', label: 'It was never a promise' },
];

/** "You owe Dana Ruiz · Intro with Lumen · 29 Oct" or "Sarah Chen owes you · …". */
function dropLine(item: MemoryItem, view: MemoryView): string {
  const person = view.people.get(counterpartId(item) ?? '');
  const who = item.ownerId === 'me' ? (person ? `You owe ${person.name}` : 'You owe') : `${person?.name ?? 'They'} owes you`;
  return `${who} · ${meetingLine(item.meetingId, view.meetings)}`;
}

/** V4PromiseDrop: why the promise goes; it leaves Open loops with "Dropped. Undo". */
function DropSheet({ item, view }: { item: MemoryItem; view: MemoryView }) {
  const { back, replace } = useRouter();
  const [reason, setReason] = useState<NonNullable<MemoryItem['dropReason']>>('notNeeded');
  const person = view.people.get(counterpartId(item) ?? '');
  const drop = async () => {
    if (!(await apply(item, { type: 'drop', reason }))) return;
    toastOnHome('Dropped.', item);
    replace('home');
  };
  return (
    <Sheet label="Drop this promise?" onClose={back} className="lp-sheet-form">
      <h1 className="lp-drop-title">Drop this promise?</h1>
      <div className="lp-drop-item">
        {person && <span aria-hidden="true" className="lp-avatar lp-drop-avatar">{initials(person.name)}</span>}
        <span className="lp-drop-item-text"><span className="lp-drop-item-title">{item.text}</span><span className="lp-drop-item-line">{dropLine(item, view)}</span></span>
      </div>
      <div role="radiogroup" aria-label="Why drop it" className="lp-reasons">
        {DROP_REASONS.map((r) => (
          <label key={r.id} htmlFor={`lp-why-${r.id}`} className={r.id === reason ? 'lp-reason lp-reason-on' : 'lp-reason'}>
            <input id={`lp-why-${r.id}`} name="lp-why" type="radio" value={r.id} checked={r.id === reason} onChange={() => setReason(r.id)} />{r.label}
          </label>
        ))}
      </div>
      <p className="lp-drop-note">{`Dropped promises leave Open loops.${person ? ` You can find them in ${firstName(person.name)}’s page.` : ''}`}</p>
      <div className="lp-actions">
        <button type="button" className="lp-danger" onClick={() => void drop()}>Drop</button>
        <button type="button" className="lp-secondary" onClick={back}>Keep it</button>
      </div>
    </Sheet>
  );
}

export function PromiseDrop() {
  const [item] = useSheetItem();
  const [view] = useMemoryView();
  return (
    <LoopsHome tab={item ? tabOf(item) : undefined} sheet>
      {item && view.ready && <DropSheet item={item} view={view} />}
    </LoopsHome>
  );
}

export default function PromiseScreen() {
  const [item] = useSheetItem();
  const [view] = useMemoryView();
  return (
    <LoopsHome tab={item ? tabOf(item) : undefined} sheet>
      {item && view.ready && <PromiseSheet item={item} view={view} />}
    </LoopsHome>
  );
}
