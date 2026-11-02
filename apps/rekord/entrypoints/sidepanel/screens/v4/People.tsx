import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../../components/v4/Shell';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { Avatar, ChevronIcon, FindIcon, PairIcon, peopleFlash, readNotSame, useEvents, usePeopleData } from './PeopleParts';
import { dayMonth, matchesSearch, openSuggestions, personRows } from './peopleView';

/** V4People: search, the same-person banner and everyone you meet, next meeting first. */
export default function People() {
  const { navigate } = useRouter();
  const [data] = usePeopleData();
  const events = useEvents();
  const [query, setQuery] = useState('');
  const [notSame, setNotSame] = useState<string[]>([]);
  const [flash, setFlash] = useState(peopleFlash.message);

  useEffect(() => {
    void readNotSame().then(setNotSame);
    peopleFlash.message = undefined;
    if (!flash) return;
    const timer = setTimeout(() => setFlash(undefined), 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = world.now();
  const rows = useMemo(() => (data ? personRows(data.people, data.items, data.meetings, events, now) : []), [data, events, now]);
  const pairs = useMemo(() => (data ? openSuggestions(data.people, notSame) : []), [data, notSame]);
  const checking = new Set(pairs.flatMap(([a, b]) => [a.id, b.id])).size;
  const shown = rows.filter((r) => matchesSearch(r.person, query));

  return (
    <Shell tab="people">
      <div className="pp-list">
        <div className="pp-search">
          <label htmlFor="pp-search" className="pp-hidden">Search people</label>
          <span className="pp-search-icon"><FindIcon /></span>
          <input id="pp-search" type="search" placeholder="Search people" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {pairs[0] && (
          <button type="button" className="pp-banner" onClick={() => navigate('personMerge', { personId: pairs[0]![0].id, otherId: pairs[0]![1].id })}>
            <span className="pp-banner-icon"><PairIcon /></span>
            <span className="pp-banner-text">{checking} people to check: are they the same person?</span>
            <span className="pp-banner-icon"><ChevronIcon /></span>
          </button>
        )}
        {shown.length > 0 && (
          <section aria-label="People" className="pp-card">
            {shown.map(({ person, line, open, lastMet }) => (
              <button key={person.id} type="button" className="pp-row" onClick={() => navigate('person', { personId: person.id })}>
                <Avatar person={person} />
                <span className="pp-row-text">
                  <span className="pp-row-name">{person.name}</span>
                  <span className="pp-row-line">{line}</span>
                </span>
                <span className="pp-row-side">
                  {open > 0 ? <span className="pp-open">{open} open</span> : <span className="pp-none">Nothing open</span>}
                  {lastMet !== undefined && <span className="pp-met">met {dayMonth(lastMet)}</span>}
                </span>
              </button>
            ))}
          </section>
        )}
      </div>
      {flash && <div role="status" className="pp-toast">{flash}</div>}
    </Shell>
  );
}
