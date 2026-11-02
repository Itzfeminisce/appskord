import { useEffect, useState } from 'react';
import { transition } from '@/lib/memory/promise';
import type { MemoryItem } from '@/lib/memory/types';
import { BackIcon } from '../../components/v4/icons';
import { dayLabel, DUE_LABEL, dueFor, initials, meetingPeople, quoteMeta, type DueChoice } from '../../components/v4/review';
import { dayMonth } from './loops';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { loadReview, saveItem, type ReviewData } from './Review';
import '../../components/v4/shell.css';
import './review.css';

const QUICK: DueChoice[] = ['today', 'tomorrow', 'friday', 'nextWeek'];
const TITLE: Record<MemoryItem['kind'], string> = { promise: 'Edit promise', decision: 'Edit decision', question: 'Edit question' };

interface Draft { text: string; ownerId?: string; toId?: string; due?: string; replacesId?: string; personIds: string[] }
const LABEL: Record<MemoryItem['kind'], string> = { promise: 'What', decision: 'What was decided', question: 'Question' };

/** Who asked a question: its asker, else the person whose name the quote's speaker matches. */
function askerOf(item: MemoryItem, people: { id: string; name: string; aliases: string[] }[]): string | undefined {
  if (item.toId) return item.toId;
  const speaker = item.quote.speaker.toLowerCase();
  return people.find((p) => [p.name, ...p.aliases].some((n) => n.toLowerCase() === speaker || n.toLowerCase().split(' ')[0] === speaker))?.id ?? item.personIds[0];
}

function draftOf(item: MemoryItem, data: ReviewData): Draft {
  if (item.kind === 'question') return { text: item.text, toId: askerOf(item, data.people), ownerId: item.ownerId ?? 'me', personIds: item.personIds };
  return { text: item.text, ownerId: item.ownerId, toId: item.toId, due: item.due, replacesId: item.replacesId, personIds: item.personIds };
}

/** The edit's changes: a question's people are its asker and who should answer. */
export function editChanges(item: MemoryItem, draft: Draft): Parameters<typeof transition>[1] & { type: 'edit' } {
  const text = draft.text.trim() || item.text;
  if (item.kind === 'promise') return { type: 'edit', changes: { text, ownerId: draft.ownerId, toId: draft.toId, due: draft.due } };
  // 'me' goes last, so the first person is still the one the decision is with.
  if (item.kind === 'decision') return { type: 'edit', changes: { text, replacesId: draft.replacesId, personIds: [...draft.personIds.filter((id) => id !== 'me'), ...draft.personIds.filter((id) => id === 'me')] } };
  const personIds = [...new Set([draft.toId, draft.ownerId].filter((id): id is string => !!id && id !== 'me'))];
  return { type: 'edit', changes: { text, toId: draft.toId, ownerId: draft.ownerId, personIds } };
}

export default function ReviewEdit() {
  const { route, back, canGoBack, replace } = useRouter();
  const meetingId = route.params.meetingId ?? '';
  return <ReviewEditForm meetingId={meetingId} itemId={route.params.itemId} onLeave={() => (canGoBack ? back() : replace('review', { meetingId }))} />;
}

/** V4ReviewEdit and V4ReviewEditMore: edit a promise, a decision or a question before it is kept. */
export function ReviewEditForm({ meetingId, itemId, onLeave: leave }: { meetingId: string; itemId?: string; onLeave: () => void }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const item = data?.items.find((i) => i.id === itemId);

  useEffect(() => {
    loadReview(meetingId)
      .then((d) => {
        if (!d) return;
        setData(d);
        const i = d.items.find((x) => x.id === itemId);
        if (i) setDraft(draftOf(i, d));
      })
      .catch((error) => console.error('Rekord: could not load the promise', error));
  }, [meetingId, itemId]);

  if (!data || !item || !draft) return <div className="v4-shell" />;

  const now = world.now();
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const pickers = [{ id: 'me', name: 'You', mark: 'A' }, ...meetingPeople(data.people, meetingId, data.items).map((p) => ({ id: p.id, name: p.name, mark: initials(p.name) }))];
  const quick = QUICK.find((c) => draft.due === dueFor(c, now));
  const picked = !!draft.due && !quick;

  // The chosen one leads, then You, then the meeting's people.
  const chosenFirst = (ids: (string | undefined)[]) => [...pickers].sort((a, b) => Number(ids.includes(b.id)) - Number(ids.includes(a.id)));
  const replaced = item.replacesId ? data.all.find((i) => i.id === item.replacesId) : undefined;
  const replacedOn = replaced && (replaced.meetingId === data.meeting.id ? data.meeting.startedAt : replaced.createdAt);

  const save = async () => {
    try {
      await saveItem(transition(item, editChanges(item, draft), now));
      leave();
    } catch (error) {
      console.error('Rekord: could not save the promise', error);
    }
  };

  const people = (label: string, id: string, value: string | undefined, onPick: (v: string) => void, list = pickers) => (
    <div className="re-field">
      <span id={id} className="re-label">{label}</span>
      <div role="radiogroup" aria-labelledby={id} className="re-radios">
        {list.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={value === p.id} className="re-radio re-person" onClick={() => onPick(p.id)}>
            <span><span className="re-avatar">{p.mark}</span>{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
  const decided = (id: string) => draft.personIds.includes(id);
  const toggleDecided = (id: string) => set({ personIds: draft.personIds.includes(id) ? draft.personIds.filter((p) => p !== id) : [...draft.personIds, id] });

  return (
    <div className="v4-shell">
      <header className="rv-head">
        <button type="button" className="v4-icon rv-back" aria-label="Back to review" onClick={leave}><BackIcon /></button>
        <h1 className="re-title">{TITLE[item.kind]}</h1>
      </header>
      <div className="re-body">
        <section className="re-card">
          <div className="re-field re-what">
            <label htmlFor="re-what" className="re-label">{LABEL[item.kind]}</label>
            <input id="re-what" type="text" className="re-input" value={draft.text} onChange={(e) => set({ text: e.target.value })} />
          </div>
          {item.kind === 'promise' && (
            <>
              {people('Who owes it', 're-owes', draft.ownerId, (ownerId) => set({ ownerId }))}
              {people('Who is it owed to', 're-owed', draft.toId, (toId) => set({ toId }))}
              <div className="re-field">
                <span id="re-when" className="re-label">By when</span>
                <div role="radiogroup" aria-labelledby="re-when" className="re-radios">
                  {QUICK.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={quick === c} className="re-radio" onClick={() => set({ due: dueFor(c, now) })}>
                      <span>{DUE_LABEL[c]}</span>
                    </button>
                  ))}
                  {picking ? (
                    <input type="date" className="rv-date" aria-label="Pick a date" autoFocus value={draft.due ?? ''}
                      onChange={(e) => { if (e.target.value) { set({ due: e.target.value }); setPicking(false); } }} />
                  ) : (
                    <button type="button" role="radio" aria-checked={picked} className="re-radio" onClick={() => setPicking(true)}>
                      <span>{picked ? dayLabel(draft.due!) : 'Pick a date'}</span>
                    </button>
                  )}
                  <button type="button" role="radio" aria-checked={!draft.due} className="re-radio" onClick={() => set({ due: undefined })}>
                    <span>No date</span>
                  </button>
                </div>
                {!draft.due && <span className="re-hint">Promises with a date get done far more often.</span>}
              </div>
            </>
          )}
          {item.kind === 'decision' && (
            <>
              <div className="re-field">
                <span id="re-replaces" className="re-label">Replaces</span>
                <div role="radiogroup" aria-labelledby="re-replaces" className="re-radios">
                  {replaced && (
                    <button type="button" role="radio" aria-checked={draft.replacesId === replaced.id} className="re-radio" onClick={() => set({ replacesId: replaced.id })}>
                      <span>{`${replaced.text} · ${dayMonth(replacedOn!)}`}</span>
                    </button>
                  )}
                  <button type="button" role="radio" aria-checked={!draft.replacesId} className="re-radio" onClick={() => set({ replacesId: undefined })}>
                    <span>Nothing, it’s new</span>
                  </button>
                </div>
              </div>
              <div className="re-field">
                <span id="re-decided" className="re-label">Who decided</span>
                <div role="group" aria-labelledby="re-decided" className="re-radios">
                  {chosenFirst(item.personIds).map((p) => (
                    <button key={p.id} type="button" role="checkbox" aria-checked={decided(p.id)} className="re-radio re-person" onClick={() => toggleDecided(p.id)}>
                      <span><span className="re-avatar">{p.mark}</span>{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {item.kind === 'question' && (
            <>
              {people('Who asked', 're-asked', draft.toId, (toId) => set({ toId }), chosenFirst([askerOf(item, data.people)]))}
              <div className="re-field">
                <span id="re-answer" className="re-label">Who should answer</span>
                <div role="radiogroup" aria-labelledby="re-answer" className="re-radios">
                  {chosenFirst([item.ownerId ?? 'me']).map((p) => (
                    <button key={p.id} type="button" role="radio" aria-checked={draft.ownerId === p.id} className="re-radio re-person" onClick={() => set({ ownerId: p.id })}>
                      <span><span className="re-avatar">{p.mark}</span>{p.name}</span>
                    </button>
                  ))}
                </div>
                <span className="re-hint">You is the default.</span>
              </div>
            </>
          )}
        </section>
        <div className="re-said">
          <span className="re-label">What was said</span>
          <span className="re-said-text">{`${item.quote.speaker}: “${item.quote.text}”`}</span>
          <span className="re-said-meta">{quoteMeta(item.quote, data.meeting)}</span>
        </div>
      </div>
      <div className="re-foot">
        <button type="button" className="re-cancel" onClick={leave}>Cancel</button>
        <button type="button" className="re-save" onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}
