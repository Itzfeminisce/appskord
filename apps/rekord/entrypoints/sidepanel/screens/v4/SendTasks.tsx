import { useEffect, useState } from 'react';
import { getMeeting } from '@/lib/db';
import { GoogleError } from '@/lib/google';
import { itemsForMeeting, listPeople } from '@/lib/memory/store';
import type { MemoryItem, Person } from '@/lib/memory/types';
import { LINEAR_HOSTS } from '@/lib/hosts';
import { loadKeys } from '@/lib/penv';
import { DEFAULT_LIST, listTaskLists, tasksTurnedOn, turnOnTasks, type TaskList } from '@/lib/services/gtasks';
import { LINEAR_KEY, LinearError, linearWorkspace, savedTeam, type LinearTeam, type LinearViewer } from '@/lib/services/linear';
import { notionAccountFor, notionDatabases, sendable, sendItems, sentTo, SERVICE_NAMES, type SendDeps, type SendService, type SendTarget } from '@/lib/services/send';
import type { NotionAccount, NotionDatabase } from '@/lib/share/notion';
import type { Meeting } from '@/lib/types';
import { Spinner } from '../../components';
import { BackIcon } from '../../components/v4/icons';
import { StateBanner } from '../../components/v4/states';
import { dayLabel, firstName, isoDay, shortDate } from '../../components/v4/review';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import './after.css';

export interface SendDone { meetingId: string; service: SendService; target: string; sentIds: string[] }

/** Test and dev-frame hooks: service calls and where keys come from. */
export const sendTasksDeps: { current?: SendDeps & { loadKeys?: () => Promise<Record<string, string>>; hasHosts?: () => Promise<boolean> } } = {};
/** Survives a trip to Connect Linear and back, and holds the done state until it is shown. */
export const sendTasksSession: { tab?: SendService; done?: SendDone } = {};

const ArrowIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h12M13 7l5 5-5 5" /></svg>
);
const Tick = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

/** "You · to Sarah · due today", "Owner: Sarah · no due date". */
export function rowMeta(item: MemoryItem, people: Person[], now: number): string {
  const name = (id?: string) => firstName(people.find((p) => p.id === id)?.name ?? '');
  const due = !item.due ? 'no due date' : item.due === isoDay(now) ? 'due today' : `due ${dayLabel(item.due)}`;
  if (item.ownerId === 'me') return ['You', item.toId && item.toId !== 'me' ? `to ${name(item.toId)}` : '', due].filter(Boolean).join(' · ');
  return item.ownerId ? `Owner: ${name(item.ownerId)} · ${due}` : due;
}

const TABS: SendService[] = ['gtasks', 'notion', 'linear'];

/** "● Connected as alex@rekord-team.com" with "Change". */
function Account({ who, onChange }: { who?: string; onChange: () => void }) {
  if (!who) return null;
  return (
    <div className="st-account">
      <span className="st-account-who"><span aria-hidden="true" className="st-account-dot" /><span>Connected as <strong>{who}</strong></span></span>
      <button type="button" className="st-change" onClick={onChange}>Change</button>
    </div>
  );
}

/** "Owner → Assignee  Due → Date": where each promise's details land. */
function Mapping({ rows }: { rows: [string, string][] }) {
  if (!rows.length) return null;
  return (
    <div className="st-map">
      {rows.map(([from, to]) => <span key={from}><strong>{from}</strong><ArrowRight />{to}</span>)}
    </div>
  );
}
const ArrowRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Try again in a moment.');

/** V4SendTasks: send this meeting's promises to Google Tasks, Notion or Linear, then show where each went. */
export default function SendTasks() {
  const { route, back, navigate } = useRouter();
  const meetingId = route.params.meetingId ?? '';
  const deps = sendTasksDeps.current ?? {};
  const [meeting, setMeeting] = useState<Meeting>();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<SendService>(sendTasksSession.tab ?? 'gtasks');
  const [done, setDone] = useState<SendDone | undefined>(() => (sendTasksSession.done?.meetingId === meetingId ? sendTasksSession.done : undefined));
  const [tasksOn, setTasksOn] = useState(false);
  const [lists, setLists] = useState<TaskList[]>([DEFAULT_LIST]);
  const [listId, setListId] = useState(DEFAULT_LIST.id);
  const [notion, setNotion] = useState<{ token?: string; dbs: NotionDatabase[]; account?: NotionAccount }>();
  const [dbId, setDbId] = useState('');
  const [linear, setLinear] = useState<{ key?: string; teams: LinearTeam[]; me?: LinearViewer }>();
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // V4States: Google said no to the Tasks permission (the item it was for), or Linear rejected the saved key.
  const [refused, setRefused] = useState('');
  const [keyRejected, setKeyRejected] = useState(false);

  useEffect(() => { delete sendTasksSession.done; }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([getMeeting(meetingId), itemsForMeeting(meetingId), listPeople()])
      .then(([m, all, ps]) => {
        if (!alive) return;
        const rows = sendable(all, meetingId);
        setMeeting(m); setItems(rows); setPeople(ps);
      })
      .catch((e) => console.error('Rekord: could not load the action items', e));
    return () => { alive = false; };
  }, [meetingId]);

  // Mine start ticked, except what already went to the selected service.
  const itemKey = items.map((i) => i.id).join();
  useEffect(() => {
    setChecked(new Set(items.filter((i) => i.ownerId === 'me' && !sentTo(i, tab)).map((i) => i.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, itemKey]);

  // Each destination loads what its picker needs the first time its tab opens.
  useEffect(() => {
    let alive = true;
    const fail = (e: unknown) => { if (alive) setError(errorText(e)); };
    const keys = () => (deps.loadKeys ?? loadKeys)().catch(() => ({} as Record<string, string>));
    setError('');
    if (tab === 'gtasks') {
      void tasksTurnedOn().then(async (on) => {
        if (!alive) return;
        setTasksOn(on);
        if (!on) return;
        const found = await listTaskLists(deps.tasks, meetingId).catch((e) => { console.error('Rekord: could not read your task lists', e); return [DEFAULT_LIST]; });
        if (alive) { setLists(found); setListId(found[0]!.id); }
      });
    } else if (tab === 'notion' && !notion) {
      void keys().then(async (k) => {
        const token = k.NOTION_TOKEN?.trim();
        const [dbs, account] = token
          ? await Promise.all([
            notionDatabases(token, meetingId, deps.notion).catch((e) => { fail(e); return []; }),
            notionAccountFor(token, meetingId, deps.notion).catch((e) => { console.error('Rekord: could not read the Notion account', e); return undefined; }),
          ])
          : [[], undefined];
        if (alive) { setNotion({ token, dbs, account }); setDbId(dbs[0]?.id ?? ''); }
      });
    } else if (tab === 'linear' && !linear) {
      void keys().then(async (k) => {
        // Without Chrome's permission for Linear the picker offers Connect Linear instead.
        const allowed = await (deps.hasHosts ?? (() => browser.permissions.contains({ origins: LINEAR_HOSTS })))().catch(() => false);
        const key = allowed ? k[LINEAR_KEY]?.trim() : undefined;
        const { teams, me } = key ? await linearWorkspace(key, deps.linear, meetingId).catch((e) => { fail(e); return { teams: [], me: undefined }; }) : { teams: [], me: undefined };
        const saved = await savedTeam().catch(() => undefined);
        if (alive) { setLinear({ key, teams, me }); setTeamId(teams.find((t) => t.id === saved?.id)?.id ?? teams[0]?.id ?? ''); }
      });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, meetingId]);

  const chosen = items.filter((i) => checked.has(i.id));
  const name = SERVICE_NAMES[tab];
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const noteFor = (item: MemoryItem) => {
    const to = item.toId && item.toId !== 'me' ? people.find((p) => p.id === item.toId)?.name : undefined;
    const from = meeting ? `From ${meeting.title}, ${shortDate(meeting.startedAt)}.` : '';
    return [to ? `Promised to ${to}.` : '', from].filter(Boolean).join(' ');
  };

  async function send() {
    if (busy || chosen.length === 0) return;
    setError('');
    setRefused('');
    setKeyRejected(false);
    let target: SendTarget;
    let label: string;
    if (tab === 'gtasks') {
      if (!tasksOn) {
        setBusy(true);
        try {
          await turnOnTasks(deps.tasks); // Chrome's and Google's prompts, inside this click
          setTasksOn(true);
        } catch (e) {
          if (e instanceof GoogleError && e.code === 'cancelled') setRefused(chosen[0]!.text);
          else setError(e instanceof GoogleError ? e.message : errorText(e));
          setBusy(false);
          return;
        }
      }
      target = { service: 'gtasks', listId };
      label = lists.find((l) => l.id === listId)?.title ?? DEFAULT_LIST.title;
    } else if (tab === 'notion') {
      const database = notion?.dbs.find((d) => d.id === dbId);
      if (!notion?.token || !database) return;
      target = { service: 'notion', token: notion.token, database, ...(notion.account?.userId ? { me: notion.account.userId } : {}) };
      label = database.title;
    } else {
      const team = linear?.teams.find((t) => t.id === teamId);
      if (!linear?.key || !team) return;
      target = { service: 'linear', key: linear.key, teamId: team.id, ...(linear.me ? { me: linear.me.id } : {}) };
      label = team.name;
    }
    setBusy(true);
    const result = await sendItems(target, chosen, noteFor, { ...deps, now: () => world.now() });
    if (result.sent.length) {
      browser.runtime.sendMessage({ type: 'rekord.badge.refresh' }).catch(() => undefined);
      const sentById = new Map(result.sent.map((s) => [s.item.id, s.item]));
      setItems((rows) => rows.map((r) => sentById.get(r.id) ?? r));
      if (result.error) setChecked((c) => new Set([...c].filter((id) => !sentById.has(id))));
      else setDone({ meetingId, service: tab, target: label, sentIds: result.sent.map((s) => s.item.id) });
    }
    if (result.error instanceof LinearError && result.error.code === 'auth') setKeyRejected(true);
    else if (result.error) setError(errorText(result.error));
    setBusy(false);
  }

  const head = (
    <header className="af-head">
      <button type="button" className="af-back" aria-label="Back to meeting" onClick={back}><BackIcon /></button>
    </header>
  );

  if (done) {
    const n = done.sentIds.length;
    const doneName = SERVICE_NAMES[done.service];
    return (
      <main className="af-page">
        {head}
        <div className="af-body">
          <h1>Send action items</h1>
          <div className="st-banner" role="status"><Tick size={18} />{n} {n === 1 ? 'task' : 'tasks'} sent to {done.target}</div>
          {error && <p role="alert" className="af-alert">{error}</p>}
          <ul aria-label="Action items" className="st-list">
            {items.map((item) => {
              const sent = done.sentIds.includes(item.id);
              const url = item.sentTo?.filter((s) => s.service === done.service).at(-1)?.url;
              return (
                <li key={item.id} className="st-row" style={{ cursor: 'default' }}>
                  {sent ? <span className="st-done-dot"><Tick size={13} /></span> : <span className="st-box" />}
                  <span className="st-text">
                    <span className="st-title">{item.text}</span>
                    {sent
                      ? <span className="st-sent">Sent ·&nbsp;<a href={url} target="_blank" rel="noreferrer">Open in {doneName}</a></span>
                      : <span className="st-meta">Not sent · {rowMeta(item, people, world.now())}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="st-carry">
            <span className="af-label">In Open loops, these promises now carry</span>
            <span className="st-chip"><ArrowIcon />In {doneName}</span>
          </div>
          <button type="button" className="af-primary" onClick={() => navigate('home')}>See open loops</button>
        </div>
      </main>
    );
  }

  const needsConnect = (tab === 'notion' && notion && !notion.token) || (tab === 'linear' && linear && !linear.key);
  const loading = (tab === 'notion' && !notion) || (tab === 'linear' && !linear);

  return (
    <main className="af-page">
      {head}
      <div className="af-body">
        <h1>Send action items</h1>
        <div role="tablist" aria-label="Send to" className="st-tabs">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); sendTasksSession.tab = t; }}>{SERVICE_NAMES[t]}</button>
          ))}
        </div>
        {tab === 'gtasks' && (
          <div className="st-pick">
            <label htmlFor="st-list" className="af-label">List</label>
            <select id="st-list" value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          </div>
        )}
        {tab === 'notion' && notion?.token && <Account who={notion.account?.label} onChange={() => navigate('notionConnect')} />}
        {tab === 'linear' && linear?.key && <Account who={linear.me?.email} onChange={() => navigate('linearConnect')} />}
        {tab === 'notion' && notion?.token && (
          <div className="st-pick">
            <label htmlFor="st-db" className="af-label">Database</label>
            <select id="st-db" value={dbId} onChange={(e) => setDbId(e.target.value)}>
              {notion.dbs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </div>
        )}
        {tab === 'linear' && linear?.key && (
          <div className="st-pick">
            <label htmlFor="st-team" className="af-label">Team</label>
            <select id="st-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {linear.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        <ul aria-label="Action items" className="st-list">
          {items.map((item) => {
            const on = checked.has(item.id);
            return (
              <li key={item.id}>
                <label className="st-row">
                  <input type="checkbox" checked={on} onChange={() => toggle(item.id)} />
                  <span className={on ? 'st-box on' : 'st-box'}>{on && <Tick size={14} />}</span>
                  <span className="st-text">
                    <span className="st-title">{item.text}</span>
                    <span className="st-meta">{sentTo(item, tab) ? 'Sent · ' : ''}{rowMeta(item, people, world.now())}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {tab === 'notion' && notion?.token && (() => {
          const db = notion.dbs.find((d) => d.id === dbId);
          const rows: [string, string][] = [];
          if (db?.peopleProp && notion.account?.userId) rows.push(['Owner', db.peopleProp]);
          if (db?.dateProp) rows.push(['Due', db.dateProp]);
          return <Mapping rows={rows} />;
        })()}
        {tab === 'linear' && linear?.key && <Mapping rows={[...(linear.me ? [['Your promises', 'Assign to me'] as [string, string]] : []), ['Due', 'Issue due date']]} />}
        {tab === 'gtasks' && !tasksOn && (
          <p className="st-info">The first time, Google asks you for one more permission. Rekord asks Google to add tasks. It can’t read your other tasks.</p>
        )}
        {error && <p role="alert" className="af-alert">{error}</p>}
        {refused && (
          <StateBanner alert tone="warn" icon="warn" title="Google Tasks said no" body={`Rekord can’t add “${refused}” without your permission.`}
            action={{ label: 'Ask again', kind: 'light', onClick: () => void send() }} />
        )}
        {keyRejected && (
          <StateBanner alert tone="alert" icon="warn" title="Linear didn’t accept this key" body="Make sure you copied all of it, or create a new key in Linear."
            action={{ label: 'Update key', kind: 'link', onClick: () => navigate('linearConnect') }} />
        )}
        {needsConnect ? (
          <button type="button" className="af-primary" onClick={() => navigate(tab === 'notion' ? 'notionConnect' : 'linearConnect')}>
            Connect {name}
          </button>
        ) : (
          <button
            type="button" className="af-primary" onClick={() => void send()}
            disabled={busy || loading || chosen.length === 0} aria-busy={busy || undefined}
          >
            {busy && <Spinner label={`Sending to ${name}`} size={16} />}
            Send {chosen.length} to {name}
          </button>
        )}
      </div>
    </main>
  );
}
