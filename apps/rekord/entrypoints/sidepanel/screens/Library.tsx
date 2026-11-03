import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATCHUP_TAG, isCatchup } from '@/lib/catchup/label';
import { deleteMeeting, listMeetings, listSegments } from '@/lib/db';
import { joinTranscript, matchesQuery } from '@/lib/library';
import { formatDuration } from '@/lib/time';
import type { Meeting } from '@/lib/types';
import { Button, EmptyState, Spinner } from '../components';
import { Shell } from '../components/v4/Shell';
import { world } from '../components/v4/world';
import { ComingUp } from '../components/CalendarCard';
import { useRouter } from '../router';
import { itemsForMeeting, listItems, listPeople } from '@/lib/memory/store';
import { isOpenLoop } from '@/lib/memory/rank';
import { StateBanner } from '../components/v4/states';
import './v41/library.css';

const UNDO_MS = 8000;

const DAY = 86_400_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const startOfDay = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime();
const startOfWeek = (t: number) => { const d = startOfDay(t); return d - ((new Date(d).getDay() + 6) % 7) * DAY; };
const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** "Today", "Yesterday", "This week" (Monday on), "Last week", then "Earlier". */
function groupOf(t: number, now: number): string {
  if (startOfDay(t) === startOfDay(now)) return 'Today';
  if (startOfDay(t) === startOfDay(now) - DAY) return 'Yesterday';
  if (t >= startOfWeek(now)) return 'This week';
  return t >= startOfWeek(now) - 7 * DAY ? 'Last week' : 'Earlier';
}
/** "With Sarah, Tom and Priya": first names, from the invite, else the people memory met in it. */
function withLine(m: Meeting, people: { name: string; meetingIds: string[] }[]): string | undefined {
  const names = m.event
    ? m.event.attendees.filter((a) => !a.self).map((a) => a.name?.trim() || a.email.split('@')[0] || '')
    : people.filter((p) => p.meetingIds.includes(m.id)).map((p) => p.name);
  const first = [...new Set(names.filter(Boolean).map((n) => n.split(/\s+/)[0]!))];
  if (first.length === 0) return undefined;
  return `With ${first.length === 1 ? first[0] : `${first.slice(0, -1).join(', ')} and ${first.at(-1)}`}`;
}
const GROUPS = ['Today', 'Yesterday', 'This week', 'Last week', 'Earlier'];

/** "13:00 · 4 h" today, "Thu 29 Oct" after that. */
function whenOf(m: Meeting, now: number): string {
  if (startOfDay(m.startedAt) !== startOfDay(now)) { const d = new Date(m.startedAt); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
  return [hhmm(m.startedAt), m.endedAt !== undefined && formatDuration(m.endedAt - m.startedAt)].filter(Boolean).join(' · ');
}

export default function Library() {
  const { navigate } = useRouter();
  const [meetings, setMeetings] = useState<Meeting[] | undefined>();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [promises, setPromises] = useState<Record<string, number>>({});
  const [people, setPeople] = useState<{ name: string; meetingIds: string[] }[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const list = await listMeetings();
      setMeetings(list);
      const entries = await Promise.all(list.map(async (m) => [m.id, joinTranscript(await listSegments(m.id))] as const));
      setTexts(Object.fromEntries(entries));
      const open: Record<string, number> = {};
      for (const i of await listItems().catch(() => [])) {
        if (i.kind === 'promise' && isOpenLoop(i, Date.now())) open[i.meetingId] = (open[i.meetingId] ?? 0) + 1;
      }
      setPromises(open);
      setPeople(await listPeople().catch(() => []));
    } catch {
      setError(true);
      setMeetings((cur) => cur ?? []);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const open = (m: Meeting) => navigate(m.status === 'done' ? 'summary' : m.status === 'recording' ? 'live' : 'processing', { meetingId: m.id });

  // V4States "Meeting deleted": the meeting leaves the list at once and is deleted when Undo has gone.
  const [deleted, setDeleted] = useState<{ meeting: Meeting; items: number } | null>(null);
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const flush = useCallback(async () => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    clearTimeout(p.timer);
    setDeleted(null);
    try {
      await deleteMeeting(p.id);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => () => { void flush(); }, [flush]);

  const remove = async (id: string) => {
    setConfirming(null);
    const target = meetings?.find((m) => m.id === id);
    if (!target || target.status === 'recording' || target.status === 'processing') return;
    await flush();
    const items = (await itemsForMeeting(id).catch(() => [])).length;
    pending.current = { id, timer: setTimeout(() => void flush(), UNDO_MS) };
    setDeleted({ meeting: target, items });
    setMeetings((cur) => cur?.filter((m) => m.id !== id));
  };
  const undo = () => {
    const p = pending.current;
    if (!p || !deleted) return;
    clearTimeout(p.timer);
    pending.current = null;
    const back = deleted.meeting;
    setMeetings((cur) => [...(cur ?? []), back].sort((a, b) => b.startedAt - a.startedAt));
    setDeleted(null);
  };

  const now = world.now();
  const shown = useMemo(() => (meetings ?? []).filter((m) => matchesQuery(m, texts[m.id], query)), [meetings, texts, query]);
  const groups = useMemo(() => {
    const sorted = [...shown].sort((a, b) => b.startedAt - a.startedAt);
    return GROUPS.map((label) => ({ label, meetings: sorted.filter((m) => groupOf(m.startedAt, now) === label) })).filter((g) => g.meetings.length > 0);
  }, [shown, now]);

  return (
    <Shell tab="meetings" catchUp>
      <div className="lib-body">
        <div className="lib-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6E7079" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <label htmlFor="q" className="sr-only">Search meetings</label>
          <input id="q" type="search" placeholder={`Search ${meetings?.length ?? 0} meetings`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {error && (
          <p className="start-warn" role="alert">
            <span>Couldn’t load your meetings.</span>
            <Button variant="secondary" onClick={() => void load()}>Try again</Button>
          </p>
        )}

        {meetings === undefined ? (
          <div className="lib-wait"><Spinner label="Loading meetings" /></div>
        ) : meetings.length === 0 ? (
          <EmptyState title="No meetings yet" body="Meetings you record will be saved here." />
        ) : groups.length === 0 ? (
          <EmptyState title="No matches" body="Try a different word, or clear the search." />
        ) : (
          <section className="lib-list" aria-label="Meetings">
            {groups.map((g) => (
              <div className="lib-group" key={g.label}>
                <h2>{g.label}</h2>
                {g.meetings.map((m) => {
                  const n = promises[m.id] ?? 0;
                  const live = m.status === 'recording' || m.status === 'processing';
                  const who = withLine(m, people);
                  return (
                    <div className="lib-card" key={m.id}>
                      <button type="button" className="lib-open" onClick={() => open(m)}>
                        <span className="lib-row">
                          <span className="lib-title">{m.title || 'Untitled meeting'}</span>
                          <span className="lib-date">{whenOf(m, now)}</span>
                        </span>
                        {(who ?? m.summary?.overview) && <span className="lib-sum">{who ?? m.summary?.overview}</span>}
                        <span className="lib-pills">
                          {isCatchup(m) && (
                            <span className="pill lib-tag">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /></svg>{CATCHUP_TAG}
                            </span>
                          )}
                          {m.status === 'recording' && <span className="pill pill-live">Recording</span>}
                          {m.status === 'processing' && <span className="pill pill-live">Processing</span>}
                          {m.status === 'error' && <span className="pill pill-warn">Needs attention</span>}
                          {n > 0 && <span className="pill lib-open-n">{n} open {n === 1 ? 'promise' : 'promises'}</span>}
                          {m.shares?.some((x) => x.kind === 'gdocs') && <span className="pill pill-ok">In Google Docs</span>}
                          {m.shares?.some((x) => x.kind === 'notion') && <span className="pill">In Notion</span>}
                        </span>
                      </button>
                      {!live && (confirming === m.id ? (
                        <div className="lib-confirm" role="alertdialog" aria-label={`Delete ${m.title || 'Untitled meeting'}`}>
                          <span>Delete this meeting for good?</span>
                          <Button variant="secondary" onClick={() => setConfirming(null)}>Cancel</Button>
                          <Button onClick={() => void remove(m.id)}>Delete</Button>
                        </div>
                      ) : (
                        <button type="button" className="icon-btn lib-del" aria-label={`Delete ${m.title || 'Untitled meeting'}`} onClick={() => setConfirming(m.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        )}
        <ComingUp />
      </div>
      {deleted && (
        <div className="lib-undo">
          <StateBanner tone="plain" icon="done" title={`“${deleted.meeting.title || 'Untitled meeting'}” was deleted`}
            body={deleted.items ? `Its ${deleted.items} memory ${deleted.items === 1 ? 'item is' : 'items are'} gone too.` : undefined}
            action={{ label: 'Undo', kind: 'light', onClick: undo }} />
        </div>
      )}
    </Shell>
  );
}
