import { useEffect, useState } from 'react';
import { putPerson } from '@/lib/memory/store';
import { nextMeeting, seriesLine } from '@/lib/memory/series';
import type { MemoryItem, Person as PersonT } from '@/lib/memory/types';
import type { Meeting } from '@/lib/types';
import { RecordBar } from '../../components/v4/Shell';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { Avatar, BackArrow, CalIcon, DecisionIcon, HandOffIcon, MoreDots, useEvents, usePeopleData, type PeopleData } from './PeopleParts';
import { dayMonth, dueBadge, suggestionFor, firstName, lastQuoteBy, openPromises, quoteMeta, soonLabel } from './peopleView';

/** Dev frame routes open the page with its menu showing (V4Person). */
export const personView = { menuOpen: false };

function ItemRow({ item, meeting, now, kind }: { item: MemoryItem; meeting?: Meeting; now: number; kind: 'promise' | 'decision' }) {
  const { navigate } = useRouter();
  const badge = kind === 'promise' ? dueBadge(item, now) : undefined;
  return (
    <button type="button" className="pp-item" onClick={() => navigate('transcript', { meetingId: item.meetingId, atMs: item.quote.atMs })}>
      <span className={`pp-item-icon pp-item-${kind}`}>{kind === 'promise' ? <HandOffIcon /> : <DecisionIcon />}</span>
      <span className="pp-item-text">
        <span className="pp-item-title">{item.text}</span>
        <span className="pp-item-from">From {[meeting?.title, meeting && dayMonth(meeting.startedAt)].filter(Boolean).join(' · ')}</span>
      </span>
      {badge && <span className={`pp-badge pp-badge-${badge.tone}`}>{badge.text}</span>}
    </button>
  );
}

function Section({ title, items, meetings, now, kind }: { title: string; items: MemoryItem[]; meetings: Map<string, Meeting>; now: number; kind: 'promise' | 'decision' }) {
  if (items.length === 0) return null;
  return (
    <section className="pp-section">
      <h2>{title}</h2>
      {items.map((i) => <ItemRow key={i.id} item={i} meeting={meetings.get(i.meetingId)} now={now} kind={kind} />)}
    </section>
  );
}

/** The person page body; Forget draws it under its sheet. */
export function PersonPage({ person, data, onChanged, inert = false }: { person: PersonT; data: PeopleData; onChanged: () => void; inert?: boolean }) {
  const { navigate, back, has } = useRouter();
  const events = useEvents();
  const [menu, setMenu] = useState(() => {
    const open = !inert && personView.menuOpen;
    if (open) personView.menuOpen = false;
    return open;
  });
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(person.name);
  const [saveFailed, setSaveFailed] = useState(false);
  const now = world.now();
  const first = firstName(person.name);
  const meetings = new Map(data.meetings.map((m) => [m.id, m]));
  const series = seriesLine(person, data.meetings);
  const next = nextMeeting(person, events, now);
  const open = openPromises(data.items, person.id, now);
  const youOwe = open.filter((i) => i.ownerId === 'me');
  const owesYou = open.filter((i) => i.ownerId === person.id);
  const byNewest = (a: MemoryItem, b: MemoryItem) => b.createdAt - a.createdAt;
  // The latest decision only; the Decisions screen holds the rest.
  const decided = data.items.filter((i) => i.kind === 'decision' && i.status === 'open' && i.personIds.includes(person.id)).sort(byNewest).slice(0, 1);
  const quote = lastQuoteBy(person, data.items, data.meetings);
  const theirMeetings = person.meetingIds.map((id) => meetings.get(id)).filter((m): m is Meeting => !!m && m.startedAt <= now)
    .sort((a, b) => b.startedAt - a.startedAt);
  const pair = suggestionFor(person, data.people);
  const brief = 'brief';

  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menu]);

  const saveName = async () => {
    const clean = name.trim();
    setRenaming(false);
    if (!clean || clean === person.name) return setName(person.name);
    try {
      await putPerson({ ...person, name: clean, aliases: [...new Set([...person.aliases, person.name])].filter((a) => a !== clean), updatedAt: world.now() });
    } catch (error) {
      console.error('Rekord: could not rename', error);
      setName(person.name);
      return setSaveFailed(true);
    }
    setSaveFailed(false);
    onChanged();
  };

  const SinceLine = ({ withSeries = false }: { withSeries?: boolean }) => (
    <>{withSeries && series.label && `${series.label} · `}<span className="pp-mono">{series.count}</span> meetings{series.since && ` since ${series.since}`}</>
  );

  return (
    <div className="pp-page" aria-hidden={inert || undefined} inert={inert || undefined}>
      <header className="pp-head">
        <button type="button" className="v4-icon pp-dark" aria-label="Back to People" onClick={() => back()}><BackArrow /></button>
        {renaming ? (
          <input
            className="pp-rename" aria-label="Rename" value={name} autoFocus onChange={(e) => setName(e.target.value)} onBlur={() => void saveName()}
            onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') { setName(person.name); setRenaming(false); } }}
          />
        ) : <span className="pp-head-title">{person.name}</span>}
        <button
          type="button" className="v4-icon pp-dark" aria-label={`More for ${first}`} aria-haspopup="menu" aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        ><MoreDots /></button>
        {menu && (
          <div role="menu" aria-label={person.name} className="pp-menu">
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setRenaming(true); }}>Rename</button>
            <button
              type="button" role="menuitem" aria-disabled={!pair || undefined}
              onClick={() => { if (pair) { setMenu(false); navigate('personMerge', { personId: pair[0].id, otherId: pair[1].id }); } }}
            >Merge with someone</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); navigate('personMerge', { personId: person.id }); }}>Split meetings out</button>
            <button type="button" role="menuitem" className="pp-menu-danger" onClick={() => { setMenu(false); navigate('forget', { personId: person.id }); }}>Forget {first}</button>
          </div>
        )}
      </header>
      <main className="v4-body">
        {saveFailed && <p className="rd-error" role="alert">Rekord couldn’t save that change. Try again.</p>}
        <div className="v4-scroll">
          <div className="pp-person">
            <section className="pp-hero">
              <Avatar person={person} size={52} font={15} />
              <div className="pp-hero-text">
                <span className="pp-hero-name">{person.name}</span>
                {(person.email || person.company) && <span className="pp-hero-contact">{[person.email, person.company].filter(Boolean).join(' · ')}</span>}
                <span className="pp-hero-series"><SinceLine withSeries /></span>
              </div>
            </section>
            {next && (
              <section aria-label="Next meeting" className="pp-next">
                <span className="pp-next-icon"><CalIcon /></span>
                <span className="pp-next-text"><span className="pp-next-label">Next</span><span className="pp-next-title">{next.title} · {soonLabel(next.start, now)}</span></span>
                <button type="button" className="pp-next-brief" aria-disabled={!has(brief) || undefined} onClick={() => { if (has(brief)) navigate(brief); }}>Brief</button>
              </section>
            )}
            <Section title={`You owe ${first}`} items={youOwe.sort(byNewest)} meetings={meetings} now={now} kind="promise" />
            <Section title={`${first} owes you`} items={owesYou.sort(byNewest)} meetings={meetings} now={now} kind="promise" />
            <Section title="Decided together" items={decided} meetings={meetings} now={now} kind="decision" />
            {quote && (
              <section className="pp-section">
                <h2>Last thing {first} said</h2>
                <div className="pp-quote"><span className="pp-quote-text">“{quote.text}”</span><span className="pp-quote-meta">{quoteMeta(quote, meetings.get(quote.meetingId))}</span></div>
              </section>
            )}
            {theirMeetings.length > 0 && (
              <section className="pp-section">
                <div className="pp-section-head"><h2>Meetings</h2><span><SinceLine /></span></div>
                <div className="pp-meetings">
                  {theirMeetings.slice(0, 3).map((m) => (
                    <button key={m.id} type="button" className="pp-meeting" onClick={() => navigate('summary', { meetingId: m.id })}>
                      <span className="pp-meeting-title">{m.title}</span><span className="pp-meeting-date">{dayMonth(m.startedAt)}</span>
                    </button>
                  ))}
                  {theirMeetings.length > 3 && (
                    <button type="button" className="pp-meeting pp-meeting-all" onClick={() => navigate('library')}>See all {theirMeetings.length} meetings</button>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
      <RecordBar />
    </div>
  );
}

/** V4Person: one person's promises, decisions, last words and meetings. */
export default function Person() {
  const { route, back } = useRouter();
  const [data, reload] = usePeopleData();
  const person = data?.people.find((p) => p.id === route.params.personId);
  useEffect(() => { if (data && !person) back(); }, [data, person, back]);
  if (!data || !person) return <div className="pp-page" />;
  return <PersonPage person={person} data={data} onChanged={reload} />;
}
