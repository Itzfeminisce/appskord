import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { getMeeting } from '@/lib/db';
import { transition } from '@/lib/memory/promise';
import { deleteItem, itemsForMeeting, listItems, listPeople, mergePeople, putItem } from '@/lib/memory/store';
import type { MemoryItem, Person } from '@/lib/memory/types';
import type { Meeting } from '@/lib/types';
import { BackIcon, CheckIcon } from '../../components/v4/icons';
import { ChoiceChip, Chip, CloseIcon, EditIcon, KindPill, QuoteBlock } from '../../components/v4/memory';
import {
  confirmable, dueChip, dueFor, firstName, GROUPS, meetingPeople, movedFrom, ownerChip, personSuggestions, quoteMeta, reviewedPeopleKey,
  reviewItems, shortDate, type PersonSuggestion,
} from '../../components/v4/review';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import '../../components/v4/shell.css';
import './review.css';

export interface ReviewData { meeting: Meeting; items: MemoryItem[]; all: MemoryItem[]; people: Person[]; reviewed: string[] }

export async function loadReview(meetingId: string): Promise<ReviewData | undefined> {
  const [meeting, items, all, people, stored] = await Promise.all([
    getMeeting(meetingId), itemsForMeeting(meetingId), listItems(), listPeople(),
    browser.storage.local.get(reviewedPeopleKey(meetingId)),
  ]);
  if (!meeting) return undefined;
  return { meeting, items, all, people, reviewed: (stored[reviewedPeopleKey(meetingId)] as string[] | undefined) ?? [] };
}

/** Saves one item and asks the background to refresh the toolbar badge. */
export async function saveItem(item: MemoryItem): Promise<void> {
  await putItem(item);
  browser.runtime.sendMessage({ type: 'rekord.badge.refresh' }).catch(() => undefined);
}

async function markReviewed(meetingId: string, ids: string[]) {
  const key = reviewedPeopleKey(meetingId);
  const stored = ((await browser.storage.local.get(key))[key] as string[] | undefined) ?? [];
  await browser.storage.local.set({ [key]: [...new Set([...stored, ...ids])] });
}

/** Confirms a suggestion; a promise that moves an earlier one's date updates that promise instead. */
async function confirmItem(item: MemoryItem, all: MemoryItem[], now: number) {
  const moved = movedFrom(item, all);
  if (!moved) return saveItem(transition(item, { type: 'confirm' }, now));
  await saveItem({ ...moved, due: item.due, history: [...moved.history, item.quote], updatedAt: now });
  await deleteItem(item.id);
}

async function acceptPerson(meetingId: string, s: PersonSuggestion, now: number) {
  if (s.type === 'same') await mergePeople(s.person.id, s.loose.id, now);
  await markReviewed(meetingId, [s.type === 'same' ? s.loose.id : s.person.id]);
}

export default function Review() {
  const { route, navigate, replace, back, canGoBack } = useRouter();
  const meetingId = route.params.meetingId ?? '';
  const [data, setData] = useState<ReviewData | null>(null);
  const [dismissed, setDismissed] = useState<MemoryItem[]>([]);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    loadReview(meetingId)
      .then((d) => d && setData(d))
      .catch((error) => console.error('Rekord: could not load what Rekord found', error));
  }, [meetingId]);
  useEffect(reload, [reload]);

  const run = (step: () => Promise<unknown>) => {
    setSaving(true);
    void step().then(reload).catch((error) => console.error('Rekord: could not save your review', error)).finally(() => setSaving(false));
  };
  const leave = () => (canGoBack ? back() : replace('summary', { meetingId }));

  if (!data) return <div className="v4-shell" />;
  const { meeting, all, people } = data;
  const now = world.now();
  const gonePending = new Set(dismissed.map((i) => i.id));
  const found = reviewItems(data.items);
  const waiting = found.waiting.filter((i) => !gonePending.has(i.id));
  const { leftOut } = found;
  const suggestions = personSuggestions(people, meetingId, data.reviewed);
  const total = waiting.length + suggestions.length;
  const sure = confirmable(suggestions);
  const allCount = waiting.length + sure.length;
  const nameOf = (id?: string) => people.find((p) => p.id === id)?.name;
  const here = meetingPeople(people, meetingId, data.items);
  const play = (item: MemoryItem) => navigate('transcript', { meetingId: item.quote.meetingId, atMs: item.quote.atMs });
  const edit = (item: MemoryItem) => saveItem(item);

  const confirmAll = () => {
    if (saving) return;
    run(async () => {
      for (const item of waiting) await confirmItem(item, all, now);
      for (const s of sure) await acceptPerson(meetingId, s, now);
      if (sure.length === suggestions.length) replace('summary', { meetingId });
    });
  };
  const dismiss = (item: MemoryItem) => {
    setDismissed((d) => [...d, { ...item, status: 'dismissed' }]);
    run(() => saveItem({ ...item, status: 'dismissed', updatedAt: now }));
  };
  const reason = (item: MemoryItem, why: NonNullable<MemoryItem['dismissReason']>) => run(async () => {
    await saveItem({ ...item, status: 'dismissed', dismissReason: why, updatedAt: now });
    setDismissed((d) => d.map((x) => (x.id === item.id ? { ...x, dismissReason: why } : x)));
  });

  const card = (item: MemoryItem) => {
    const moved = movedFrom(item, all);
    const owner = ownerChip(item, nameOf);
    return (
      <article key={item.id} className="rv-card">
        <div className="rv-card-top">
          <h3>{item.text}</h3>
          <div className="rv-actions">
            <button type="button" aria-label="Confirm" className="rv-act rv-confirm" disabled={saving} onClick={() => run(() => confirmItem(item, all, now))}><CheckIcon size={18} /></button>
            <button type="button" aria-label="Edit" className="rv-act" onClick={() => navigate('reviewEdit', { meetingId, itemId: item.id })}><EditIcon /></button>
            <button type="button" aria-label="Dismiss" className="rv-act" onClick={() => dismiss(item)}><CloseIcon /></button>
          </div>
        </div>
        {item.kind === 'promise' && (
          <div className="rv-chips">
            {owner && <Chip tone="promise">{owner}</Chip>}
            <Chip tone={item.due ? 'plain' : 'warn'}>{dueChip(item, now, moved)}</Chip>
          </div>
        )}
        {item.kind === 'promise' && !item.ownerId && (
          <div className="rv-ask">
            <span className="rv-ask-label">Who owes this?</span>
            <div className="rv-ask-chips">
              <ChoiceChip onClick={() => run(() => edit(transition(item, { type: 'edit', changes: { ownerId: 'me' } }, now)))}>You</ChoiceChip>
              {here.map((p) => (
                <ChoiceChip key={p.id} onClick={() => run(() => edit(transition(item, { type: 'edit', changes: { ownerId: p.id } }, now)))}>{firstName(p.name)}</ChoiceChip>
              ))}
            </div>
          </div>
        )}
        {item.kind === 'promise' && !item.due && (
          <div className="rv-ask">
            <span className="rv-ask-label">By when?</span>
            <div className="rv-ask-chips">
              {(['today', 'friday'] as const).map((c) => (
                <ChoiceChip key={c} onClick={() => run(() => edit(transition(item, { type: 'edit', changes: { due: dueFor(c, now) } }, now)))}>
                  {c === 'today' ? 'Today' : 'Friday'}
                </ChoiceChip>
              ))}
              {picking === item.id ? (
                <input
                  type="date" className="rv-date" aria-label="Pick a date" autoFocus
                  onChange={(e) => { const due = e.target.value; if (due) { setPicking(null); run(() => edit(transition(item, { type: 'edit', changes: { due } }, now))); } }}
                />
              ) : (
                <ChoiceChip onClick={() => setPicking(item.id)}>Pick a date</ChoiceChip>
              )}
            </div>
          </div>
        )}
        {item.kind === 'decision' && item.replacesId && (() => {
          const old = all.find((i) => i.id === item.replacesId);
          return old ? <div className="rv-replaces"><span>Replaces:</span> {old.text} ({shortDate(old.createdAt)})</div> : null;
        })()}
        <QuoteBlock speaker={item.quote.speaker} text={item.quote.text} meta={quoteMeta(item.quote, meeting)} onPlay={() => play(item)} />
      </article>
    );
  };

  const gone = (item: MemoryItem) => (
    <article key={item.id} className="rv-card rv-gone">
      <h3>{item.text}</h3>
      <div className="rv-chips">
        <ChoiceChip dark={item.dismissReason === 'notAPromise'} onClick={() => reason(item, 'notAPromise')}>Not a promise</ChoiceChip>
        <ChoiceChip dark={item.dismissReason === 'wrongPerson'} onClick={() => reason(item, 'wrongPerson')}>Wrong person</ChoiceChip>
      </div>
    </article>
  );

  const personCard = (s: PersonSuggestion) => {
    const id = s.type === 'same' ? s.loose.id : s.person.id;
    const fromInvite = meeting.event?.attendees.some((a) => a.email && a.email === s.person.email);
    return (
      <article key={id} className="rv-card">
        <div className="rv-card-top">
          <h3>
            {s.type === 'same'
              ? `Is “${s.loose.name}” ${s.person.name}${s.person.email ? ` (${s.person.email})` : ''}?`
              : `New: ${s.person.name}${s.person.email ? ` · ${s.person.email}` : ''}`}
          </h3>
          <div className="rv-actions">
            {s.type === 'new' && (
              <button type="button" aria-label="Confirm" className="rv-act rv-confirm" disabled={saving} onClick={() => run(() => acceptPerson(meetingId, s, now))}><CheckIcon size={18} /></button>
            )}
            <button type="button" aria-label="Dismiss" className="rv-act" onClick={() => run(() => markReviewed(meetingId, [id]))}><CloseIcon /></button>
          </div>
        </div>
        {fromInvite && <div className="rv-chips"><Chip>From the invite</Chip></div>}
        {s.type === 'same' && (
          <div className="rv-yes">
            <ChoiceChip dark onClick={() => run(() => acceptPerson(meetingId, s, now))}>Yes</ChoiceChip>
            <ChoiceChip onClick={() => run(() => markReviewed(meetingId, [id]))}>Someone else</ChoiceChip>
          </div>
        )}
      </article>
    );
  };

  const groupHead = (key: string, pill: ReactNode, count: number) => (
    <div key={key} className="rv-group">{pill}<span className="rv-count">{count}</span></div>
  );

  return (
    <div className="v4-shell rv">
      <header className="rv-head">
        <button type="button" className="v4-icon rv-back" aria-label="Back to summary" onClick={leave}><BackIcon /></button>
        <h1>Rekord found {total} {total === 1 ? 'thing' : 'things'} in {meeting.title}</h1>
      </header>
      {allCount > 0 && (
        <div className="rv-bar">
          <button type="button" className="rv-all" disabled={saving} onClick={confirmAll}><CheckIcon size={18} />Confirm all {allCount}</button>
        </div>
      )}
      <div className="rv-list">
        {GROUPS.map(({ kind, label }) => {
          const list = waiting.filter((i) => i.kind === kind);
          const gone2 = dismissed.filter((i) => i.kind === kind);
          if (!list.length && !gone2.length) return null;
          return [groupHead(kind, <KindPill tone={kind}>{label}</KindPill>, list.length), ...list.map(card), ...gone2.map(gone)];
        })}
        {suggestions.length > 0 && [groupHead('people', <KindPill tone="person">People</KindPill>, suggestions.length), ...suggestions.map(personCard)]}
        {leftOut.length > 0 && (
          <>
            <button type="button" className="rv-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {leftOut.length} left out: their quote wasn’t in the transcript<span>Add anyway</span>
            </button>
            {open && leftOut.map((item) => (
              <article key={item.id} className="rv-card">
                <div className="rv-card-top">
                  <h3>{item.text}</h3>
                  <button type="button" className="rv-add" onClick={() => run(() => saveItem(transition(item, { type: 'confirm' }, now)))}>Add anyway</button>
                </div>
                <QuoteBlock speaker={item.quote.speaker} text={item.quote.text} meta={quoteMeta(item.quote, meeting)} onPlay={() => play(item)} />
              </article>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
