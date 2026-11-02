import { useEffect, useRef, useState } from 'react';
import { PROVIDERS } from '@appskord/llm';
import { clock } from '@/lib/calendar';
import type { CatchupStatus } from '@/lib/catchup/pipeline';
import { getMeeting } from '@/lib/db';
import { send } from '@/lib/messages';
import { getSettings } from '@/lib/settings';
import type { Meeting } from '@/lib/types';
import { useRouter } from '../../router';
import { dayOf, processingDone, stepViews, tellingLine } from './tell';
import { Banner, Tick } from './tellParts';

/** Dev frame routes only: the progress the frame shows. */
export const processingDev: { status?: CatchupStatus } = {};

const POLL_MS = 1_000;

const Sparkle = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z" /></svg>
);
const Calendar = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
);

/** V41Processing: the steps from the background's progress; opens the meeting page by itself when it is ready. */
export default function CatchupProcessing() {
  const { route, replace, navigate } = useRouter();
  const meetingId = route.params.meetingId ?? '';
  const [status, setStatus] = useState<CatchupStatus | undefined>(processingDev.status);
  const [meeting, setMeeting] = useState<Meeting | undefined>();
  const [ai, setAi] = useState(PROVIDERS.groq.label);
  const summaryAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    getMeeting(meetingId).then(setMeeting, (error) => console.error('Rekord: could not load the catch-up', error));
    getSettings().then((s) => setAi(PROVIDERS[s.summary.provider].label), () => undefined);
  }, [meetingId]);

  useEffect(() => {
    if (processingDev.status) return undefined;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const st = await send<CatchupStatus>({ type: 'catchup/progress', meetingId }).catch(() => undefined);
      if (!alive) return;
      if (st) {
        setStatus(st);
        const summary = st.steps.find((s) => s.step === 'summary');
        if (summary?.done && summaryAt.current === undefined) summaryAt.current = Date.now();
        if (processingDone(st, summaryAt.current === undefined ? 0 : Date.now() - summaryAt.current)) {
          replace('summary', { meetingId });
          return;
        }
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [meetingId, replace]);

  const steps = status ? stepViews(status) : [];
  const failed = status?.steps.find((s) => s.step === 'summary')?.failed === 'ai';
  const limit = status?.steps.find((s) => s.failed === 'limit' && s.resumesAt);
  const readTelling = () => navigate('transcript', { meetingId });
  const tryAgain = () => {
    setStatus((s) => s && { ...s, steps: s.steps.map((x) => (x.step === 'summary' ? { step: x.step, done: false } : x)) });
    void send({ type: 'catchup/finish', meetingId });
  };

  return (
    <div className="ct-screen">
      <div className="ct-proc">
        <div className="ct-proc-mark"><Sparkle /></div>
        <div className="ct-proc-text">
          <h1>Putting your catch-up together</h1>
          {meeting && <p>{tellingLine(meeting)}</p>}
        </div>
        <ol aria-label="Progress" className="ct-steps">
          {steps.map((s) => (
            <li key={s.key} className={`ct-step ct-step-${s.state}`}>
              {s.state === 'done' ? <span className="ct-tick"><Tick size={12} /></span> : s.state === 'active' ? <span className="ct-spin" /> : <span className="ct-todo" />}
              <span>{s.label}</span>
              {s.note && <span className="ct-step-note">{s.note}</span>}
            </li>
          ))}
        </ol>
        {failed && (
          <Banner tone="alert" icon="warn" alert title="Couldn’t put your catch-up together" body="Your telling and your answers are saved on this computer. Nothing was lost."
            actions={[{ label: 'Try again', dark: true, onClick: tryAgain }, { label: 'Read your telling', onClick: readTelling }]} />
        )}
        {!failed && limit?.resumesAt && (
          <Banner tone="plain" icon="clock" title="Paused for now"
            body={<span className="ct-limit-body">{`${ai}’s free limit is used up for now. Rekord carries on at `}<span className="ct-mono">{clock(limit.resumesAt)}</span> by itself.</span>}>
            <span className="ct-limit-note">You can close the panel. Rekord finishes in the background.</span>
          </Banner>
        )}
        {meeting && <p className="ct-due"><span><Calendar /></span>{`Due dates are worked out from ${dayOf(meeting.startedAt)}, the day of the meeting.`}</p>}
      </div>
      <div className="ct-proc-foot">
        <button type="button" className="ct-read" onClick={readTelling}>Read your telling meanwhile</button>
        <span>The meeting page opens by itself when it is ready. You can close the panel. Rekord finishes in the background.</span>
      </div>
    </div>
  );
}
