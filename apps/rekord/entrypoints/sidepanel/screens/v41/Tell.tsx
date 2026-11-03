import { useEffect, useMemo, useRef, useState } from 'react';
import { questionsKey, trimTelling, type ToldBefore as Told } from '@/lib/catchup/pipeline';
import { clockMs, isPaused, limitState, partMs, TELL_PORT } from '@/lib/catchup/session';
import type { PickedMeeting } from '@/lib/catchup/types';
import { deleteMeeting, getMeeting, listSegments } from '@/lib/db';
import { mergeSegment } from '@/lib/live';
import { onMessage, send } from '@/lib/messages';
import { openPermissionTab, watchMic } from '@/lib/mic';
import { ensureKeys, loadKeys } from '@/lib/penv';
import { pastEvents } from '@/lib/reminders';
import { getSettings } from '@/lib/settings';
import { missingKeys, neededKeys } from '@/lib/setup';
import type { Meeting, RecordingState, Segment } from '@/lib/types';
import type { RecordingReply } from '../../../background';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { parseWho } from './PickOther';
import { atLimit, backAction, METER_BARS, minutesLeft, mmss, pickedOf, promptRows, SILENT, tooSoon, typedLines, wordCount } from './tell';
import { BackArrow, Banner, LeaveDialog, Meter, MicIcon, PauseBars, Prompts, KeyboardIcon } from './tellParts';
import { TellType } from './TellType';

/** Dev frame routes only: the telling as the frame shows it, without a microphone. */
export const tellDev: { rec?: RecordingState; levels?: number[]; typed?: string; state?: TellDevState } = {};
/** Dev frame routes only: a V41States card on the real screen. */
export interface TellDevState { micBlocked?: boolean; aiMissing?: boolean; short?: boolean; limitHit?: boolean; offline?: boolean; textFailed?: boolean; confirm?: boolean }

const START_ERROR = 'Rekord couldn’t start recording. Try again in a moment.';
const NOTHING_HEARD_MS = 8_000;
const LINES = 3;

/** The meeting the route names: a calendar event, "Something else", or (Add more) a catch-up already told. */
async function pickedFromRoute(p: ReturnType<typeof useRouter>['route']['params']): Promise<PickedMeeting | null> {
  if (p.eventId) {
    const event = (await pastEvents(world.now())).find((e) => e.id === p.eventId);
    return event ? { kind: 'event', event } : null;
  }
  if (p.title && p.date && p.time) {
    return { kind: 'form', form: { name: p.title, date: p.date, start: p.time, lengthMin: p.lengthMin ?? 30, attendees: p.who ? parseWho(p.who) : [] } };
  }
  return null;
}

/** V41Tell (and V41TellType): tell Rekord what happened, by voice or typed; the four prompts tick as you go. */
export default function Tell() {
  const { route, replace, navigate, back, canGoBack } = useRouter();
  const p = route.params;
  const adding = !!p.meetingId && !p.eventId && !p.title;
  const [meetingId] = useState(() => (tellDev.rec && tellDev.rec.status !== 'idle' ? tellDev.rec.meetingId : p.meetingId ?? crypto.randomUUID()));
  const [picked, setPicked] = useState<PickedMeeting | null | undefined>();
  const [meeting, setMeeting] = useState<Meeting | undefined>();
  const [rec, setRec] = useState<RecordingState>(tellDev.rec ?? { status: 'idle' });
  const [mode, setMode] = useState<'talk' | 'type'>(p.mode === 'type' ? 'type' : 'talk');
  const [typed, setTyped] = useState(tellDev.typed ?? '');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [interim, setInterim] = useState<Segment | undefined>();
  const [levels, setLevels] = useState<number[]>(tellDev.levels ?? []);
  const [heard, setHeard] = useState(!!tellDev.levels);
  const [now, setNow] = useState(() => world.now());
  const dev = tellDev.state ?? {};
  const [ai, setAi] = useState<'checking' | 'ready' | 'missing'>(dev.aiMissing ? 'missing' : tellDev.rec || tellDev.typed !== undefined || tellDev.state ? 'ready' : 'checking');
  const [micBlocked, setMicBlocked] = useState(!!dev.micBlocked);
  const [error, setError] = useState('');
  const [short, setShort] = useState(!!dev.short);
  const [confirm, setConfirm] = useState(!!dev.confirm);
  const [limitHit, setLimitHit] = useState(!!dev.limitHit);
  const [offline, setOffline] = useState(() => !!dev.offline || (typeof navigator !== 'undefined' && navigator.onLine === false));
  const [textFailed, setTextFailed] = useState(!!dev.textFailed);
  const [busy, setBusy] = useState(false);
  const started = useRef(adding || !!tellDev.rec);
  const autoStarted = useRef(!!tellDev.rec || tellDev.typed !== undefined || !!tellDev.state);
  const stopping = useRef(false);
  const before = useRef<Told | undefined>(undefined);
  const port = useRef<ReturnType<typeof browser.runtime.connect> | undefined>(undefined);
  const lastPart = useRef(0);

  const holdPort = () => { if (!port.current) port.current = browser.runtime.connect({ name: TELL_PORT }); };
  const releasePort = () => { port.current?.disconnect(); port.current = undefined; };
  useEffect(() => () => releasePort(), []);

  // The meeting and what was already said (Add more, or a dev frame).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (adding || tellDev.rec) {
        const [m, segs] = await Promise.all([getMeeting(meetingId), listSegments(meetingId)]);
        if (!alive) return;
        setMeeting(m);
        setSegments(segs.filter((s) => !s.interim));
        if (m?.told) before.current = { ms: m.told.ms, parts: m.told.parts.length, status: m.status };
        if (adding) { setPicked(m ? pickedOf(m) : null); return; }
      }
      const next = await pickedFromRoute(p);
      if (alive) setPicked(next);
    })().catch((error) => { console.error('Rekord: could not load the meeting', error); if (alive) setPicked(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An AI is needed to turn the telling into notes ("Connect an AI to catch up").
  useEffect(() => {
    if (ai !== 'checking') return;
    let alive = true;
    Promise.all([getSettings(), ensureKeys(), loadKeys()])
      .then(([s, k, keys]) => alive && setAi(k === 'ready' && missingKeys(neededKeys(s), Object.keys(keys)).length === 0 ? 'ready' : 'missing'))
      .catch(() => alive && setAi('missing'));
    return () => { alive = false; };
  }, [ai]);

  // Live state, words and levels from the background.
  useEffect(() => {
    if (tellDev.rec || tellDev.typed !== undefined || tellDev.state) return undefined;
    const off = onMessage((msg) => {
      if (msg.type === 'recording/state') {
        setRec(msg.state);
        if (msg.state.status === 'recording' && msg.state.tell && !isPaused(msg.state.tell)) {
          const level = msg.state.micLevel;
          setLevels((l) => [...l, level].slice(-METER_BARS));
          if (level >= SILENT) setHeard(true);
        }
      } else if (msg.type === 'segment/added' && msg.segment.meetingId === meetingId) {
        const seg = msg.segment;
        if (seg.interim) setInterim(seg.text.trim() ? seg : undefined);
        else { setInterim(undefined); setHeard(true); setSegments((s) => mergeSegment(s, seg)); }
      } else if (msg.type === 'connection/state') {
        setOffline(!msg.state.ok && msg.state.reason === 'offline');
        setTextFailed(!msg.state.ok && (msg.state.reason === 'auth' || msg.state.reason === 'server'));
      }
      return undefined;
    });
    const t = setInterval(() => setNow(world.now()), 500);
    const net = () => setOffline(!navigator.onLine);
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    return () => { off(); clearInterval(t); window.removeEventListener('online', net); window.removeEventListener('offline', net); };
  }, [meetingId]);

  const tell = rec.status !== 'idle' ? rec.tell : undefined;
  const paused = !!tell && isPaused(tell);
  const clock = tell ? clockMs(tell, now) : before.current?.ms ?? 0;
  const part = tell ? partMs(tell, now) : 0;
  const limit = limitState(part);
  if (tell) lastPart.current = part;

  // At 60:00 the offscreen document stops by itself; any other stop nobody clicked goes on to the questions.
  const wasTelling = useRef(false);
  useEffect(() => {
    if (tell) { wasTelling.current = true; return; }
    if (!wasTelling.current || stopping.current) return;
    wasTelling.current = false;
    releasePort();
    if (atLimit(lastPart.current)) setLimitHit(true);
    else replace('catchupQuestions', { meetingId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!tell]);

  async function begin() {
    if (busy || !picked) return;
    setBusy(true);
    setError('');
    setMicBlocked(false);
    const append = started.current;
    const reply = await send<RecordingReply>({ type: 'recording/start', tabId: -1, catchup: { meetingId, picked, ...(append && { append: true }) } })
      .catch(() => undefined);
    setBusy(false);
    if (reply?.ok) {
      started.current = true;
      holdPort();
      const state = await send<RecordingState>({ type: 'recording/get-state' }).catch(() => undefined);
      if (state) setRec(state);
      if (!meeting) getMeeting(meetingId).then(setMeeting, () => undefined);
      return;
    }
    if (reply && !reply.ok && reply.micBlocked) setMicBlocked(true);
    else setError(reply && !reply.ok ? reply.error : START_ERROR);
  }

  // Straight to telling once the meeting and the AI are known (the meeting was picked on the screen before).
  useEffect(() => {
    if (autoStarted.current || picked === undefined || ai !== 'ready' || mode !== 'talk') return;
    autoStarted.current = true;
    if (picked === null) { replace('catchupPick'); return; }
    void begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, ai]);

  // After "Allow microphone": the permission tab grants it, and telling starts.
  useEffect(() => {
    if (!micBlocked) return undefined;
    return watchMic((state) => { if (state === 'granted' && mode === 'talk') void (tell && paused ? pause(false) : begin()); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micBlocked, mode]);

  async function pause(on: boolean) {
    const reply = await send<{ ok: boolean; micBlocked?: true }>({ type: 'recording/pause', on }).catch(() => undefined);
    if (reply?.micBlocked) setMicBlocked(true);
    else if (reply?.ok) setMicBlocked(false);
  }

  function toType() {
    if (tell && !paused) void pause(true);
    setMode('type');
  }

  function toTalk() {
    setMode('talk');
    if (tell && paused) void pause(false);
    else if (!tell && ai === 'ready') void begin();
  }

  const voice = useMemo(() => segments.filter((s) => !tell || s.startMs <= clock), [segments, tell, clock]);
  const words = voice.reduce((n, s) => n + wordCount(s.text), 0) + wordCount(typed);
  const hasTyped = typed.trim().length > 0;
  const canFinish = !!tell || hasTyped || (started.current && !adding);

  async function finish() {
    if (busy || !canFinish) return;
    if (!adding && tooSoon(words, clock)) { setShort(true); return; }
    setBusy(true);
    setConfirm(false);
    stopping.current = true;
    // With a telling, the typed text goes with the stop, so the follow-up questions read both.
    const text = hasTyped && picked ? { catchup: { meetingId, picked, append: true }, text: typed } : undefined;
    const stopped = tell ? await send<RecordingReply>({ type: 'recording/stop', ...(text && { typed: text }) }).catch(() => undefined) : undefined;
    releasePort();
    let saved = started.current;
    if (hasTyped && picked) {
      const reply = tell ? stopped : await send<RecordingReply>({ type: 'catchup/typed', catchup: { meetingId, picked, ...(saved && { append: true }) }, text: typed }).catch(() => undefined);
      if (reply?.ok) saved = true;
      else { setError(reply && !reply.ok ? reply.error : START_ERROR); setBusy(false); stopping.current = false; return; }
    }
    if (saved) replace('catchupQuestions', { meetingId });
    else { setBusy(false); stopping.current = false; }
  }

  const leave = () => (canGoBack ? back() : replace('home'));

  async function discard() {
    setConfirm(false);
    setShort(false);
    stopping.current = true;
    setBusy(true);
    if (tell) await send({ type: 'recording/stop', discard: true }).catch(() => undefined);
    releasePort();
    try {
      if (adding && before.current) await trimTelling(meetingId, before.current);
      else if (!adding && started.current) {
        await deleteMeeting(meetingId);
        await browser.storage.local.remove(questionsKey(meetingId));
      }
    } catch (error) {
      console.error('Rekord: could not discard the catch-up', error);
    }
    leave();
  }

  const onBack = () => (backAction(!!tell) === 'confirm' ? setConfirm(true) : leave());

  const all = mode === 'type' ? [...voice, ...typedLines(typed, (voice.at(-1)?.startMs ?? 0) + 1, meetingId)] : [...typedLines(typed, -1_000, meetingId), ...voice];
  const { rows, covered } = promptRows(all);
  const title = meeting?.title ?? (picked?.kind === 'event' ? picked.event.title : picked?.kind === 'form' ? picked.form.name : '');
  const nothingHeard = !!tell && !paused && !heard && part >= NOTHING_HEARD_MS;
  const left = minutesLeft(part);

  const banners = (
    <>
      {micBlocked && (
        <Banner tone="alert" icon="micOff" alert title="Rekord can’t use your microphone" body="Allow it for Rekord, or type what happened instead."
          actions={[{ label: 'Allow microphone', dark: true, onClick: () => void openPermissionTab() }, { label: 'Type instead', onClick: () => { setMicBlocked(false); setMode('type'); } }]} />
      )}
      {ai === 'missing' && (
        <Banner tone="plain" icon="info" alert title="Connect an AI to catch up" body="Rekord needs it to turn what you tell it into notes. What you say goes only to the AI you connect."
          actions={[{ label: 'Connect Penv Cloud', dark: true, onClick: () => navigate('connect') }, { label: 'Paste a key', onClick: () => navigate('setupCustom') }]} />
      )}
      {error && <Banner tone="alert" icon="warn" alert title={error} />}
      {limitHit && (
        <Banner tone="plain" icon="done" title="You reached 60 minutes" body="Rekord stopped and kept everything you said. You can add more from the meeting page."
          actions={[{ label: 'Continue', dark: true, onClick: () => replace('catchupQuestions', { meetingId }) }]} />
      )}
      {short && (
        <Banner tone="plain" icon="info" title="Say a little more" body="Rekord needs a few sentences to work with. Who was there is a good start."
          actions={[{ label: 'Keep talking', dark: true, onClick: () => setShort(false) }, { label: 'Discard', onClick: () => void discard() }]} />
      )}
      {textFailed && (
        <Banner tone="alert" icon="warn" alert title="Couldn’t turn your telling into text" body="Your audio is saved on this computer. Nothing was lost."
          actions={[{ label: 'Try again', dark: true, onClick: () => { setTextFailed(false); void send({ type: 'transcription/catch-up' }); } }, { label: 'Type it instead', onClick: toType }]} />
      )}
      {offline && <Banner tone="plain" icon="offline" title="You’re offline" body="Keep talking. Your audio is saved on this computer and turned into text when you’re back." />}
      {tell && !paused && limit === 'warn' && (
        <Banner tone="warn" icon="info" title={`${left} ${left === 1 ? 'minute' : 'minutes'} left`} body="A catch-up can run 60 minutes. Wrap up now, or add more later from the meeting page." />
      )}
      {nothingHeard && mode === 'talk' && (
        <Banner tone="warn" icon="micOff" title="Rekord hasn’t heard anything yet" body="Check your microphone is on and not muted, then keep talking."
          actions={[{ label: 'Type instead', onClick: toType }]} />
      )}
    </>
  );
  const hasBanner = micBlocked || ai === 'missing' || !!error || limitHit || short || textFailed || offline || (!!tell && !paused && limit === 'warn') || (nothingHeard && mode === 'talk');
  const bannerBox = hasBanner ? <div className="ct-banners">{banners}</div> : null;

  if (mode === 'type') {
    return (
      <div className="ct-screen">
        <TellType title={title} rows={rows} covered={covered} text={typed} onText={(t) => { setTyped(t); setShort(false); }}
          onTalk={toTalk} onDone={() => void finish()} canDone={canFinish} banners={bannerBox} />
        {confirm && <LeaveDialog onKeep={() => setConfirm(false)} onSave={() => void finish()} onDiscard={() => void discard()} />}
      </div>
    );
  }

  const label = adding ? 'Adding more' : paused ? 'Paused' : 'Catching up';
  const sub = adding ? `${label} · ${mmss(part)}` : `${label} · ${mmss(clock)}`;
  const warn = !!tell && !paused && limit === 'warn';
  const lines = voice.slice(-LINES);
  const live = tell && !paused;
  const shown: { key: string; at: string; text: string; caret: boolean }[] = [
    ...lines.map((s, i) => ({ key: s.id, at: live && !interim && i === lines.length - 1 ? 'now' : mmss(s.startMs), text: s.text, caret: !!live && !interim && i === lines.length - 1 })),
    ...(interim && live ? [{ key: 'interim', at: 'now', text: interim.text, caret: true }] : []),
  ];

  return (
    <div className="ct-screen">
      <div className="ct-barwrap">
        <div className="ct-bar">
          <button type="button" className="ct-bar-back" aria-label="Back" onClick={onBack}><BackArrow /></button>
          <span className={live ? 'ct-dot' : 'ct-dot ct-dot-off'} />
          <div className="ct-bar-text">
            <span className="ct-bar-title">{title}</span>
            <span className={warn ? 'ct-bar-sub ct-bar-sub-warn' : 'ct-bar-sub'}>{warn ? `${sub} · ${left} min left` : sub}</span>
          </div>
          {paused ? (
            <button type="button" className="ct-bar-resume" aria-label="Resume" onClick={() => void pause(false)}><MicIcon size={15} />Resume</button>
          ) : (
            <button type="button" className="ct-bar-icon" aria-label="Pause" onClick={() => tell && void pause(true)}><PauseBars /></button>
          )}
          <button type="button" className="ct-bar-stop" aria-disabled={!canFinish || undefined} onClick={() => void finish()}>Stop</button>
        </div>
      </div>
      <div className="ct-row">
        <span className={live && !nothingHeard ? 'ct-row-mic' : 'ct-row-mic ct-row-mic-off'}><MicIcon /></span>
        {paused ? (
          <span className="ct-row-label">The microphone is off while paused. Prompts stay as they are.</span>
        ) : (
          <>
            <Meter levels={nothingHeard ? [] : levels} />
            <span className="ct-row-label">{nothingHeard ? 'No sound' : live ? 'Listening' : ''}</span>
          </>
        )}
        <button type="button" className="ct-switch" onClick={toType}><KeyboardIcon />Type instead</button>
      </div>
      {adding && <p className="ct-note">Goes on the end of your telling. Prompts show what is already covered.</p>}
      {bannerBox}
      <Prompts rows={rows} covered={covered} />
      <section aria-label="What you said" aria-live="polite" className="ct-words">
        <div aria-hidden="true" className="ct-words-fade" />
        {shown.map((l) => (
          <div key={l.key} className="ct-line">
            <span className="ct-av">Y</span>
            <div className="ct-line-text">
              <span className="ct-line-meta"><b>You</b> · <span className="ct-mono">{l.at}</span></span>
              <span className="ct-line-said">{l.text}{l.caret && <span className="ct-caret" aria-hidden="true" />}</span>
            </div>
          </div>
        ))}
      </section>
      <p className="ct-foot">Say names and dates out loud. Up to 60 min.</p>
      {confirm && <LeaveDialog onKeep={() => setConfirm(false)} onSave={() => void finish()} onDiscard={() => void discard()} />}
    </div>
  );
}
