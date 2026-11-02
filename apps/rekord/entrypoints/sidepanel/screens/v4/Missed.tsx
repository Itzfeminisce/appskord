import { useEffect, useRef } from 'react';
import { citationClock } from '@/lib/askAll';
import { MISSED_MINUTES, type MissedMinutes, type MissedResult } from '@/lib/live/missed';
import { Spinner } from '../../components';
import { ActionMark } from './liveIcons';

const CHIP: Record<MissedMinutes, string> = { 2: 'Last 2 min', 3: '3 min', 5: '5 min' };

/** V4Missed: the last few minutes in three lines over the live transcript, plus "Anything for me?". */
export function MissedSheet({ minutes, result, onMinutes, onClose }: {
  minutes: MissedMinutes; result?: MissedResult; onMinutes: (m: MissedMinutes) => void; onClose: () => void;
}) {
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => {
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <button type="button" className="lv-scrim" aria-label="Back to live" tabIndex={-1} onClick={onClose} />
      <section ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-label="What did I miss?" className="lv-sheet">
        <span aria-hidden="true" className="lv-grip" />
        <h2>What did I miss?</h2>
        <div role="group" aria-label="How far back" className="lv-chips">
          {MISSED_MINUTES.map((m) => (
            <button key={m} type="button" className="lv-chip" aria-pressed={m === minutes} onClick={() => onMinutes(m)}>{CHIP[m]}</button>
          ))}
        </div>
        {!result ? <Spinner label="Catching up" /> : result.status === 'error' ? (
          <p className="lv-sheet-note" role="alert">{result.error}</p>
        ) : result.status === 'ok' ? (
          <>
            <ul className="lv-missed">
              {result.missed.lines.map((l) => (
                <li key={`${l.atMs}-${l.text}`}><span className="mono">{citationClock(l.atMs)}</span><span>{l.text}</span></li>
              ))}
            </ul>
            {result.missed.forYou && (
              <div className="lv-for-you">
                <span><ActionMark size={14} /> Anything for me?</span>
                <span>“{result.missed.forYou}”</span>
              </div>
            )}
          </>
        ) : null}
        <button type="button" className="lv-big" onClick={onClose}><span className="lv-dot" aria-hidden="true" />Back to live</button>
      </section>
    </>
  );
}
