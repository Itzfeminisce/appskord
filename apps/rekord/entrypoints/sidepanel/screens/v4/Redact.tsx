import { useEffect, useState } from 'react';
import { getMeeting, listSegments } from '@/lib/db';
import { previewRedaction, redactSpan, redactionsOf, type RedactionMark, type RedactPreview } from '@/lib/redact';
import { getSettings } from '@/lib/settings';
import { displayName } from '@/lib/speakers';
import { formatClock } from '@/lib/time';
import type { Meeting, Segment } from '@/lib/types';
import { BackIcon } from '../../components/v4/icons';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { day, redactionLine } from './ledgerView';
import '../../components/v4/shell.css';
import './v4.css';

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" />
  </svg>
);

/** The user's own name from the invite on their lines, as the frames show it. */
export function speakerName(s: Segment, meeting: Meeting | undefined): string {
  if (s.speaker === 'you') return meeting?.event?.attendees.find((a) => a.self)?.name ?? 'You';
  return displayName(s, meeting?.speakers);
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The confirm sheet's list: only what this redaction really removes. */
export function removedLines(p: RedactPreview, folder: boolean): string[] {
  const k = p.plan.removedKinds;
  return [
    p.audio && 'The audio',
    'The transcript lines',
    p.plan.summaryLines === 1 ? 'The summary line' : p.plan.summaryLines > 1 && 'The summary lines',
    k.promise > 0 && plural(k.promise, 'promise'),
    k.decision > 0 && plural(k.decision, 'decision'),
    k.question > 0 && plural(k.question, 'question'),
    p.searchEntries > 0 && 'Search entries',
    folder && 'The Rekord folder file is rewritten',
  ].filter((x): x is string => typeof x === 'string');
}

function Line({ s, meeting, picked }: { s: Segment; meeting?: Meeting; picked?: boolean }) {
  return (
    <div className={picked ? 'rd-line rd-picked' : 'rd-line'}>
      <span className="rd-clock">{formatClock(s.startMs)}</span>
      <span className="rd-say"><span className="rd-who">{speakerName(s, meeting)}</span><span className="rd-text">{s.text}</span></span>
    </div>
  );
}

type After = { mark: RedactionMark; before?: Segment; after?: Segment; meeting?: Meeting };

/** The line before the redaction, the redaction and the line after. */
async function afterView(meetingId: string, mark: RedactionMark): Promise<After> {
  const [meeting, segments] = await Promise.all([getMeeting(meetingId), listSegments(meetingId)]);
  return { mark, meeting, before: segments.filter((s) => s.startMs < mark.startMs).at(-1), after: segments.find((s) => s.startMs >= mark.endMs) };
}

/** V4Redact: the selected span, the confirm sheet, and the transcript after redacting. */
export default function Redact() {
  const { route, navigate, back, canGoBack, replace } = useRouter();
  const { meetingId, atMs, endMs } = route.params;
  const [preview, setPreview] = useState<RedactPreview | null>(null);
  const [folder, setFolder] = useState(false);
  const [sheet, setSheet] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<After | null>(null);

  useEffect(() => {
    if (!meetingId || atMs === undefined || endMs === undefined) return;
    let alive = true;
    const load = async (): Promise<{ after: After } | { p: RedactPreview; folder: boolean }> => {
      // Opened again after redacting: show what is left.
      const meeting = await getMeeting(meetingId);
      const mark = redactionsOf(meeting).find((m) => m.startMs === atMs && m.endMs === endMs);
      if (mark) return { after: await afterView(meetingId, mark) };
      const [p, s] = await Promise.all([previewRedaction(meetingId, { startMs: atMs, endMs }, world.now()), getSettings()]);
      return { p, folder: s.memory.folder };
    };
    load()
      .then((r) => {
        if (!alive) return;
        if ('after' in r) { setDone(r.after); return; }
        setPreview(r.p);
        setFolder(r.folder);
      })
      .catch((e) => { console.error('Rekord: could not read the part to redact', e); if (alive) setError('Rekord couldn’t read this part of the transcript.'); });
    return () => { alive = false; };
  }, [meetingId, atMs, endMs]);

  const leave = () => (canGoBack ? back() : replace('home'));

  const redact = async () => {
    if (!preview || !meetingId || busy) return;
    setBusy(true);
    try {
      const { mark } = await redactSpan(meetingId, preview.span, { now: world.now() });
      setDone(await afterView(meetingId, mark));
      setSheet(false);
    } catch (e) {
      console.error('Rekord: could not redact', e);
      setError('Rekord couldn’t redact this part. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const meeting = done?.meeting ?? preview?.meeting;
  const span = preview?.span;
  const length = span ? formatClock(span.endMs - span.startMs) : '';
  const range = span ? `${formatClock(span.startMs)} to ${formatClock(span.endMs)}` : '';

  return (
    <div className="v4-shell rd">
      <header className="lg-head">
        <button type="button" className="v4-icon lg-back" aria-label="Back to meeting" onClick={leave}><BackIcon /></button>
      </header>
      <div className="rd-title">
        <h1>Transcript</h1>
        <span>{meeting ? `${meeting.title} · ${day(meeting.startedAt)}` : ''}</span>
      </div>
      {error && <p className="rd-error" role="alert">{error}</p>}
      {done ? (
        <>
          <div className="rd-card" aria-label="Transcript">
            {done.before && <Line s={done.before} meeting={meeting} />}
            <div className="rd-gone"><LockIcon /><span className="rd-gone-at">{formatClock(done.mark.startMs)}</span>Redacted · {formatClock(done.mark.endMs - done.mark.startMs)}</div>
            {done.after && <Line s={done.after} meeting={meeting} />}
          </div>
          <section className="rd-ledger" aria-label="In the ledger">
            <span className="rd-ledger-label">In the ledger</span>
            <span className="rd-ledger-line">Redacted {redactionLine(done.mark)}</span>
            <button type="button" className="rd-ledger-link" onClick={() => navigate('ledger', { meetingId })}>See what left this computer</button>
          </section>
        </>
      ) : preview && (
        <>
          <div className="rd-card" aria-label="Selected part">
            {preview.segments.map((s) => <Line key={s.id} s={s} meeting={meeting} picked />)}
          </div>
          <div className="rd-bar">
            <span className="rd-range">{range}</span>
            <button type="button" className="rd-bar-btn" onClick={() => setSheet(true)}>Redact {length}</button>
          </div>
          {sheet && (
            <>
              <div className="rd-scrim" onClick={() => setSheet(false)} />
              <div role="dialog" aria-modal="true" aria-label="Redact this part for good?" className="rd-sheet">
                <h2>Redact this part for good?</h2>
                <span className="rd-sheet-range">{range} · {length}</span>
                <ul>{removedLines(preview, folder).map((l) => <li key={l}>{l}</li>)}</ul>
                <p className="rd-warn">This can’t be undone.</p>
                <div className="rd-actions">
                  <button type="button" className="rd-go" disabled={busy} onClick={() => void redact()}>Redact</button>
                  <button type="button" className="rd-cancel" onClick={() => setSheet(false)}>Cancel</button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
