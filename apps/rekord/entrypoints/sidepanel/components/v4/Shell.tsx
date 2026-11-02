import { useEffect, useState, type ReactNode } from 'react';
import { rankOpenLoops } from '@/lib/memory/rank';
import { openLoops } from '@/lib/memory/store';
import { useCalendar } from '../CalendarCard';
import { useRouter } from '../../router';
import { Header } from './Header';
import { nearMeeting } from './recordBar';
import { world } from './world';
import './shell.css';
import { refreshBadge } from '@/lib/messages';

export type ShellTab = 'loops' | 'meetings' | 'people';

const TABS: { id: ShellTab; label: string; screen: string }[] = [
  { id: 'loops', label: 'Open loops', screen: 'home' },
  { id: 'meetings', label: 'Meetings', screen: 'library' },
  { id: 'people', label: 'People', screen: 'people' },
];

/** Overdue promises, for the Open loops count; also asks the background to refresh the toolbar badge. */
export function useOverdue(): number {
  const [overdue, setOverdue] = useState(0);
  useEffect(() => {
    let alive = true;
    const now = world.now();
    openLoops(now)
      .then((items) => alive && setOverdue(rankOpenLoops(items, now).overdue))
      .catch((error) => console.error('Rekord: could not count overdue promises', error));
    refreshBadge();
    return () => { alive = false; };
  }, []);
  return overdue;
}

function Tabs({ tab }: { tab: ShellTab }) {
  const { navigate, has } = useRouter();
  const overdue = useOverdue();
  return (
    <nav aria-label="Rekord sections" className="v4-tabs">
      {TABS.map((t) => {
        const current = t.id === tab;
        const screen = t.screen;
        const ready = has(screen);
        return (
          <button
            key={t.id} type="button" className="v4-tab" aria-current={current ? 'page' : undefined} aria-disabled={!ready || undefined}
            onClick={() => { if (!current && has(screen)) navigate(screen); }}
          >
            {t.label}
            {t.id === 'loops' && overdue > 0 && <span className="v4-tab-count">{overdue}</span>}
          </button>
        );
      })}
    </nav>
  );
}

/** The 72 px record bar; within 10 minutes of a calendar meeting it names the meeting and offers its brief. */
export function RecordBar() {
  const { navigate, has } = useRouter();
  const calendar = useCalendar();
  const events = world.events ?? (calendar.status === 'ready' ? calendar.events : []);
  const near = nearMeeting(events, world.now());
  const brief: string = 'brief';
  return (
    <div className="v4-record">
      <button type="button" className="v4-record-btn" onClick={() => navigate('start')}>
        <span className="v4-record-dot" />
        {near ? `Record ${near.title}` : 'Start recording'}
      </button>
      {near && (
        <button type="button" className="v4-brief" aria-disabled={!has(brief) || undefined} onClick={() => { if (has(brief)) navigate(brief); }}>
          Brief
        </button>
      )}
    </div>
  );
}

/** Header, tabs and record bar shared by every v4 tab screen; the body scrolls under a soft fade. */
export function Shell({ tab, children }: { tab: ShellTab; children?: ReactNode }) {
  return (
    <div className="v4-shell">
      <Header />
      <Tabs tab={tab} />
      <main className="v4-body">
        <div className="v4-scroll">{children}</div>
        <div className="v4-fade" aria-hidden="true" />
      </main>
      <RecordBar />
    </div>
  );
}
