import { useEffect, useState } from 'react';
import { PROVIDERS } from '@appskord/llm';
import { clock } from '@/lib/calendar';
import { listMeetings } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { BackIcon, CheckIcon, PauseIcon } from '../../components/v4/icons';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { BACKFILL_KEY, backfillView, moreLine, type BackfillMeeting, type BackfillProgress } from './backfillView';
import '../../components/v4/shell.css';
import './v4.css';

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');

function useProgress(): BackfillProgress | null {
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  useEffect(() => {
    let alive = true;
    browser.storage.local.get(BACKFILL_KEY)
      .then((stored) => alive && setProgress((stored[BACKFILL_KEY] as BackfillProgress | undefined) ?? null))
      .catch((error) => console.error('Rekord: could not read memory progress', error));
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && BACKFILL_KEY in changes) setProgress((changes[BACKFILL_KEY]!.newValue as BackfillProgress | undefined) ?? null);
    };
    browser.storage.onChanged.addListener(listener);
    return () => { alive = false; browser.storage.onChanged.removeListener(listener); };
  }, []);
  return progress;
}

function Row({ meeting, startedAt, paused }: { meeting: BackfillMeeting; startedAt?: number; paused: boolean }) {
  return (
    <li className={`bf-row bf-${meeting.status}`}>
      <span className="bf-dot" />
      <span className="bf-row-text">
        <span className="bf-row-title">{meeting.title}</span>
        {startedAt !== undefined && <span className="bf-row-date">{day(startedAt)}</span>}
      </span>
      {meeting.status === 'done' && <span className="bf-state"><CheckIcon />{meeting.found ?? 0} found</span>}
      {meeting.status === 'working' && paused && <span className="bf-state"><PauseIcon size={14} stroke={2.2} />Paused</span>}
      {meeting.status === 'working' && !paused && <span className="bf-spin" />}
      {meeting.status === 'waiting' && <span className="bf-wait">Waiting</span>}
    </li>
  );
}

export default function Backfill() {
  const { back, canGoBack, replace } = useRouter();
  const progress = useProgress();
  const [dates, setDates] = useState<Record<string, number>>({});
  const [ai, setAi] = useState(PROVIDERS.groq.label);

  useEffect(() => {
    listMeetings()
      .then((list) => setDates(Object.fromEntries(list.map((m) => [m.id, m.startedAt]))))
      .catch((error) => console.error('Rekord: could not load your meetings', error));
    getSettings()
      .then((s) => setAi(PROVIDERS[s.summary.provider].label))
      .catch((error) => console.error('Rekord: could not load your settings', error));
  }, []);

  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const paused = progress?.resumeAt !== undefined && progress.resumeAt > world.now();
  const finished = total > 0 && done >= total;
  const view = backfillView(progress?.meetings ?? []);
  const t = progress?.totals;

  return (
    <div className="v4-shell">
      <header className="bf-head">
        <button type="button" className="v4-icon bf-back" aria-label="Back" onClick={() => (canGoBack ? back() : replace('home'))}><BackIcon /></button>
        <div className="bf-head-text">
          <h1>Building memory</h1>
          {total > 0 && <span>{done} of {total} meetings</span>}
        </div>
      </header>
      {total > 0 && (
        <div className="bf-progress">
          <div role="progressbar" aria-label="Memory progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="bf-bar">
            <div style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </div>
          <div className="bf-sofar">
            <span className="bf-mono">{done} of {total}</span>
            {t && <span>So far: {t.promises} promises, {t.decisions} decisions, {t.people} people</span>}
          </div>
        </div>
      )}
      {paused && (
        <section aria-label="Paused" className="bf-paused">
          <span className="bf-paused-icon"><PauseIcon /></span>
          <span className="bf-paused-text">
            <span className="bf-paused-title">Paused for now</span>
            <span>{ai}’s free limit is used up for now. Rekord carries on at {clock(progress!.resumeAt!)} by itself.</span>
          </span>
        </section>
      )}
      {view.rows.length > 0 && (
        <section aria-label="Meetings" className="bf-list">
          <ul>
            {view.rows.map((m) => <Row key={m.id} meeting={m} startedAt={dates[m.id]} paused={paused} />)}
          </ul>
          {view.more.count > 0 && <div className="bf-more">{moreLine(view.more)}</div>}
        </section>
      )}
      <p className="bf-note">You can close Rekord. It keeps going in the background.</p>
      {finished && t && (
        <button type="button" className="bf-toast" onClick={() => replace('home')}>
          <CheckIcon size={16} /><span>Memory is ready: {t.promises} promises, {t.decisions} decisions, {t.people} people</span>
        </button>
      )}
    </div>
  );
}
