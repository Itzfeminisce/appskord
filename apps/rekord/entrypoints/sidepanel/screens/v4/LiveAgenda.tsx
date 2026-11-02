import { citationClock } from '@/lib/askAll';
import { minutesLeft, type AgendaTrack } from '@/lib/live/agenda';
import type { AskedYou } from '@/lib/live/questions';
import { ActionMark, SkipIcon, TickIcon, TimerIcon } from './liveIcons';

const clock = citationClock;

/** "Now · Northwind rollout date · ▬▬ · 2 min left", under the tabs, with "What did I miss?" at its right end. */
export function AgendaStrip({ track, onMissed }: { track?: AgendaTrack; onMissed: () => void }) {
  const now = track?.current && track.leftMs !== undefined ? { text: track.current.text, used: track.used ?? 0, leftMs: track.leftMs } : undefined;
  return (
    <div className="lv-strip">
      {now ? (
        <>
          <span className="lv-strip-now">Now</span>
          <span className="lv-strip-item">{now.text}</span>
          <span className="lv-strip-bar" aria-hidden="true"><span style={{ width: `${Math.round(now.used * 100)}%` }} /></span>
          <span className="lv-strip-left">{minutesLeft(now.leftMs)}</span>
        </>
      ) : <span className="lv-strip-gap" />}
      <button type="button" className="lv-strip-missed" onClick={onMissed}>What did I miss?</button>
    </div>
  );
}

/** "Sarah asked “Can you send the deck today?” · 16:05" with "Add as my promise" / "Answered". */
function Asked({ q, onPromise, onAnswered }: { q: AskedYou; onPromise: () => void; onAnswered: () => void }) {
  return (
    <section aria-label="Questions for you" className="lv-asked">
      <div className="lv-asked-head"><ActionMark size={15} /> Questions for you</div>
      <p>{q.speaker} asked “{q.text}” · <span className="mono">{clock(q.atMs)}</span></p>
      <div className="lv-row">
        <button type="button" className="lv-btn-dark" onClick={onPromise}>Add as my promise</button>
        <button type="button" className="lv-btn-soft" onClick={onAnswered}>Answered</button>
      </div>
    </section>
  );
}

/** V4LiveAgenda: items ticked live with the time covered, the current one with its time left and a skip. */
export function LiveAgenda({ track, questions, onSkip, onBringBack, onPromise, onAnswered }: {
  track: AgendaTrack; questions: AskedYou[]; onSkip: (id: string) => void; onBringBack: (id: string) => void; onPromise: (q: AskedYou) => void; onAnswered: (q: AskedYou) => void;
}) {
  return (
    <section aria-label="Agenda" className="lv-agenda">
      <ul className="lv-ag-list">
        {track.rows.map(({ item, state, coveredAtMs }) => state === 'current' ? (
          <li key={item.id} className="lv-ag-current">
            <div className="lv-ag-current-row">
              <span className="lv-ag-dot" aria-hidden="true"><span /></span>
              <span className="lv-ag-current-text">{item.text}</span>
              <button type="button" className="lv-skip" aria-label={`Skip ${item.text}`} onClick={() => onSkip(item.id)}>Skip<SkipIcon /></button>
            </div>
            {track.leftMs !== undefined && <div className="lv-left-chip"><TimerIcon /> {minutesLeft(track.leftMs)}</div>}
          </li>
        ) : (
          <li key={item.id} className={`lv-ag-row${state === 'skipped' ? ' skipped' : ''}`}>
            {state === 'covered' ? <span className="lv-ag-tick"><TickIcon /></span> : <span className="lv-ag-ring" />}
            <span className="lv-ag-text">{item.text}</span>
            {state === 'covered' && coveredAtMs !== undefined && <span className="lv-ag-when">covered {clock(coveredAtMs)}</span>}
            {state === 'next' && <span className="lv-ag-when">next</span>}
            {state === 'skipped' && <>
              <span className="lv-ag-skipped">Skipped</span>
              <button type="button" className="lv-bring" aria-label={`Bring back ${item.text}`} onClick={() => onBringBack(item.id)}>Bring back</button>
            </>}
          </li>
        ))}
      </ul>
      {questions.map((q) => <Asked key={q.id} q={q} onPromise={() => onPromise(q)} onAnswered={() => onAnswered(q)} />)}
    </section>
  );
}
