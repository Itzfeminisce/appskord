import { useEffect, useState } from 'react';
import { itemsForPerson, mergePeople, splitPerson } from '@/lib/memory/store';
import type { Person, Quote } from '@/lib/memory/types';
import type { Meeting } from '@/lib/types';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { addNotSame, Avatar, BackArrow, refreshBadge, usePeopleData, type PeopleData } from './PeopleParts';
import { dayMonth, firstName, lastQuoteBy, pairKey, quoteMeta } from './peopleView';

function Candidate({ person, data, quote }: { person: Person; data: PeopleData; quote?: Quote }) {
  const meeting = quote && data.meetings.find((m) => m.id === quote.meetingId);
  return (
    <div className="pm-card">
      <Avatar person={person} size={36} font={15} />
      <div className="pm-card-text">
        <span className="pm-card-name">{person.name}</span>
        <span className="pm-card-email">{person.email ?? 'No email'}</span>
        <span className="pm-card-count"><span className="pp-mono">{person.meetingIds.length}</span> meetings</span>
      </div>
      {quote && (
        <div className="pm-quote"><span className="pm-quote-text">{`“${quote.text}”`}</span><span className="pm-quote-meta">{quoteMeta(quote, meeting)}</span></div>
      )}
    </div>
  );
}

/** Their own words, else the latest quote from an item that names them and that the other card does not show. */
function useQuote(person: Person | undefined, data: PeopleData | undefined, avoid?: Quote): Quote | undefined {
  const [linked, setLinked] = useState<Quote>();
  const own = person && data ? lastQuoteBy(person, data.items, data.meetings) : undefined;
  useEffect(() => {
    if (!person || own) return;
    itemsForPerson(person.id)
      .then((items) => setLinked(items.filter((i) => !i.leftOut && i.quote.text !== avoid?.text).sort((a, b) => b.createdAt - a.createdAt)[0]?.quote))
      .catch((error) => console.error('Rekord: could not load quotes', error));
  }, [person, own, avoid]);
  return own ?? linked;
}

/** V4PersonMerge: "Same person?" with both people side by side, and the split list for the first one. */
export default function PersonMerge() {
  const { route, navigate, back } = useRouter();
  const [data] = usePeopleData();
  const person = data?.people.find((p) => p.id === route.params.personId);
  const other = data?.people.find((p) => p.id === route.params.otherId);
  const quoteA = useQuote(person, data);
  const quoteB = useQuote(other, data, quoteA);
  // Nothing moves until the user picks meetings.
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => { if (data && !person) back(); }, [data, person, back]);
  if (!data || !person) return <div className="pp-page" />;

  const now = world.now();
  const theirMeetings = person.meetingIds.map((id) => data.meetings.find((m) => m.id === id)).filter((m): m is Meeting => !!m)
    .sort((a, b) => b.startedAt - a.startedAt);
  const moving = theirMeetings.filter((m) => checked.includes(m.id)).map((m) => m.id);
  const canSplit = moving.length > 0 && moving.length < theirMeetings.length;

  const merge = async () => {
    if (!other || busy) return;
    setBusy(true);
    // The one with an email stays; the loose name becomes an alias.
    const [keep, drop] = person.email && !other.email ? [person, other] : [other, person];
    const merged = await mergePeople(keep.id, drop.id, now).catch((error) => console.error('Rekord: could not merge people', error));
    refreshBadge();
    setBusy(false);
    setFailed(!merged);
    if (merged) navigate('person', { personId: merged.id });
  };
  const different = async () => {
    if (other) await addNotSame(pairKey(person.id, other.id)).catch((error) => console.error('Rekord: could not save the choice', error));
    back();
  };
  const split = async () => {
    if (!canSplit || busy) return;
    setBusy(true);
    const fresh = { id: `p-${crypto.randomUUID()}`, name: person.name };
    const created = await splitPerson(person.id, moving, fresh, now).catch((error) => console.error('Rekord: could not split meetings out', error));
    refreshBadge();
    setBusy(false);
    setFailed(!created);
    if (created) navigate('person', { personId: created.id });
  };

  return (
    <div className="pp-page">
      <header className="pp-head">
        <button type="button" className="v4-icon pp-dark" aria-label="Back to People" onClick={() => back()}><BackArrow /></button>
        <span className="pp-head-title">{other ? 'Same person?' : person.name}</span>
      </header>
      <main className="pm-body">
        {failed && <p className="rd-error" role="alert">Rekord couldn’t save that change. Try again.</p>}
        {other && (
          <>
            <p className="pm-lead">Merging puts their meetings and promises on one page.</p>
            <div className="pm-cards">
              <Candidate person={person} data={data} quote={quoteA} />
              <Candidate person={other} data={data} quote={quoteB} />
            </div>
            <div className="pm-actions">
              <button type="button" className="pm-merge" disabled={busy} onClick={() => void merge()}>Same person, merge</button>
              <button type="button" className="pm-different" onClick={() => void different()}>Different people</button>
            </div>
          </>
        )}
        <section aria-label="Split meetings" className="pm-split">
          <h2>Or split {firstName(person.name)}’s meetings out</h2>
          {theirMeetings.map((m) => (
            <label key={m.id} htmlFor={`pm-${m.id}`} className="pm-check">
              <input
                id={`pm-${m.id}`} type="checkbox" checked={checked.includes(m.id)}
                onChange={(e) => setChecked(e.target.checked ? [...checked, m.id] : checked.filter((id) => id !== m.id))}
              />
              <span className="pm-check-title">{m.title}</span>
              <span className="pm-check-date">{dayMonth(m.startedAt)}</span>
            </label>
          ))}
          <button type="button" className="pm-move" disabled={!canSplit || busy} onClick={() => void split()}>
            Move {moving.length} {moving.length === 1 ? 'meeting' : 'meetings'} to a new person
          </button>
        </section>
      </main>
    </div>
  );
}
