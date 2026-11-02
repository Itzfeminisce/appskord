import { useCallback, useEffect, useRef, useState } from 'react';
import { trimTelling, type CatchupStatus, type QuestionsState, type ToldBefore } from '@/lib/catchup/pipeline';
import { TELL_PORT } from '@/lib/catchup/session';
import { getMeeting, listSegments } from '@/lib/db';
import { mergeSegment } from '@/lib/live';
import { onMessage, send } from '@/lib/messages';
import { openPermissionTab } from '@/lib/mic';
import type { Meeting, RecordingState, Segment } from '@/lib/types';
import { Spinner } from '../../components';
import type { RecordingReply } from '../../../background';
import { useRouter } from '../../router';
import { activeQuestion, answerText, cardState, METER_BARS, pickedOf, questionCount } from './tell';
import { Banner, Meter, MicIcon, SendIcon, Tick } from './tellParts';

/** Dev frame routes only: the questions and answers the frame shows, and what it has typed into the active card. */
export const followUpsDev: {
  questions?: QuestionsState; status?: CatchupStatus; draft?: string;
  /** A V41StatesMore card: a question reopened after Change, or answered by voice from `fromMs` of the telling. */
  reopened?: string; voice?: { questionId: string; fromMs: number; levels: number[] };
} = {};

const POLL_MS = 1_500;
/** The question card's meter is shorter than the telling's (V41StatesMore). */
const VOICE_BARS = 11;
const ASK_AGAIN_AFTER_MS = 6_000;

/** V41Questions: up to three questions about gaps in the telling; answer by voice or text, or skip. "Finish" puts it together. */
export default function FollowUps() {
  const { route, replace, navigate } = useRouter();
  const meetingId = route.params.meetingId ?? '';
  const [questions, setQuestions] = useState<QuestionsState | undefined>();
  const [status, setStatus] = useState<CatchupStatus | undefined>();
  const [meeting, setMeeting] = useState<Meeting | undefined>();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [reopened, setReopened] = useState<string | undefined>(followUpsDev.reopened);
  const [draft, setDraft] = useState(followUpsDev.draft ?? '');
  const [voiceFor, setVoiceFor] = useState<string | undefined>(followUpsDev.voice?.questionId);
  const [voiceFrom, setVoiceFrom] = useState(followUpsDev.voice?.fromMs ?? 0);
  const voiceBefore = useRef<ToldBefore | undefined>(undefined);
  const [levels, setLevels] = useState<number[]>(followUpsDev.voice?.levels ?? []);
  const [busy, setBusy] = useState(false);
  const port = useRef<ReturnType<typeof browser.runtime.connect> | undefined>(undefined);
  const asked = useRef(false);
  const since = useRef(Date.now());

  const load = useCallback(async () => {
    const [q, st, m, segs] = await Promise.all([
      followUpsDev.questions ?? send<QuestionsState | undefined>({ type: 'catchup/questions', meetingId }),
      followUpsDev.status ?? send<CatchupStatus>({ type: 'catchup/progress', meetingId }),
      getMeeting(meetingId), listSegments(meetingId),
    ]);
    setQuestions(q ?? undefined);
    if (st) setStatus(st);
    setMeeting(m);
    setSegments(segs);
    // The background asks after every telling; ask again if nothing is under way (a worker that restarted).
    if (!q && !asked.current && Date.now() - since.current >= ASK_AGAIN_AFTER_MS) {
      asked.current = true;
      void send({ type: 'catchup/ask-again', meetingId });
    }
    return q;
  }, [meetingId]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => load().then((q) => {
      if (alive && (!q || q.status === 'waiting')) timer = setTimeout(tick, POLL_MS);
    }, (error) => console.error('Rekord: could not load the questions', error));
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [load]);

  // A voice answer's words and level while the mic is on.
  useEffect(() => {
    if (!voiceFor) return undefined;
    return onMessage((msg) => {
      if (msg.type === 'recording/state' && msg.state.status === 'recording') setLevels((l) => [...l, msg.state.status === 'recording' ? msg.state.micLevel : 0].slice(-METER_BARS));
      else if (msg.type === 'segment/added' && msg.segment.meetingId === meetingId && !msg.segment.interim) setSegments((s) => mergeSegment(s, msg.segment));
      return undefined;
    });
  }, [voiceFor, meetingId]);
  useEffect(() => () => { port.current?.disconnect(); }, []);

  const list = status?.questions ?? [];
  const active = activeQuestion(list, reopened);
  const picked = meeting ? pickedOf(meeting) : undefined;

  const done = async () => { setReopened(undefined); setDraft(''); await load(); };

  async function save(id: string) {
    if (voiceFor) { await stopVoice(); return; }
    const text = draft.trim();
    if (!text || !picked || busy) return;
    setBusy(true);
    const reply = await send<RecordingReply>({ type: 'catchup/typed', catchup: { meetingId, picked, append: true, questionId: id }, text }).catch(() => undefined);
    setBusy(false);
    if (reply?.ok) await done();
  }

  async function startVoice(id: string) {
    if (!picked || busy) return;
    setBusy(true);
    const m = await getMeeting(meetingId).catch(() => undefined);
    voiceBefore.current = m?.told ? { ms: m.told.ms, parts: m.told.parts.length, status: m.status } : undefined;
    const reply = await send<RecordingReply>({ type: 'recording/start', tabId: -1, catchup: { meetingId, picked, append: true, questionId: id } }).catch(() => undefined);
    setBusy(false);
    if (reply?.ok) {
      port.current = browser.runtime.connect({ name: TELL_PORT });
      const state = await send<RecordingState>({ type: 'recording/get-state' }).catch(() => undefined);
      setVoiceFrom(state && state.status !== 'idle' && state.tell ? state.tell.offsetMs : meeting?.told?.ms ?? 0);
      setLevels([]);
      setVoiceFor(id);
    } else if (reply && !reply.ok && reply.micBlocked) void openPermissionTab();
  }

  /** Ends a voice answer; `discard` ("Skip") keeps none of it and the telling goes back to how it was. */
  async function stopVoice(discard = false) {
    setBusy(true);
    await send({ type: 'recording/stop', ...(discard && { discard: true as const }) }).catch(() => undefined);
    if (discard && voiceBefore.current) await trimTelling(meetingId, voiceBefore.current).catch((error) => console.error('Rekord: could not discard the answer', error));
    voiceBefore.current = undefined;
    port.current?.disconnect();
    port.current = undefined;
    setVoiceFor(undefined);
    setBusy(false);
    await done();
  }

  async function skip(id: string) {
    if (voiceFor) await stopVoice(true);
    const st = await send<CatchupStatus>({ type: 'catchup/skip', meetingId, questionId: id }).catch(() => undefined);
    if (st) setStatus(st);
    setReopened(undefined);
    setDraft('');
  }

  async function finish() {
    if (voiceFor) await stopVoice();
    void send({ type: 'catchup/finish', meetingId });
    replace('catchupProcessing', { meetingId });
  }

  const ready = questions?.status === 'ready' || questions?.status === 'failed';
  const textFailed = questions?.status === 'failed' && questions.failed === 'transcribe';
  const none = questions?.status === 'ready' && list.length === 0;

  return (
    <div className="ct-screen">
      <header className="ct-q-head">
        <div className="ct-q-title"><h1>A few quick questions</h1>{list.length > 0 && <span className="ct-q-count">{questionCount(list, active)}</span>}</div>
        <p>About gaps in what you told Rekord. Skip any of them.</p>
      </header>
      <main className="ct-q-main">
        {!ready && <div className="ct-q-loading"><Spinner label="Reading your telling" size={24} /></div>}
        {textFailed && (
          <Banner tone="alert" icon="warn" alert title="Couldn’t turn your telling into text" body="Your audio is saved on this computer. Nothing was lost."
            actions={[
              { label: 'Try again', dark: true, onClick: () => { void send({ type: 'transcription/catch-up' }); void send({ type: 'catchup/ask-again', meetingId }).then(() => load()); } },
              { label: 'Type it instead', onClick: () => navigate('catchupTell', { meetingId, mode: 'type' }) },
            ]} />
        )}
        {none && (
          <div className="ct-none">
            <div className="ct-none-top"><span><Tick size={14} /></span><span>No questions. You covered it all.</span></div>
            <button type="button" className="ct-finish" onClick={() => void finish()}>Finish</button>
          </div>
        )}
        {list.map((q, i) => {
          const state = cardState(q, active);
          const said = answerText(meeting, segments, q.id);
          const n = i + 1;
          if (state !== 'active') {
            return (
              <section key={q.id} aria-label={`Question ${n}`} className="ct-card">
                <div className="ct-card-top">
                  <span className={state === 'answered' ? 'ct-num ct-num-done' : 'ct-num'}>{state === 'answered' ? <Tick /> : n}</span>
                  <p className="ct-card-q">{q.text}</p>
                </div>
                {state === 'answered' && (
                  <div className="ct-card-row ct-card-said">
                    <span>You said {said && <b>{`“${said}”`}</b>}</span>
                    <button type="button" className="ct-small" onClick={() => { setReopened(q.id); setDraft(said ?? ''); }}>Change</button>
                  </div>
                )}
                {state === 'skipped' && (
                  <div className="ct-card-row ct-card-said">
                    <span>Skipped. It stays an open question.</span>
                    <button type="button" className="ct-small" onClick={() => { setReopened(q.id); setDraft(''); }}>Answer</button>
                  </div>
                )}
              </section>
            );
          }
          const voice = voiceFor === q.id;
          const heard = segments.filter((s) => s.startMs >= voiceFrom).map((s) => s.text.trim()).join(' ');
          const isReopened = reopened === q.id && q.state !== 'open';
          return (
            <section key={q.id} aria-label={`Question ${n}`} className="ct-card ct-card-active">
              <div className="ct-card-top"><span className="ct-num ct-num-active">{n}</span><p className="ct-card-q">{q.text}</p></div>
              <div className="ct-card-row">
                <button type="button" className="ct-voice" aria-label={voice ? 'Stop answering by voice' : 'Answer by voice'} aria-pressed={voice || undefined}
                  onClick={() => void (voice ? stopVoice() : startVoice(q.id))}><MicIcon size={18} /></button>
                {voice ? (
                  <>
                    <Meter levels={levels} bars={VOICE_BARS} />
                    <span className="ct-row-label">Listening</span>
                  </>
                ) : (
                  <>
                    <label htmlFor={`a-${q.id}`} className="ct-sr">Your answer</label>
                    <input id={`a-${q.id}`} type="text" className="ct-answer" value={draft} onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void save(q.id); }} />
                  </>
                )}
                <button type="button" className="ct-send" aria-label="Save answer" onClick={() => void save(q.id)}><SendIcon /></button>
              </div>
              {voice && heard && <p aria-live="polite" className="ct-heard">{heard}</p>}
              {voice ? (
                <div className="ct-card-foot">
                  <span>Click the mic again to stop.</span>
                  <button type="button" className="ct-skip" onClick={() => void skip(q.id)}>Skip</button>
                </div>
              ) : isReopened ? (
                <div className="ct-card-foot">
                  <span>{q.state === 'answered' && said ? `Your answer was “${said}”` : ''}</span>
                  <button type="button" className="ct-skip" onClick={() => { setReopened(undefined); setDraft(''); }}>Cancel</button>
                </div>
              ) : (
                <div className="ct-card-foot ct-card-foot-end">
                  <button type="button" className="ct-skip" onClick={() => void skip(q.id)}>Skip</button>
                </div>
              )}
            </section>
          );
        })}
      </main>
      {!none && (
        <div className="ct-q-foot"><button type="button" className="ct-finish" onClick={() => void finish()}>Finish</button></div>
      )}
    </div>
  );
}
