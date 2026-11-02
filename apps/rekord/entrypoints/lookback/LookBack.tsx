import { useCallback, useEffect, useState } from 'react';
import { listMeetings } from '@/lib/db';
import { saveToFolder } from '@/lib/folder';
import { dayMonth, daysLate } from '@/lib/memory/brief';
import { buildWeek, carriedDue, durationLabel, lookBackMarkdown, lookBackPath, lookBackStart, openRowLabels, type Week } from '@/lib/memory/lookback';
import { transition } from '@/lib/memory/promise';
import { listItems, listPeople, putItem } from '@/lib/memory/store';
import type { MemoryItem, Person } from '@/lib/memory/types';
import { getSettings } from '@/lib/settings';
import type { Meeting } from '@/lib/types';
import { world } from '../sidepanel/components/v4/world';
import { DiamondIcon, DownloadIcon, Face, Pill, QuestionMark, TickIcon } from '../sidepanel/screens/v4/briefParts';
import { openPanelOn } from '../brief/panel';
import './lookback.css';
import { refreshBadge } from '@/lib/messages';

interface Data { week: Week; people: Map<string, Person>; meetings: Map<string, Meeting> }

const more = (n: number) => n > 0 && <li className="lb-more">and <span className="bp-mono">{n}</span> more</li>;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The week the notification asked for (`?week=` Monday 00:00), if any. */
function weekFromUrl(): number | undefined {
  return Number(new URLSearchParams(location.search).get('week')) || undefined;
}

/** V4LookBack: the week in numbers, what was decided and kept, what carries over, and what is late. */
export default function LookBack() {
  const [data, setData] = useState<Data | undefined>();
  const [tick, setTick] = useState(0);
  // Carried items stay open; they leave this list once handled.
  const [carried, setCarried] = useState<string[]>([]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    void Promise.all([listMeetings(), listItems(), listPeople()])
      .then(([meetings, items, people]) => {
        if (!alive) return;
        setData({ week: buildWeek({ meetings, items, people, now: world.now(), start: weekFromUrl() ?? lookBackStart(world.now()) }), people: new Map(people.map((p) => [p.id, p])), meetings: new Map(meetings.map((m) => [m.id, m])) });
      })
      .catch((error) => console.error('Rekord: could not load your week', error));
    return () => { alive = false; };
  }, [tick]);

  const write = async (next: MemoryItem) => {
    await putItem(next);
    refreshBadge();
    reload();
  };
  const carry = (item: MemoryItem) => {
    const now = Date.now();
    // A question stays open by itself; a promise moves its due date a week on.
    const next = item.kind === 'promise' ? transition(item, { type: 'edit', changes: { due: carriedDue(item, world.now()) } }, now) : { ...item, snoozedUntil: undefined, updatedAt: now };
    setCarried((c) => [...c, item.id]);
    write(next).catch((error) => console.error('Rekord: could not carry the item', error));
  };
  const drop = (item: MemoryItem) => {
    const now = Date.now();
    const next = item.kind === 'promise'
      ? transition(item, { type: 'drop', reason: 'notNeeded' }, now)
      : { ...item, status: 'dropped' as const, dropReason: 'notNeeded' as const, updatedAt: now };
    write(next).catch((error) => console.error('Rekord: could not drop the item', error));
  };
  const save = async () => {
    if (!data) return;
    const file = { path: lookBackPath(data.week), text: lookBackMarkdown(data.week, data.people, world.now()) };
    const { memory } = await getSettings();
    if (memory.folder && (await saveToFolder(file).catch(() => false))) return;
    download(file.path.split('/').pop()!, file.text);
  };

  const header = (week?: Week) => (
    <header className="lb-head">
      <div className="lb-head-left">
        <span className="brand-mark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M5 9v6M9 6v12M13 9v6M17 11v2" /></svg></span>
        <h1>Your week{week && <> · <span className="bp-mono">{week.label}</span></>}</h1>
      </div>
      <div className="lb-head-right">
        <button type="button" className="bp-link lb-open" onClick={() => openPanelOn('home')}>Open Rekord</button>
        <button type="button" className="lb-save" onClick={() => void save().catch((error) => console.error('Rekord: could not save your week', error))}>
          <DownloadIcon />Save as Markdown
        </button>
      </div>
    </header>
  );
  if (!data) return <div className="lb-page">{header()}</div>;
  const { week, people, meetings } = data;
  const now = world.now();
  const name = (id?: string) => people.get(id ?? '')?.name ?? '';
  const line = (i: MemoryItem) => { const m = meetings.get(i.meetingId); return m ? `${m.title} · ${dayMonth(m.startedAt)}` : ''; };
  const numbers: [string, string][] = [
    [String(week.meetings), 'meetings'], [durationLabel(week.minutes), 'in meetings'],
    [String(week.promisesMade), 'promises made'], [String(week.promisesKept), 'promises kept'], [String(week.decisions), 'decisions'],
  ];

  return (
    <div className="lb-page">
      {header(week)}
      <div className="lb-body">
        <section aria-label="The week in numbers" className="lb-numbers">
          {numbers.map(([n, label]) => <div key={label} className="lb-number"><span>{n}</span><span>{label}</span></div>)}
        </section>
        <div className="lb-cols">
          <section aria-label="Decided this week" className="lb-col">
            <h2>Decided this week</h2>
            <ul>
              {week.decided.slice(0, 2).map(({ item, replaces }) => (
                <li key={item.id} className="lb-card lb-card-stack lb-decided">
                  <Pill tone="decision"><DiamondIcon />Decision</Pill>
                  <span className="lb-text">{item.text}</span>
                  {replaces
                    ? <span className="lb-replaces"><strong>Replaces</strong><s>{replaces.text}</s><span className="bp-mono">{line(replaces)}</span></span>
                    : <span className="lb-from bp-mono">{line(item)}</span>}
                </li>
              ))}
              {more(week.decided.length - 2)}
            </ul>
          </section>
          <section aria-label="Kept" className="lb-col">
            <h2>Kept</h2>
            <ul>
              {week.kept.slice(0, 3).map((i) => <li key={i.id} className="lb-card lb-kept"><TickIcon />{i.text}</li>)}
              {more(week.kept.length - 3)}
            </ul>
          </section>
          <section aria-label="Still open going into next week" className="lb-col">
            <h2>Still open going into next week</h2>
            <ul>
              {week.stillOpen.filter((i) => !carried.includes(i.id)).map((i) => {
                const l = openRowLabels(i, people, now);
                return (
                  <li key={i.id} className="lb-card lb-card-stack">
                    <span className="lb-top">
                      <span className="lb-text">{i.text}</span>
                      <Pill tone={l.tone}>{l.tone === 'question' && <QuestionMark />}{l.chip}</Pill>
                    </span>
                    {l.line && <span className="lb-line">{l.line.split(' · due ')[0]} · due <span className="bp-mono">{l.line.split(' · due ')[1]}</span></span>}
                    <span className="lb-actions">
                      <button type="button" className="lb-btn" onClick={() => carry(i)}>Carry to next week</button>
                      <button type="button" className="lb-btn lb-btn-drop" onClick={() => drop(i)}>Drop</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <div className="lb-col lb-col-split">
            <section aria-label="People you met most" className="lb-col">
              <h2>People you met most</h2>
              <ul className="lb-people">
                {week.people.map(({ person, meetings: n }) => (
                  <li key={person.id} className="lb-card lb-person">
                    <Face name={person.name} />
                    <span className="lb-person-name">{person.name}</span>
                    <span className="bp-mono lb-count">{n} {n === 1 ? 'meeting' : 'meetings'}</span>
                  </li>
                ))}
              </ul>
            </section>
            {week.late.length > 0 && (
              <section aria-label="Late more than a week" className="lb-col">
                <h2>Late more than a week</h2>
                <ul>
                  {week.late.slice(0, 3).map((i) => (
                    <li key={i.id} className="lb-card lb-card-stack">
                      <span className="lb-top">
                        <span className="lb-text">{i.text}</span>
                        <Pill tone="late">{`${daysLate(i.due!, now)} days late`}</Pill>
                      </span>
                      <span className="lb-actions">
                        {i.ownerId !== 'me' && <button type="button" className="lb-btn" aria-label={`Nudge ${name(i.ownerId)}`} onClick={() => openPanelOn('nudge', { itemId: i.id })}>Nudge</button>}
                        <button type="button" className="lb-btn lb-btn-drop" onClick={() => drop(i)}>Drop</button>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
