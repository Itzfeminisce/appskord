import { useEffect, useState } from 'react';
import { transition } from '@/lib/memory/promise';
import type { MemoryItem } from '@/lib/memory/types';
import { BackIcon } from '../../components/v4/icons';
import { dayLabel, DUE_LABEL, dueFor, initials, meetingPeople, quoteMeta, type DueChoice } from '../../components/v4/review';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { loadReview, saveItem, type ReviewData } from './Review';
import '../../components/v4/shell.css';
import './review.css';

const QUICK: DueChoice[] = ['today', 'tomorrow', 'friday', 'nextWeek'];
const TITLE: Record<MemoryItem['kind'], string> = { promise: 'Edit promise', decision: 'Edit decision', question: 'Edit question' };

interface Draft { text: string; ownerId?: string; toId?: string; due?: string }

export default function ReviewEdit() {
  const { route, back, canGoBack, replace } = useRouter();
  const meetingId = route.params.meetingId ?? '';
  const [data, setData] = useState<ReviewData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const item = data?.items.find((i) => i.id === route.params.itemId);

  useEffect(() => {
    loadReview(meetingId)
      .then((d) => {
        if (!d) return;
        setData(d);
        const i = d.items.find((x) => x.id === route.params.itemId);
        if (i) setDraft({ text: i.text, ownerId: i.ownerId, toId: i.toId, due: i.due });
      })
      .catch((error) => console.error('Rekord: could not load the promise', error));
  }, [meetingId, route.params.itemId]);

  const leave = () => (canGoBack ? back() : replace('review', { meetingId }));
  if (!data || !item || !draft) return <div className="v4-shell" />;

  const now = world.now();
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const pickers = [{ id: 'me', name: 'You', mark: 'A' }, ...meetingPeople(data.people, meetingId, data.items).map((p) => ({ id: p.id, name: p.name, mark: initials(p.name) }))];
  const quick = QUICK.find((c) => draft.due === dueFor(c, now));
  const picked = !!draft.due && !quick;

  const save = async () => {
    const text = draft.text.trim() || item.text;
    const changes = item.kind === 'promise' ? { text, ownerId: draft.ownerId, toId: draft.toId, due: draft.due } : { text };
    try {
      await saveItem(transition(item, { type: 'edit', changes }, now));
      leave();
    } catch (error) {
      console.error('Rekord: could not save the promise', error);
    }
  };

  const people = (label: string, id: string, value: string | undefined, onPick: (v: string) => void) => (
    <div className="re-field">
      <span id={id} className="re-label">{label}</span>
      <div role="radiogroup" aria-labelledby={id} className="re-radios">
        {pickers.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={value === p.id} className="re-radio re-person" onClick={() => onPick(p.id)}>
            <span><span className="re-avatar">{p.mark}</span>{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="v4-shell">
      <header className="rv-head">
        <button type="button" className="v4-icon rv-back" aria-label="Back to review" onClick={leave}><BackIcon /></button>
        <h1 className="re-title">{TITLE[item.kind]}</h1>
      </header>
      <div className="re-body">
        <section className="re-card">
          <div className="re-field re-what">
            <label htmlFor="re-what" className="re-label">What</label>
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
