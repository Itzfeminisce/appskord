import type { ReactNode } from 'react';
import { offClock } from '@/lib/live/offRecord';
import { EyeOffIcon, LockIcon } from './liveIcons';

/** V4OffRecord: the panel goes dark; nothing from now is transcribed, sent or remembered. */
export function OffRecordView({ title, clock, since, now, lines, ending, onBack, onEnd }: {
  title: string; clock: string; since: number; now: number; lines: ReactNode; ending: boolean; onBack: () => void; onEnd: () => void;
}) {
  return (
    <main className="lv off">
      <div className="lv-bar-wrap">
        <div className="lv-bar">
          <span className="lv-off-icon"><EyeOffIcon /></span>
          <div className="lv-bar-text">
            <span className="lv-title">{title}</span>
            <span className="lv-clock">Recording · {clock}</span>
          </div>
          <button type="button" className="lv-end" onClick={onEnd} disabled={ending}>{ending ? 'Ending…' : 'End'}</button>
        </div>
      </div>
      <section aria-label="Off the record" className="lv-off-card">
        <span className="lv-off-badge"><EyeOffIcon size={24} stroke={1.9} /></span>
        <h1 role="timer">Off the record · {offClock(since, now)}</h1>
        <p>Rekord isn’t listening. Nothing from now is transcribed, sent or remembered.</p>
        <button type="button" className="lv-back-on" onClick={onBack}><span aria-hidden="true" />Back on the record</button>
      </section>
      <section aria-label="Transcript so far" className="lv-off-lines">
        {lines}
        <div className="lv-gap">
          <i /><EyeOffIcon size={13} stroke={2.2} /><span className="mono">Off the record · now</span><i />
        </div>
      </section>
      <div className="lv-off-foot"><LockIcon /> Notes and marks are paused too.</div>
    </main>
  );
}
