import { useEffect, useState } from 'react';
import { clock } from '@/lib/calendar';
import { getSettings } from '@/lib/settings';
import { useMissedMeetings } from '../../components/CalendarCard';
import { BackIcon } from '../../components/v4/icons';
import { EmptyCard } from '../../components/v4/states';
import { useRouter } from '../../router';
import { openGoogleConnect } from '../GoogleConnect';
import { dayLabel, guestNames, lengthLabel } from './MissedCard';
import './start.css';

const minutesOf = (e: { start: number; end: number }) => Math.round((e.end - e.start) / 60_000);

/** V41Pick: which meeting Rekord missed, from the calendar's last 7 days or "Something else". */
export default function Pick() {
  const router = useRouter();
  const { navigate, back, canGoBack, replace } = router;
  const { recent } = useMissedMeetings();
  const [connected, setConnected] = useState<boolean | undefined>();
  const [picked, setPicked] = useState<string | undefined>();
  const chosen = picked ?? recent[0]?.id;

  useEffect(() => {
    getSettings().then((s) => setConnected(s.google.calendar)).catch((error) => console.error('Rekord: could not load your settings', error));
  }, []);

  const start = () => { if (chosen) navigate('catchupTell', { eventId: chosen }); };
  return (
    <div className="cu-screen">
      <header className="cu-head">
        <button type="button" className="v4-icon" aria-label="Back" onClick={() => (canGoBack ? back() : replace('home'))}><BackIcon /></button>
        <h1>Catch up on a meeting</h1>
      </header>
      <main className="cu-body">
        <p className="cu-lead">Which meeting did Rekord miss? You tell it what happened, and it works like any meeting.</p>
        {connected === false ? (
          <EmptyCard title="Connect Google Calendar to pick from your meetings" body="Or pick “Something else” and fill in the details."
            action={{ label: 'Connect Google Calendar', onClick: () => openGoogleConnect(router, 'start') }} />
        ) : connected && recent.length === 0 ? (
          <EmptyCard title="No missed meetings in the last 7 days" body="Rekord recorded every calendar meeting. Pick “Something else” for any other." />
        ) : recent.length > 0 && (
          <fieldset className="cu-group">
            <legend>From your calendar · last 7 days</legend>
            <div className="cu-list">
              {recent.map((e) => (
                <label key={e.id} className="cu-opt" htmlFor={`m-${e.id}`}>
                  <input id={`m-${e.id}`} type="radio" name="meeting" checked={chosen === e.id} onChange={() => setPicked(e.id)} />
                  <span className="cu-opt-text">
                    <span className="cu-opt-title">{e.title}</span>
                    <span className="cu-opt-when">{`${dayLabel(e.start)} · ${clock(e.start)} · ${lengthLabel(minutesOf(e))}`}</span>
                  </span>
                  <span className="cu-opt-who">{guestNames(e)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <button type="button" className="cu-else" onClick={() => navigate('catchupPickOther')}>
          <span className="cu-else-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span>
          <span className="cu-else-text"><span>Something else</span><span>Not on your calendar, or longer ago</span></span>
          <span className="cu-else-go"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg></span>
        </button>
        <p className="cu-note">Meetings Rekord recorded are not listed.</p>
      </main>
      <div className="cu-foot cu-foot-tall">
        <button type="button" className="cu-start" aria-disabled={!chosen || undefined} onClick={start}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>Start telling
        </button>
        <span className="cu-foot-note">Uses your microphone only. Nothing from your tabs.</span>
      </div>
    </div>
  );
}
