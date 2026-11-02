import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Spinner, Tag } from '../components';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { Timeline } from '../components/Timeline';
import { useRouter } from '../router';
import { AskPanel, useAskEnabled } from './Ask';
import { SuggestionCard } from '../components/SuggestionCard';
import { AppAudioWatch } from './NoSound';
import { world } from '../components/v4/world';
import { AgendaStrip, LiveAgenda } from './v4/LiveAgenda';
import { RecallCard } from './v4/Recall';
import { MissedSheet } from './v4/Missed';
import { OffRecordView } from './v4/OffRecord';
import { ClashCard } from './v4/Clash';
import { ActionMark, BookmarkIcon, DecisionMark, EyeOffIcon, QuestionMark, UpIcon } from './v4/liveIcons';
import './v4/live.css';
import { citationClock, shortDate } from '@/lib/askAll';
import { inviteCandidates, liveLineName, type Invitee } from '@/lib/speakers';
import { LIVE_CHUNK_ID, supersede, type StreamRequest, type StreamState } from '@/lib/transcribe/stream';
import { getMeeting, listMeetings, listMarkers, listNotes, listSegments, pendingChunks, putMarker, putNote } from '@/lib/db';
import { buildTimeline, elapsedMs, mergeSegment, nearBottom, newMarker, newNote, waitingSpan } from '@/lib/live';
import { skipItem, trackAgenda } from '@/lib/live/agenda';
import { clashCandidates, confirmClash, replacingDecision, type Clash } from '@/lib/live/clash';
import { whatDidIMiss, type MissedMinutes, type MissedResult } from '@/lib/live/missed';
import { spanLabel } from '@/lib/live/offRecord';
import { promiseFromQuestion, questionsForYou, type AskedYou } from '@/lib/live/questions';
import { findRecall, recallAllowed, recentText, type RecallCard as Card } from '@/lib/live/recall';
import { getAgenda, itemsByKind, listPeople, putAgenda, putItem, replaceDecision } from '@/lib/memory/store';
import type { Agenda } from '@/lib/memory/types';
import { useConnection } from '@/lib/connection';
import { onMessage, send } from '@/lib/messages';
import { getSettings, updateSettings } from '@/lib/settings';
import { resolveSuggestion, startSuggester, suggestionCounts } from '@/lib/suggest';
import type { Marker, MarkerKind, Meeting, Note, RecordingState, Segment, Speaker } from '@/lib/types';

type Active = Exclude<RecordingState, { status: 'idle' }>;
type View = 'transcript' | 'agenda' | 'notes' | 'ask';
const MARKS: { kind: Exclude<MarkerKind, 'bookmark'>; label: string; icon: () => ReactNode }[] = [
  { kind: 'decision', label: 'Decision', icon: DecisionMark },
  { kind: 'action', label: 'Action', icon: () => <ActionMark /> },
  { kind: 'question', label: 'Question', icon: QuestionMark },
];
// A final line this recent still reads "now".
const NOW_MS = 10_000;

/** Dev frame routes only: the recording and the moment a frame shows, since no recorder runs there. */
export const liveDev: {
  rec?: RecordingState; stream?: StreamState; interim?: Segment; view?: View;
  recall?: Card; missed?: { minutes: MissedMinutes; result: MissedResult }; clash?: { clash: Clash; decidedAt: number };
} = {};

const sessionKey = (meetingId: string, what: string) => `rekord.live.${what}.${meetingId}`;
async function readSession<T>(key: string, fallback: T): Promise<T> {
  try { return ((await browser.storage.session.get(key))[key] as T | undefined) ?? fallback; } catch { return fallback; }
}
function writeSession(key: string, value: unknown) {
  browser.storage.session.set({ [key]: value }).catch((error) => console.error('Rekord: could not keep the live state', error));
}

/** One transcript line, named "You", the matched name or "Speaker A"; interim: greyed with a caret. */
function Line({ segment, speakers, invitees, now, clash }: { segment: Segment; speakers?: Meeting['speakers']; invitees: Invitee[]; now?: boolean; clash?: boolean }) {
  const you = segment.speaker === 'you';
  const name = liveLineName(segment, speakers, invitees);
  const initial = !you && segment.speakerLabel && name === `Speaker ${segment.speakerLabel}` ? segment.speakerLabel[0] : name[0];
  return (
    <div className="lv-line" data-clash={clash || undefined}>
      <span className={`lv-av${you ? ' you' : ''}`} aria-hidden="true">{initial?.toUpperCase()}</span>
      <div className="lv-line-body">
        <span className="lv-meta"><strong>{name}</strong> · <span className="mono">{now ? 'now' : citationClock(segment.startMs)}</span></span>
        <span className={`lv-text${clash ? ' clash' : ''}`}>
          {segment.text}{segment.interim && <span className="lv-caret" aria-hidden="true" />}
        </span>
      </div>
    </div>
  );
}

function Gap({ label }: { label: string }) {
  return <div className="lv-gap"><i /><EyeOffIcon size={13} stroke={2.2} /><span className="mono">{label}</span><i /></div>;
}

/** V3States "Live · real time stopped, backup on". */
function BackupBanner() {
  const [busy, setBusy] = useState(false);
  return (
    <div role="status" className="rt-banner">
      <div className="rt-banner-text">
        <span className="rt-banner-title">Switched to Groq</span>
        <span>Real-time transcription stopped, so text will appear a few seconds later. Nothing was missed.</span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void send({ type: 'transcription/catch-up' });
          setTimeout(() => setBusy(false), 3000);
        }}
      >Try real time again</button>
    </div>
  );
}

const RT_CSS = `
.rt-banner { margin: 8px 12px 0; padding: 12px 14px; border-radius: 14px; background: #fff8ec; border: 1px solid #f5ddb0; display: flex; flex-direction: column; gap: 10px; }
.rt-banner-text { display: flex; flex-direction: column; gap: 3px; font-size: 13px; line-height: 1.45; color: #6b3d00; }
.rt-banner-title { font-size: 14px; font-weight: 600; color: #5c3200; }
.rt-banner button { align-self: flex-start; height: 44px; padding: 0 12px; border: none; border-radius: 9px; background: var(--ink); color: #fff; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.rt-banner button:disabled { opacity: 0.6; }
`;

export default function Live() {
  const { route, replace, navigate } = useRouter();
  const askOn = useAskEnabled() !== false;
  const conn = useConnection();
  const connOk = useRef(true);
  connOk.current = conn.ok;
  const [sugOn, setSugOn] = useState(false);
  const [memory, setMemory] = useState<{ recall: boolean; clash: boolean }>({ recall: false, clash: false });
  const [rec, setRec] = useState<RecordingState | undefined>(liveDev.rec);
  const meetingId = route.params.meetingId ?? (rec && rec.status !== 'idle' ? rec.meetingId : undefined);
  const [title, setTitle] = useState('');
  const [meeting, setMeeting] = useState<Meeting | undefined>(undefined);
  const invitees = useMemo(() => inviteCandidates(meeting?.event), [meeting?.event]);
  const [stream, setStream] = useState<StreamState>(liveDev.stream ?? 'off');
  const [interim, setInterim] = useState<Partial<Record<Speaker, Segment>>>(liveDev.interim ? { [liveDev.interim.speaker]: liveDev.interim } : {});
  const [segments, setSegments] = useState<Segment[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [waiting, setWaiting] = useState<{ from: number; to: number } | null>(null);
  const [view, setView] = useState<View>(liveDev.view ?? 'transcript');
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(() => world.now());
  const [stopping, setStopping] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  const [agenda, setAgenda] = useState<Agenda | undefined>(undefined);
  const [handled, setHandled] = useState<string[]>([]);
  const [recall, setRecall] = useState<Card | undefined>(liveDev.recall);
  const [missed, setMissed] = useState<{ minutes: MissedMinutes; result?: MissedResult } | undefined>(liveDev.missed);
  const [clash, setClash] = useState<{ clash: Clash; decidedAt: number } | undefined>(liveDev.clash);
  const [clashBusy, setClashBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const scroller = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const recallGate = useRef({ muted: false, lastShownAt: liveDev.recall ? world.now() : undefined as number | undefined, seen: new Set<string>() });
  const promising = useRef(new Set<string>());
  const clashSeen = useRef({ cursor: -1, dismissed: new Set<string>() });

  // Live state: ask once, then follow broadcasts.
  useEffect(() => {
    let alive = true;
    const off = onMessage((msg) => {
      if (msg.type === 'recording/state') setRec(msg.state);
      else if (msg.type === 'stream/state') setStream(msg.state);
      else if (msg.type === 'segment/added') {
        const seg = msg.segment;
        if (meetingId && seg.meetingId !== meetingId) return undefined;
        if (seg.interim) {
          setInterim((cur) => ({ ...cur, [seg.speaker]: seg.text.trim() ? seg : undefined }));
          return undefined;
        }
        if (seg.chunkId === LIVE_CHUNK_ID) setInterim((cur) => ({ ...cur, [seg.speaker]: undefined }));
        // A Groq backup chunk replaces the streamed lines it covers, so nothing shows twice.
        setSegments((s) => mergeSegment(supersede(s, seg), seg));
      }
      return undefined;
    });
    if (!liveDev.rec) {
      const ask: StreamRequest = { type: 'stream/get-state' };
      browser.runtime.sendMessage(ask).then((s: unknown) => {
        if (alive && (s === 'live' || s === 'backup' || s === 'off')) setStream(s);
      }, () => undefined);
      send<RecordingState>({ type: 'recording/get-state' }).then((s) => {
        if (alive) setRec(s ?? { status: 'idle' });
      });
    }
    return () => { alive = false; off(); };
  }, [meetingId]);

  // Initial load from the db (covers a panel reopened mid-meeting), with the meeting's agenda and live choices.
  useEffect(() => {
    if (!meetingId) return;
    let alive = true;
    Promise.all([getMeeting(meetingId), listSegments(meetingId), listNotes(meetingId), listMarkers(meetingId)])
      .then(async ([m, s, n, k]) => {
        if (!alive) return;
        setTitle(m?.title ?? '');
        setMeeting(m);
        setSegments((cur) => s.reduce(mergeSegment, cur));
        setNotes(n);
        setMarkers(k);
        const a = (m?.event?.id ? await getAgenda(m.event.id) : undefined) ?? (await getAgenda(meetingId));
        if (alive) setAgenda(a);
      })
      .catch(() => alive && setLoadFailed(true));
    readSession<string[]>(sessionKey(meetingId, 'asked'), []).then((ids) => alive && setHandled(ids), () => undefined);
    readSession<boolean>(sessionKey(meetingId, 'recallMuted'), false).then((m) => { recallGate.current.muted = m; }, () => undefined);
    // Reopening the panel keeps the gap since the last recall card.
    readSession<number | null>(sessionKey(meetingId, 'recallShownAt'), null).then((at) => {
      if (at !== null) recallGate.current.lastShownAt = Math.max(at, recallGate.current.lastShownAt ?? at);
    }, () => undefined);
    return () => { alive = false; };
  }, [meetingId]);

  // While transcription is paused, show the span of audio saved but not yet transcribed.
  useEffect(() => {
    if (!meetingId || conn.ok) { setWaiting(null); return; }
    let alive = true;
    const load = () => pendingChunks(meetingId).then((c) => alive && setWaiting(waitingSpan(c))).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [meetingId, conn.ok]);

  useEffect(() => {
    let alive = true;
    getSettings().then((s) => {
      if (!alive) return;
      setSugOn(s.features.liveSuggestions);
      setMemory({ recall: s.memory.recall, clash: s.memory.clash });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(world.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const active: Active | undefined = rec && rec.status !== 'idle' ? rec : undefined;
  const offSince = active?.offRecord?.since;
  const off = offSince !== undefined;
  const spans = active?.offRecord?.spans ?? [];
  // The clock stops while off the record.
  const ms = active ? elapsedMs(active.startedAt, off ? offSince : now) : 0;
  const msRef = useRef(ms);
  msRef.current = ms;
  const segRef = useRef(segments);
  segRef.current = segments;
  const recallRef = useRef(recall);
  recallRef.current = recall;
  const clashRef = useRef(clash);
  clashRef.current = clash;
  const meetingRef = useRef(meeting);
  meetingRef.current = meeting;

  const nameOf = useCallback((s: Segment) => liveLineName(s, meetingRef.current?.speakers, inviteCandidates(meetingRef.current?.event)), []);

  // Every minute while the recording is live and on the record: recall, clash, then action items.
  const recording = rec !== undefined && rec.status === 'recording';
  useEffect(() => {
    if (!meetingId || !recording || off || liveDev.rec) return;
    const live = async (signal: AbortSignal) => {
      const at = world.now();
      const gate = recallGate.current;
      if (memory.recall && recallAllowed({ ...gate, showing: !!recallRef.current }, at)) {
        const [meetings, people] = await Promise.all([listMeetings(), listPeople()]);
        const search: Parameters<typeof findRecall>[3]['search'] = async (q, o) => (await import('@/lib/recall')).search(q, o);
        const card = await findRecall(meetingId, recentText(segRef.current, msRef.current), gate.seen, { search, meetings, people, now: at });
        if (card && !signal.aborted) {
          gate.lastShownAt = at;
          writeSession(sessionKey(meetingId, 'recallShownAt'), at);
          card.itemIds.forEach((id) => gate.seen.add(id));
          setRecall(card);
        }
      }
      const seen = clashSeen.current;
      if (memory.clash && connOk.current && !clashRef.current) {
        const fresh = segRef.current.filter((s) => !s.interim && s.startMs > seen.cursor);
        if (!fresh.length) return;
        seen.cursor = Math.max(...fresh.map((s) => s.startMs));
        const candidate = clashCandidates(await itemsByKind('decision'), fresh).filter((c) => !seen.dismissed.has(c.decision.id)).at(-1);
        if (!candidate) return;
        const decidedAt = (await getMeeting(candidate.decision.quote.meetingId))?.startedAt ?? candidate.decision.createdAt;
        const found = await confirmClash(meetingId, candidate, nameOf(candidate.segment), shortDate(decidedAt), { signal });
        if (found && !signal.aborted) setClash({ clash: found, decidedAt });
      }
    };
    return startSuggester({
      meetingId,
      suggest: sugOn,
      live,
      isOk: () => connOk.current,
      onNew: (made) => setMarkers((l) => [...l, ...made]),
    });
  }, [meetingId, sugOn, recording, off, memory, nameOf]);

  // Recording ended elsewhere (or nothing is recording): leave this screen.
  useEffect(() => {
    if (rec?.status === 'idle' && !stopping) {
      if (meetingId) replace('processing', { meetingId });
      else replace('start');
    }
  }, [rec, stopping, meetingId, replace]);

  // Names matched while recording (calendar, T9) are saved on the meeting: reload it when a new live label appears.
  const labels = [...new Set(segments.map((s) => s.speakerLabel).filter(Boolean))].join(',');
  useEffect(() => {
    if (!meetingId || !labels) return;
    let alive = true;
    getMeeting(meetingId).then((m) => alive && m && setMeeting(m), () => undefined);
    return () => { alive = false; };
  }, [meetingId, labels]);

  const hidden = (m: Marker) => m.source === 'ai' && m.status === 'dismissed';
  const shown = markers.filter((m) => !hidden(m) && (m.source !== 'ai' || m.status !== 'suggested' || sugOn));
  const timeline = buildTimeline(segments, notes, shown);
  const counts = suggestionCounts(markers);
  const track = useMemo(() => (agenda ? trackAgenda(agenda, segments, ms) : undefined), [agenda, segments, ms]);
  const questions = useMemo(() => questionsForYou(segments, nameOf).filter((q) => !handled.includes(q.id)), [segments, nameOf, handled]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const place = () => {
      const line = clash ? el.querySelector<HTMLElement>('[data-clash]') : null;
      // A clash shows its line (and the one before) above the card.
      if (line) el.scrollTop = ((line.previousElementSibling as HTMLElement | null) ?? line).offsetTop - 8;
      else if (follow.current) el.scrollTop = el.scrollHeight;
    };
    place();
    // The recall card and late fonts change the height: stay at the newest line.
    void document.fonts?.ready.then(place);
    const watch = new ResizeObserver(place);
    watch.observe(el);
    return () => watch.disconnect();
  }, [timeline.length, view, clash, recall]);

  const live = stream === 'live';
  const interimLines = (['others', 'you'] as const).map((k) => interim[k]).filter((s): s is Segment => !!s);
  const lastFinal = segments.at(-1);

  const addNote = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!meetingId || !active || off) return;
    const n = newNote(meetingId, msRef.current, draft);
    if (!n) return;
    setNotes((l) => [...l, n]);
    setDraft('');
    try { await putNote(n); setSaveFailed(false); } catch { setSaveFailed(true); }
  }, [meetingId, active, off, draft]);

  async function mark(kind: MarkerKind) {
    if (!meetingId || !active || off) return;
    const m = newMarker(meetingId, msRef.current, kind);
    setMarkers((l) => [...l, m]);
    try { await putMarker(m); setSaveFailed(false); } catch { setSaveFailed(true); }
  }

  async function decide(m: Marker, status: 'accepted' | 'dismissed', edits: { label?: string } = {}) {
    setMarkers((l) => l.map((x) => (x.id === m.id ? { ...x, ...edits, status } : x)));
    try { await resolveSuggestion(m, status, edits); setSaveFailed(false); } catch { setSaveFailed(true); }
  }

  async function stop() {
    if (!meetingId || stopping) return;
    setStopping(true);
    setStopFailed(false);
    const reply = await send<{ ok?: boolean }>({ type: 'recording/stop' });
    if (reply === undefined || reply.ok !== false) replace('processing', { meetingId });
    else { setStopping(false); setStopFailed(true); }
  }

  async function offRecord(on: boolean) {
    if (switching) return;
    setSwitching(true);
    try { await send({ type: 'recording/off-record', on }); } finally { setSwitching(false); }
  }

  function handle(q: AskedYou) {
    if (!meetingId) return;
    const next = [...handled, q.id];
    setHandled(next);
    writeSession(sessionKey(meetingId, 'asked'), next);
  }

  async function addPromise(q: AskedYou) {
    if (!meetingId || promising.current.has(q.id)) return;
    promising.current.add(q.id);
    // Owed to whoever asked: the invited person with that first name, else nobody yet.
    const first = (n: string) => n.trim().toLowerCase().split(/\s+/)[0] ?? '';
    const invited = new Set((meeting?.event?.attendees ?? []).map((x) => x.email?.toLowerCase()).filter(Boolean));
    const person = (await listPeople().catch(() => [])).find((p) => first(p.name) === first(q.speaker) && !!p.email && invited.has(p.email.toLowerCase()));
    try {
      // One promise per question: a second tap overwrites the same row instead of adding another.
      await putItem(promiseFromQuestion(q, meetingId, world.now(), person?.id, () => `promise:${meetingId}:${q.id}`));
      void browser.runtime.sendMessage({ type: 'rekord.badge.refresh' }).catch(() => undefined);
      handle(q);
    } catch (error) {
      console.error('Rekord: could not save the promise', error);
      setSaveFailed(true);
    } finally {
      promising.current.delete(q.id);
    }
  }

  async function skip(id: string) {
    if (!agenda) return;
    const next = skipItem(agenda, id);
    setAgenda(next);
    await putAgenda(next).catch((error) => console.error('Rekord: could not save the agenda', error));
  }

  function muteRecall() {
    recallGate.current.muted = true;
    setRecall(undefined);
    if (meetingId) writeSession(sessionKey(meetingId, 'recallMuted'), true);
  }

  async function openMissed(minutes: MissedMinutes) {
    if (!meeting) return;
    setMissed({ minutes });
    const result = await whatDidIMiss(meeting, segRef.current, minutes, msRef.current);
    setMissed((cur) => (cur && cur.minutes === minutes ? { minutes, result } : cur));
  }

  async function resolveClash(yes: boolean) {
    const c = clash;
    if (!c || !meetingId) return;
    clashSeen.current.dismissed.add(c.clash.decision.id);
    if (!yes) { setClash(undefined); return; }
    setClashBusy(true);
    try {
      const at = world.now();
      const fresh = replacingDecision(c.clash, meetingId, at);
      await putItem(fresh);
      await replaceDecision(c.clash.decision.id, fresh.id, at);
      void browser.runtime.sendMessage({ type: 'rekord.badge.refresh' }).catch(() => undefined);
      setClash(undefined);
    } catch (error) {
      console.error('Rekord: could not replace the decision', error);
      setSaveFailed(true);
    } finally { setClashBusy(false); }
  }

  async function clashOff() {
    setClash(undefined);
    setMemory((m) => ({ ...m, clash: false }));
    try {
      const s = await getSettings();
      await updateSettings({ memory: { ...s.memory, clash: false } });
    } catch (error) { console.error('Rekord: could not turn clash alerts off', error); }
  }

  if (rec === undefined) {
    return <main className="screen screen-center"><Spinner label="Loading" /></main>;
  }

  const lineOf = (seg: Segment) => (
    <Line
      key={seg.id} segment={seg} speakers={meeting?.speakers} invitees={invitees}
      now={seg.interim || (!interimLines.length && seg === lastFinal && ms - seg.startMs < NOW_MS)}
      clash={clash?.clash.segment.id === seg.id}
    />
  );

  if (off && active) {
    const before = segments.filter((s) => s.text.trim() && s.startMs < offSince - active.startedAt).slice(-2);
    return (
      <OffRecordView
        title={title || 'Untitled meeting'} clock={citationClock(ms)} since={offSince} now={now} ending={stopping}
        lines={before.map((s) => <Line key={s.id} segment={s} speakers={meeting?.speakers} invitees={invitees} />)}
        onBack={() => void offRecord(false)} onEnd={stop}
      />
    );
  }

  const gaps = spans.map((s) => ({ atMs: s.startMs, node: <Gap key={`gap-${s.startMs}`} label={spanLabel(s)} /> }));
  const transcript = [
    ...timeline.map((it) => ({
      atMs: it.atMs,
      node: it.kind === 'marker' && it.marker.source === 'ai' && it.marker.status === 'suggested' ? (
        <SuggestionCard key={it.id} marker={it.marker} onAccept={(e) => decide(it.marker, 'accepted', e)} onDismiss={() => decide(it.marker, 'dismissed')} />
      ) : it.kind === 'segment' ? lineOf(it.segment) : <Timeline key={it.id} items={[it]} />,
    })),
    ...gaps,
  ].sort((a, b) => a.atMs - b.atMs);
  const tabs: { id: View; label: ReactNode; fr: string }[] = [
    { id: 'transcript', label: 'Transcript', fr: '1.15fr' },
    ...(track ? [{ id: 'agenda' as const, label: <>Agenda <span className="lv-tab-count">{track.place} of {track.total}</span></>, fr: '1.55fr' }] : []),
    { id: 'notes', label: 'Notes', fr: '0.95fr' },
    ...(askOn ? [{ id: 'ask' as const, label: 'Ask', fr: '0.7fr' }] : []),
  ];
  const marksOn = view === 'transcript' || view === 'notes';

  return (
    <main className="lv">
      <style>{RT_CSS}</style>
      <div className="lv-bar-wrap">
        <div className="lv-bar">
          <span className="lv-dot" aria-hidden="true" />
          <div className="lv-bar-text">
            <span className="lv-title">{title || 'Untitled meeting'}</span>
            <span className="lv-clock" role="timer" aria-label={`Recording, ${citationClock(ms)} elapsed`}>
              {active?.status === 'starting' ? 'Starting' : active?.status === 'stopping' ? 'Stopping' : 'Recording'} · {citationClock(ms)}
            </span>
          </div>
          <button
            type="button" className="lv-off-btn" aria-label="Off the record (Alt+Shift+O)" title="Off the record (Alt+Shift+O)"
            disabled={!recording || switching} onClick={() => void offRecord(true)}
          ><EyeOffIcon /></button>
          <button type="button" className="lv-end" onClick={stop} disabled={stopping}>{stopping ? 'Ending…' : 'End'}</button>
        </div>
      </div>

      <ConnectionBanner />
      {stream === 'backup' && <BackupBanner />}
      <AppAudioWatch meetingId={meetingId} />

      {stopFailed && <p className="lv-msg" role="alert">Rekord couldn’t end the recording. Try End again.</p>}
      {saveFailed && <p className="lv-msg" role="alert">Rekord couldn’t save your last note or marker. Try again.</p>}
      {active?.micUnavailable && <p className="lv-msg" role="status">Your microphone isn’t available, so only the meeting audio is being recorded.</p>}

      <nav aria-label="View" className="lv-tabs" style={{ gridTemplateColumns: tabs.map((t) => t.fr).join(' ') }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" aria-current={view === t.id ? 'page' : undefined} onClick={() => setView(t.id)}>{t.label}</button>
        ))}
      </nav>

      {marksOn && track && <AgendaStrip track={track} />}

      {view === 'ask' && askOn && meetingId ? (
        <AskPanel meetingId={meetingId} nowMs={ms} live onOpenMoment={(atMs) => navigate('transcript', { meetingId, atMs })} onMissed={() => void openMissed(3)} />
      ) : view === 'agenda' && track ? (
        <LiveAgenda track={track} questions={questions} onSkip={(id) => void skip(id)} onPromise={(q) => void addPromise(q)} onAnswered={handle} />
      ) : (
        <div className="lv-tx">
          <section
            ref={scroller}
            className={`lv-scroll${clash ? ' clashing' : ''}`}
            aria-label={view === 'transcript' ? 'Transcript' : 'Notes'}
            aria-live="polite"
            tabIndex={0}
            onScroll={(e) => { follow.current = nearBottom(e.currentTarget); }}
          >
            {loadFailed ? (
              <p className="lv-empty" role="alert">Rekord couldn’t load this meeting. Try reopening the side panel.</p>
            ) : view === 'transcript' ? (
              transcript.length === 0 && !waiting && !interimLines.length ? (
                <p className="lv-empty">{live ? 'Listening…' : 'Listening… Words appear here about 10 s behind the conversation.'}</p>
              ) : (
                <>
                  {transcript.map((t) => t.node)}
                  {interimLines.map((seg) => lineOf(seg))}
                  {waiting && (
                    <div className="tl-waiting">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                      <span className="tl-waiting-text">{citationClock(waiting.from)} – {citationClock(waiting.to)} waiting to transcribe</span>
                      <span className="tl-waiting-saved">saved</span>
                    </div>
                  )}
                </>
              )
            ) : notes.length === 0 && markers.length === 0 ? (
              <p className="lv-empty">No notes yet. Type one below and press Enter.</p>
            ) : (
              buildTimeline([], notes, shown.filter((m) => m.status !== 'suggested')).map((it) =>
                it.kind === 'note' ? (
                  <div className="tl-inline tl-note" key={it.id}>
                    <span className="tl-meta">Note · {citationClock(it.atMs)}</span>
                    <span className="tl-text">{it.note.text}</span>
                  </div>
                ) : it.kind === 'marker' ? (
                  <div className="tl-inline" key={it.id}>
                    <Tag kind={it.marker.kind} />
                    <span className="tl-meta">{citationClock(it.atMs)}</span>
                  </div>
                ) : null,
              )
            )}
          </section>
          {!clash && <div aria-hidden="true" className="lv-tx-fade" />}
        </div>
      )}

      {view === 'transcript' && recall && !clash && (
        <RecallCard card={recall} onNotNow={() => setRecall(undefined)} onMute={muteRecall} />
      )}

      {view !== 'ask' && (
        <footer className="lv-foot">
          {sugOn && counts.added + counts.waiting > 0 && (
            <div className="lv-sug">
              <span>{counts.added} {counts.added === 1 ? 'action' : 'actions'} added · {counts.waiting} {counts.waiting === 1 ? 'suggestion' : 'suggestions'} waiting</span>
              <button type="button" onClick={() => navigate('settings')}>Suggestions on</button>
            </div>
          )}
          {marksOn ? (
            <div role="group" aria-label="Mark this moment" className="lv-marks">
              {MARKS.map((m) => (
                <button type="button" key={m.kind} className={`lv-mark ${m.kind}`} onClick={() => mark(m.kind)} disabled={!active}><span><m.icon />{m.label}</span></button>
              ))}
              <button type="button" className="lv-mark bookmark" aria-label="Bookmark this moment" onClick={() => mark('bookmark')} disabled={!active}><span><BookmarkIcon /></span></button>
            </div>
          ) : <div className="lv-foot-gap" />}
          <form className="lv-note" onSubmit={addNote}>
            <label htmlFor="note" className="sr-only">Add a note</label>
            <input id="note" type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={conn.ok ? `Add a note at ${citationClock(ms)}` : 'Notes still work while offline'} autoComplete="off" />
            <button type="submit" aria-label="Save note" disabled={!active || !draft.trim()}><UpIcon /></button>
          </form>
        </footer>
      )}

      {missed && <MissedSheet minutes={missed.minutes} result={missed.result} onMinutes={(m) => void openMissed(m)} onClose={() => setMissed(undefined)} />}
      {clash && view === 'transcript' && (
        <ClashCard
          clash={clash.clash} decidedAt={clash.decidedAt} busy={clashBusy}
          onYes={() => void resolveClash(true)} onNo={() => void resolveClash(false)} onTurnOff={() => void clashOff()}
        />
      )}
    </main>
  );
}
