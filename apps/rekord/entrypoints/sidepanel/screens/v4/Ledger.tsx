import { useEffect, useState, type ReactNode } from 'react';
import { getMeeting } from '@/lib/db';
import { ledgerForMeeting, listLedger } from '@/lib/memory/store';
import { redactionsOf } from '@/lib/redact';
import type { Meeting } from '@/lib/types';
import { BackIcon, LockIcon } from '../../components/v4/icons';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import { day, meetingRows, weekTotals, type LedgerIcon } from './ledgerView';
import '../../components/v4/shell.css';
import './v4.css';

const svg = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const ICONS: Record<LedgerIcon, ReactNode> = {
  calendar: <svg {...svg}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
  up: <svg {...svg}><path d="M12 19V6M7 11l5-5 5 5" /></svg>,
  check: <svg {...svg}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  power: <svg {...svg}><path d="M12 4v8M7 7a7 7 0 1010 0" /></svg>,
  lock: <LockIcon size={16} />,
};

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

/** V4Ledger: what left this computer for one meeting, or all meetings this week (no meeting in the route). */
export default function Ledger() {
  const { route, navigate, back, canGoBack, replace } = useRouter();
  const meetingId = route.params.meetingId;
  const [data, setData] = useState<{ meeting?: Meeting; rows: Row[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (meetingId) {
        const [meeting, entries] = await Promise.all([getMeeting(meetingId), ledgerForMeeting(meetingId)]);
        return { meeting, rows: meetingRows(entries, redactionsOf(meeting)) };
      }
      const totals = weekTotals(await listLedger(), world.now());
      return {
        rows: totals.map((t) => ({
          id: t.service, name: t.name, icon: t.icon, dark: t.dark, time: String(t.count),
          detail: t.service === 'off-record' ? 'nothing sent' : t.whats.join(' · '),
        })),
      };
    };
    load().then((d) => { if (alive) setData(d); }).catch((error) => {
      console.error('Rekord: could not read the ledger', error);
      if (alive) setData({ rows: [] });
    });
    return () => { alive = false; };
  }, [meetingId]);

  const sub = meetingId
    ? data?.meeting ? `${data.meeting.title} · ${day(data.meeting.startedAt)}` : ''
    : 'All meetings · this week';

  return (
    <div className="v4-shell">
      <header className="lg-head">
        <button type="button" className="v4-icon lg-back" aria-label={meetingId ? 'Back to meeting' : 'Back'} onClick={() => (canGoBack ? back() : replace('home'))}>
          <BackIcon />
        </button>
      </header>
      <div className="lg-body">
        <div className="lg-title">
          <h1>What left this computer</h1>
          <span>{sub}</span>
        </div>
        {data && <Rows rows={data.rows} />}
        <p className="lg-foot">Nothing else left this computer. Rekord has no server.</p>
        {meetingId && (
          <button type="button" className="lg-all" onClick={() => navigate('ledger')}>All meetings · this week</button>
        )}
      </div>
    </div>
  );
}
