import { useEffect, useState, type ReactNode } from 'react';
import { getMeeting } from '@/lib/db';
import { ledgerForMeeting, listLedger } from '@/lib/memory/store';
import { redactionsOf } from '@/lib/redact';
import type { Meeting } from '@/lib/types';
import { BackIcon, LockIcon } from '../../components/v4/icons';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { day, dayMonth, meetingRows, periodStart, periodTotals, PERIODS, type LedgerIcon, type Period, type ServiceTotal } from './ledgerView';
import '../../components/v4/shell.css';
import './v4.css';

const svg = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const ICONS: Record<LedgerIcon, ReactNode> = {
  calendar: <svg {...svg}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
  up: <svg {...svg}><path d="M12 19V6M7 11l5-5 5 5" /></svg>,
  check: <svg {...svg}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  power: <svg {...svg}><path d="M12 4v8M7 7a7 7 0 1010 0" /></svg>,
  lock: <LockIcon size={16} />,
  tasks: <svg {...svg}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>,
  page: <svg {...svg}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /></svg>,
  down: <svg {...svg}><path d="M12 5v13M7 13l5 5 5-5" /></svg>,
  none: <svg {...svg}><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>,
};
const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6E7079" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lg-chev"><path d="M9 6l6 6-6 6" /></svg>
);

interface Row { id: string; name: string; detail: string; time: string; icon: LedgerIcon; dark: boolean }

function Rows({ rows }: { rows: Row[] }) {
  return (
    <ul aria-label="Services" className="lg-list">
      {rows.map((r) => (
        <li key={r.id} className={r.dark ? 'lg-row lg-dark' : 'lg-row'}>
          <span className="lg-icon">{ICONS[r.icon]}</span>
          <span className="lg-text"><span className="lg-name">{r.name}</span><span className="lg-detail">{r.detail}</span></span>
          <span className="lg-time">{r.time}</span>
        </li>
      ))}
    </ul>
  );
}

/** V4LedgerAll: totals per service for "This week", "This month" or "All time"; each row opens the meetings. */
function AllMeetings() {
  const { navigate, back, canGoBack, replace } = useRouter();
  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<{ from: number; rows: ServiceTotal[] } | null>(null);
  useEffect(() => {
    let alive = true;
    listLedger().then((entries) => {
      const now = world.now();
      const from = periodStart(period, now, entries);
      if (alive) setData({ from, rows: periodTotals(entries, from, now) });
    }).catch((error) => {
      console.error('Rekord: could not read the ledger', error);
      if (alive) setData({ from: world.now(), rows: [] });
    });
    return () => { alive = false; };
  }, [period]);

  return (
    <div className="v4-shell">
      <header className="lg-head">
        <button type="button" className="v4-icon lg-back" aria-label="Back to settings" onClick={() => (canGoBack ? back() : replace('settingsMemory'))}>
          <BackIcon />
        </button>
      </header>
      <div className="lg-body">
        <div className="lg-title">
          <h1>What left this computer</h1>
          <span>{data ? `Settings · ${dayMonth(data.from)} to ${dayMonth(world.now())}` : ''}</span>
        </div>
        <div role="group" aria-label="Period" className="lg-periods">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}><span>{p.label}</span></button>
          ))}
        </div>
        {data && (
          <ul aria-label="Services" className="lg-list">
            {data.rows.map((r) => (
              <li key={r.service} className="lg-item">
                <button type="button" className="lg-row lg-link" onClick={() => navigate('library')}>
                  <span className="lg-icon">{ICONS[r.icon]}</span>
                  <span className="lg-text"><span className="lg-name">{r.name}</span><span className={r.none ? 'lg-detail lg-none' : 'lg-detail'}>{r.detail}</span></span>
                  <Chevron />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="lg-foot">Nothing else left this computer. Rekord has no server.</p>
      </div>
    </div>
  );
}

/** V4Ledger: what left this computer for one meeting; without a meeting in the route, V4LedgerAll. */
export default function Ledger() {
  return useRouter().route.params.meetingId ? <OneMeeting /> : <AllMeetings />;
}

function OneMeeting() {
  const { route, navigate, back, canGoBack, replace } = useRouter();
  const meetingId = route.params.meetingId!;
  const [data, setData] = useState<{ meeting?: Meeting; rows: Row[] } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([getMeeting(meetingId), ledgerForMeeting(meetingId)])
      .then(([meeting, entries]) => { if (alive) setData({ meeting, rows: meetingRows(entries, redactionsOf(meeting)) }); })
      .catch((error) => {
        console.error('Rekord: could not read the ledger', error);
        if (alive) setData({ rows: [] });
      });
    return () => { alive = false; };
  }, [meetingId]);

  return (
    <div className="v4-shell">
      <header className="lg-head">
        <button type="button" className="v4-icon lg-back" aria-label="Back to meeting" onClick={() => (canGoBack ? back() : replace('home'))}>
          <BackIcon />
        </button>
      </header>
      <div className="lg-body">
        <div className="lg-title">
          <h1>What left this computer</h1>
          <span>{data?.meeting ? `${data.meeting.title} · ${day(data.meeting.startedAt)}` : ''}</span>
        </div>
        {data && <Rows rows={data.rows} />}
        <p className="lg-foot">Nothing else left this computer. Rekord has no server.</p>
        <button type="button" className="lg-all" onClick={() => navigate('ledger')}>All meetings · this week</button>
      </div>
    </div>
  );
}
