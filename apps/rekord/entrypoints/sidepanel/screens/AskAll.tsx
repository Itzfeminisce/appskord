import { Fragment, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { askAll, askAllSession, askMemory, askMemorySession, citationClock, nothingFoundText, RANGES, SCOPES, shortDate, SUGGESTIONS, type AskAllResult, type AskMemoryResult, type MemorySource, type Range, type Scope } from '@/lib/askAll';
import { listMeetings } from '@/lib/db';
import { ensureModel, embedPending } from '@/lib/recall';
import { updateSettings } from '@/lib/settings';
import { BackIcon } from '../components/v4/icons';
import { world } from '../components/v4/world';
import { dateLabel } from '@/lib/library';
import type { Meeting } from '@/lib/types';
import { getSettings } from '@/lib/settings';
import { Spinner } from '../components';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { useRouter } from '../router';

const card: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 16, background: '#fff', border: '1px solid var(--line)', boxShadow: '0 1px 2px rgba(16,16,20,0.04)' };
const smallBtn: CSSProperties = { height: 32, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 9, background: '#fff', font: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' };
const pill: CSSProperties = { height: 30, padding: '0 10px', border: 0, borderRadius: 999, background: '#F1F1F3', font: 'inherit', fontSize: 12, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer' };
const sourceRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', border: 0, borderRadius: 10, background: '#F6F6F7', font: 'inherit', color: 'var(--ink)', textAlign: 'left', cursor: 'pointer' };
const chip: CSSProperties = { height: 22, padding: '0 6px', borderRadius: 6, background: '#EEF0FF', color: 'var(--accent)', fontFamily: "'Geist Mono', monospace", fontSize: 11, display: 'flex', alignItems: 'center' };

const sparkle = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z" /></svg>
);

function Answer({ turn, pending, onOpen, onRetry, onAllTime }: {
  turn: AskAllResult | undefined; pending: boolean;
  onOpen: (meetingId: string, atMs: number) => void; onRetry: () => void; onAllTime: () => void;
}) {
  if (pending || !turn) return <div style={card}><Spinner label="Thinking" /></div>;
  if (turn.status === 'error') {
    return (
      <div style={card}>
        <p role="alert" style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>{turn.error}</p>
        <div style={{ display: 'flex', gap: 6 }}><button type="button" style={smallBtn} onClick={onRetry}>Retry</button></div>
      </div>
    );
  }
  if (turn.status === 'none') {
    return (
      <div style={{ ...card, gap: 10 }}>
        <span style={{ fontSize: 14, lineHeight: 1.5 }}>{nothingFoundText(turn.range)}</span>
        {turn.range !== 'all' && <button type="button" style={{ ...smallBtn, alignSelf: 'flex-start' }} onClick={onAllTime}>Search all time</button>}
      </div>
    );
  }
  const sources = turn.sources ?? [];
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
        {sparkle}{sources.length > 0 ? `Found in ${sources.length} ${sources.length === 1 ? 'meeting' : 'meetings'}` : 'Rekord'}
      </div>
      {(turn.answer ?? '').split('\n').filter((l) => l.trim()).map((line, i) => (
        <p key={i} style={{ margin: 0, fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{line}</p>
      ))}
      {sources.length > 0 && (
        <ul aria-label="Sources" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sources.map((s) => (
            <li key={s.meetingId}>
              <button type="button" style={sourceRow} aria-label={`${s.title}, open transcript at ${citationClock(s.atMs)}`} onClick={() => onOpen(s.meetingId, s.atMs)}>
                <span style={{ flexGrow: 1, fontSize: 13, fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>{s.title}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{dateLabel(s.startedAt)}</span>
                <span style={chip}>{citationClock(s.atMs)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Keyword search only: the v3 screen, kept for people who declined the search model. */
function KeywordAskAll() {
  const { back, navigate } = useRouter();
  const [meetings, setMeetings] = useState<Meeting[] | undefined>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [range, setRangeState] = useState<Range>(askAllSession.range);
  const [turns, setTurns] = useState<AskAllResult[]>(askAllSession.turns);
  const [pendingQ, setPendingQ] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    listMeetings().then((l) => alive.current && setMeetings(l)).catch(() => { if (alive.current) { setLoadFailed(true); setMeetings([]); } });
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pendingQ]);

  const setRange = (r: Range) => { askAllSession.range = r; setRangeState(r); };
  const commit = (next: AskAllResult[]) => { askAllSession.turns = next; setTurns(next); };

  /** Asks `question`; `replaceAt` re-runs an earlier turn in place. */
  async function run(question: string, r: Range, replaceAt?: number) {
    const q = question.trim();
    if (!q || pendingQ !== null || !meetings) return;
    setPendingQ(q);
    const result = await askAll(q, r, meetings);
    if (!alive.current) { // left the screen mid-answer: still keep it for this panel session
      askAllSession.turns = replaceAt === undefined ? [...askAllSession.turns, result] : askAllSession.turns.map((t, i) => (i === replaceAt ? result : t));
      return;
    }
    setPendingQ(null);
    commit(replaceAt === undefined ? [...askAllSession.turns, result] : askAllSession.turns.map((t, i) => (i === replaceAt ? result : t)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = draft;
    setDraft('');
    void run(q, range);
  }

  function suggest(s: (typeof SUGGESTIONS)[number]) {
    if (s.incomplete) { setDraft(s.question); input.current?.focus(); return; }
    void run(s.question, range);
  }

  function searchAllTime(i: number) {
    setRange('all');
    void run(turns[i]?.question ?? "", 'all', i);
  }

  const busy = pendingQ !== null;
  const total = meetings?.length ?? 0;

  return (
    <main className="screen live">
      <header className="lib-head">
        <button type="button" className="icon-btn" aria-label="Back to meetings" onClick={back}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>Ask all meetings</h1>
          {meetings && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Answers from your {total} saved {total === 1 ? 'meeting' : 'meetings'}</span>}
        </div>
      </header>
      <ConnectionBanner />

      <div role="group" aria-label="Which meetings" className="lib-filters" style={{ margin: '12px 16px 0', flexWrap: 'wrap' }}>
        {RANGES.map((r) => (
          <button type="button" key={r.id} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>
        ))}
      </div>

      <section ref={scroller} className="live-scroll" aria-label="Answers" aria-live="polite" tabIndex={0}>
        {meetings === undefined && <Spinner label="Loading meetings" />}
        {loadFailed && <p className="live-empty" role="alert">Rekord couldn’t load your meetings. Close this screen and try again.</p>}
        {meetings && !loadFailed && total === 0 && <p className="live-empty">Meetings you record will be saved here. Then you can ask about all of them.</p>}
        {meetings && total > 0 && turns.length === 0 && !busy && <p className="live-empty">Ask anything about your meetings. Try a suggestion below.</p>}
        {turns.map((t, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ alignSelf: 'flex-end', maxWidth: '80%', padding: '10px 14px', borderRadius: '16px 16px 4px 16px', background: 'var(--ink)', color: '#fff', fontSize: 14, lineHeight: 1.5 }}>{t.question}</div>
            <Answer
              turn={t} pending={false}
              onOpen={(meetingId, atMs) => navigate('transcript', { meetingId, atMs })}
              onRetry={() => void run(t.question, t.range, i)}
              onAllTime={() => searchAllTime(i)}
            />
          </div>
        ))}
        {busy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ alignSelf: 'flex-end', maxWidth: '80%', padding: '10px 14px', borderRadius: '16px 16px 4px 16px', background: 'var(--ink)', color: '#fff', fontSize: 14, lineHeight: 1.5 }}>{pendingQ}</div>
            <Answer turn={undefined} pending onOpen={() => {}} onRetry={() => {}} onAllTime={() => {}} />
          </div>
        )}
      </section>

      <footer className="live-foot">
        <div role="group" aria-label="Suggested questions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SUGGESTIONS.map((s) => (
            <button type="button" key={s.label} style={pill} disabled={busy || !meetings || total === 0} onClick={() => suggest(s)}>{s.label}</button>
          ))}
        </div>
        <form className="live-note" onSubmit={submit}>
          <label htmlFor="askall" className="sr-only">Ask about your meetings</label>
          <input ref={input} id="askall" type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about your meetings" autoComplete="off" />
          <button type="submit" aria-label="Send" disabled={busy || !draft.trim() || !meetings || total === 0}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
          </button>
        </form>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Tap a meeting to jump to the moment it came from.</span>
      </footer>
    </main>
  );
}

const MEANING_CSS = `
.am-btn:focus-visible, .am-cite:focus-visible, .am-chip:focus-visible, .am-play:focus-visible, .am-src:focus-visible { outline: 2px solid #4F46E5; outline-offset: 2px; }
.am-chip:focus-visible span { outline: 2px solid #4F46E5; outline-offset: 2px; }
`;
const pillBase: CSSProperties = { height: 22, borderRadius: 999, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center' };
const icon = (d: string[]) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d.map((p) => <path key={p} d={p} />)}</svg>
);
const quoteClock = (ms: number) => citationClock(ms);

function MemoryCard({ s, onOpen }: { s: MemorySource; onOpen: (s: MemorySource) => void }) {
  const item = s.item!;
  const decision = item.kind === 'decision';
  const [label, bg, fg, glyph] = decision
    ? ['Decision', '#EAF6EF', '#1A6B40', icon(['M12 3l9 9-9 9-9-9z', 'M8.5 12l2.5 2.5 4.5-5'])]
    : item.kind === 'promise'
      ? ['Promise', '#EEF0FF', '#3730A3', icon(['M4 12h13M12 6l6 6-6 6'])]
      : ['Question', '#F1F1F3', '#2A2B31', icon(['M9 9a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1.2-1.5 2.4', 'M12 17.5v.5'])];
  return (
    <article style={{ padding: '12px 14px', borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...pillBase, padding: '0 9px 0 7px', background: bg, color: fg, gap: 5 }}>{glyph}{label}</span>
        {s.replaces && <span style={{ fontSize: 11, color: '#44464D' }}>Replaces: {s.replaces.text} ({shortDate(s.replaces.at)})</span>}
        {!!s.overdue && <span style={{ ...pillBase, padding: '0 8px', background: '#FDECEC', color: '#8A1C14' }}>Overdue {s.overdue} {s.overdue === 1 ? 'day' : 'days'}</span>}
      </div>
      <h3 style={{ margin: 0, fontSize: 14, lineHeight: 1.35, fontWeight: 600 }}>{item.text}</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '2px 2px 2px 10px', borderRadius: 10, background: '#F6F6F7', borderLeft: '3px solid #D5D5DA' }}>
        <span style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 12, lineHeight: 1.35, color: '#2A2B31' }}>{item.quote.speaker}: “{item.quote.text}”</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#6E7079' }}>{s.title} · {shortDate(s.startedAt)} · {quoteClock(s.atMs)}</span>
        </span>
        <button type="button" className="am-play" aria-label="Play from this moment" onClick={() => onOpen(s)} style={{ width: 44, height: 44, flexShrink: 0, border: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4F46E5', cursor: 'pointer' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
        </button>
      </div>
    </article>
  );
}

/** The answer with each `[n]` as a button that opens its source. */
function CitedText({ text, sources, onOpen }: { text: string; sources: MemorySource[]; onOpen: (s: MemorySource) => void }) {
  return (
    <>
      {text.split(/(\[\d+\])/).map((part, i) => {
        const n = /^\[(\d+)\]$/.exec(part)?.[1];
        const source = n ? sources[Number(n) - 1] : undefined;
        if (!source) return part;
        return (
          <sup key={i} style={{ margin: '0 1px 0 2px' }}>
            <button type="button" className="am-cite" aria-label={`Source ${source.n}`} onClick={() => onOpen(source)} style={{ position: 'relative', padding: 0, border: 0, background: 'transparent', color: '#4F46E5', font: '600 11px var(--mono)', cursor: 'pointer' }}>
              <span style={{ position: 'absolute', left: '50%', top: '50%', width: 44, height: 44, transform: 'translate(-50%, -50%)' }} />[{source.n}]
            </button>
          </sup>
        );
      })}
    </>
  );
}

function MemoryAnswer({ turn, onOpen, onRetry }: { turn: AskMemoryResult; onOpen: (s: MemorySource) => void; onRetry: () => void }) {
  const box: CSSProperties = { padding: 14, borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', boxShadow: '0 1px 2px rgba(16,16,20,0.04)', fontSize: 13.5, lineHeight: 1.55 };
  if (turn.status === 'error') {
    return (
      <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p role="alert" style={{ margin: 0 }}>{turn.error}</p>
        <button type="button" className="am-btn" style={{ ...smallBtn, alignSelf: 'flex-start' }} onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (turn.status === 'none') return <div style={box}>{nothingFoundText('all')}</div>;
  const sources = turn.sources ?? [];
  return (
    <>
      <div style={box}><CitedText text={turn.answer ?? ''} sources={sources} onOpen={onOpen} /></div>
      {sources.filter((s) => s.kind === 'item').map((s) => <MemoryCard key={s.item!.id} s={s} onOpen={onOpen} />)}
      {sources.filter((s) => s.kind === 'meeting').map((s) => (
        <button key={s.meetingId} type="button" className="am-src" style={sourceRow} aria-label={`${s.title}, open transcript at ${citationClock(s.atMs)}`} onClick={() => onOpen(s)}>
          <span style={{ flexGrow: 1, fontSize: 13, fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>{s.title}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{shortDate(s.startedAt)}</span>
          <span style={chip}>{citationClock(s.atMs)}</span>
        </button>
      ))}
    </>
  );
}

function ModelCard({ onReady, onKeep }: { onReady: () => void; onKeep: () => void }) {
  const [percent, setPercent] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function download() {
    setFailed(false);
    setPercent(0);
    const ok = await ensureModel((p) => alive.current && setPercent(p.total ? Math.round((p.loaded / p.total) * 100) : 0));
    if (!alive.current) return;
    setPercent(null);
    if (!ok) { setFailed(true); return; }
    await updateSettings({ memory: { ...(await getSettings()).memory, searchModel: 'ready' } });
    void embedPending();
    onReady();
  }
  async function keep() {
    await updateSettings({ memory: { ...(await getSettings()).memory, searchModel: 'asked' } });
    onKeep();
  }

  const downloading = percent !== null;
  return (
    <section aria-label="Search model" style={{ margin: '0 16px', padding: '12px 14px', borderRadius: 16, background: '#EEF0FF', border: '1px solid #D9D7FB', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#1E1B5C' }}>Search by meaning?</h2>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: '#3730A3' }}>Rekord downloads a 22 MB search model once from huggingface.co. Your meetings never leave this computer.</p>
      </div>
      {failed && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: '#8A1C14' }}>Rekord couldn’t download the search model.</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="am-btn" disabled={downloading} aria-busy={downloading} onClick={() => void download()} style={{ position: 'relative', overflow: 'hidden', flexGrow: 1, height: 44, border: 0, borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: downloading ? 'default' : 'pointer' }}>
          {downloading && <span aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${percent}%`, background: '#8B85F0' }} />}
          Download (22 MB)
        </button>
        <button type="button" className="am-btn" disabled={downloading} onClick={() => void keep()} style={{ height: 44, padding: '0 14px', borderRadius: 12, background: '#FFFFFF', border: '1px solid #D9D7FB', boxSizing: 'border-box', color: '#2A2B31', font: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Keep keyword search</button>
      </div>
    </section>
  );
}

function MeaningAskAll({ model, onKeep }: { model: 'none' | 'ready'; onKeep: () => void }) {
  const { back, navigate } = useRouter();
  const [asking, setAsking] = useState(model === 'none');
  const [meetings, setMeetings] = useState<Meeting[] | undefined>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [scope, setScopeState] = useState<Scope>(askMemorySession.scope);
  const [turns, setTurns] = useState<AskMemoryResult[]>(askMemorySession.turns);
  const [pendingQ, setPendingQ] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    listMeetings().then((l) => alive.current && setMeetings(l)).catch(() => { if (alive.current) { setLoadFailed(true); setMeetings([]); } });
    return () => { alive.current = false; };
  }, []);
  const first = useRef(true);
  useEffect(() => {
    // The first paint keeps the top of the answers; later questions and answers scroll into view.
    if (first.current) { first.current = false; return; }
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pendingQ]);

  const setScope = (s: Scope) => { askMemorySession.scope = s; setScopeState(s); };
  const keep = (next: AskMemoryResult[]) => { askMemorySession.turns = next; if (alive.current) setTurns(next); };

  async function run(question: string, replaceAt?: number) {
    const q = question.trim();
    if (!q || pendingQ !== null || !meetings) return;
    setPendingQ(q);
    const result = await askMemory(q, scope, meetings, { now: world.now() });
    if (alive.current) setPendingQ(null);
    keep(replaceAt === undefined ? [...askMemorySession.turns, result] : askMemorySession.turns.map((t, i) => (i === replaceAt ? result : t)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = draft;
    setDraft('');
    void run(q);
  }

  const open = (s: MemorySource) => navigate('transcript', { meetingId: s.meetingId, atMs: s.atMs });
  const busy = pendingQ !== null;
  const total = meetings?.length ?? 0;
  const bubble: CSSProperties = { alignSelf: 'flex-end', maxWidth: '90%', padding: '9px 14px', borderRadius: '16px 16px 4px 16px', background: '#111114', color: '#FFFFFF', fontSize: 14, lineHeight: 1.45 };

  return (
    <main className="screen live" style={{ position: 'relative', overflow: 'hidden', background: '#F6F6F7', color: '#111114' }}>
      <style>{MEANING_CSS}</style>
      <header style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px 0 8px' }}>
        <button type="button" className="icon-btn" aria-label="Back to meetings" onClick={back} style={{ width: 44, height: 44, borderRadius: 12, color: '#111114' }}><BackIcon /></button>
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>Ask all meetings</h1>
          {meetings && <span style={{ fontSize: 12, color: '#6E7079' }}>Answers from your {total} {total === 1 ? 'meeting' : 'meetings'}</span>}
        </div>
      </header>
      <ConnectionBanner />
      <div role="group" aria-label="Which memory" style={{ margin: '4px 16px 0', minHeight: 44, display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {SCOPES.map((c) => {
          const on = scope === c.id;
          return (
            <button type="button" key={c.id} className="am-chip" aria-pressed={on} onClick={() => setScope(c.id)} style={{ minHeight: 44, minWidth: 44, padding: '6px 0', border: 0, background: 'transparent', font: 'inherit', cursor: 'pointer' }}>
              <span style={{ height: 32, padding: '0 13px', borderRadius: 999, background: on ? '#111114' : '#EBEBEE', color: on ? '#FFFFFF' : '#2A2B31', fontWeight: on ? 600 : 500, fontSize: 12, display: 'flex', alignItems: 'center' }}>{c.label}</span>
            </button>
          );
        })}
      </div>
      {asking && <ModelCard onReady={() => setAsking(false)} onKeep={onKeep} />}
      <section ref={scroller} aria-label="Answer" aria-live="polite" tabIndex={0} style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '10px 16px 110px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {meetings === undefined && <Spinner label="Loading meetings" />}
        {loadFailed && <p className="live-empty" role="alert">Rekord couldn’t load your meetings. Close this screen and try again.</p>}
        {meetings && !loadFailed && total === 0 && <p className="live-empty">Meetings you record will be saved here. Then you can ask about all of them.</p>}
        {turns.map((t, i) => (
          <Fragment key={i}>
            <div style={bubble}>{t.question}</div>
            <MemoryAnswer turn={t} onOpen={open} onRetry={() => void run(t.question, i)} />
          </Fragment>
        ))}
        {busy && (
          <>
            <div style={bubble}>{pendingQ}</div>
            <div style={card}><Spinner label="Thinking" /></div>
          </>
        )}
      </section>
      <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 96, background: 'linear-gradient(to bottom, rgba(246,246,247,0), #F6F6F7)', pointerEvents: 'none' }} />
      <form onSubmit={submit} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '10px 16px 14px', display: 'flex', gap: 8 }}>
        <label htmlFor="q" className="sr-only">Ask a question</label>
        <input id="q" type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about any meeting" autoComplete="off" style={{ flexGrow: 1, minWidth: 0, height: 48, boxSizing: 'border-box', padding: '0 16px', border: '1px solid #DCDCE0', borderRadius: 14, background: '#FFFFFF', font: 'inherit', fontSize: 14 }} />
        <button type="submit" className="am-btn" aria-label="Ask" disabled={busy || !meetings || total === 0} style={{ width: 48, height: 48, border: 0, borderRadius: 14, background: '#111114', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
        </button>
      </form>
    </main>
  );
}

export default function AskAll() {
  const [model, setModel] = useState<'none' | 'asked' | 'ready' | undefined>();
  useEffect(() => {
    let alive = true;
    getSettings().then((s) => alive && setModel(s.memory.searchModel), () => alive && setModel('none'));
    return () => { alive = false; };
  }, []);
  if (!model) return <main className="screen live"><Spinner label="Loading" /></main>;
  return model === 'asked' ? <KeywordAskAll /> : <MeaningAskAll model={model} onKeep={() => setModel('asked')} />;
}
