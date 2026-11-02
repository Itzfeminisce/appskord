import type { CalendarEvent } from '@/lib/types';
import { attendeeName, clock } from '@/lib/calendar';
import { DISMISSED_KEY } from '@/lib/catchup/types';
import { dismissedIds } from '@/lib/reminders';
import { useMissedMeetings } from '../../components/CalendarCard';
import { world } from '../../components/v4/world';
import { useRouter } from '../../router';
import './start.css';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** "Today" or "Thu 29 Oct". */
export function dayLabel(ms: number, now = world.now()): string {
  if (sameDay(ms, now)) return 'Today';
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "4 h", "30 min", "1 h 30 min". */
export function lengthLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "Sarah, Tom, Priya": the other guests by first name. */
export const guestNames = (event: CalendarEvent): string => event.attendees.filter((a) => !a.self).map(attendeeName).join(', ');

const MicIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);

interface CardProps { event: CalendarEvent; more: number; onCatchUp: () => void; onDismiss: () => void; onMore: () => void }

/** The missed-meeting card: the latest missed meeting, "Catch up", and a way to the rest. */
export function MissedCard({ event, more, onCatchUp, onDismiss, onMore }: CardProps) {
  return (
    <section aria-label="Missed meeting" className="cu-card">
      <div className="cu-card-top">
        <span className="cu-card-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4M10 13.5l4 4M14 13.5l-4 4" /></svg>
        </span>
        <span className="cu-card-text">
          <span className="cu-card-title">{`Missed “${event.title}”?`}</span>
          <span className="cu-card-sub">{`${dayLabel(event.start)} ${clock(event.start)} to ${clock(event.end)}. Rekord didn’t record it.`}</span>
        </span>
        <button type="button" className="cu-card-x" aria-label="Dismiss. Don’t ask about this meeting again" onClick={onDismiss}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="cu-card-row">
        <button type="button" className="cu-primary-sm" onClick={onCatchUp}><MicIcon size={15} />Catch up</button>
        <span>Tell Rekord what happened</span>
      </div>
      {more > 0 && (
        <button type="button" className="cu-more" onClick={onMore}>
          <b>{more}</b> more missed {more === 1 ? 'meeting' : 'meetings'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      )}
    </section>
  );
}

/** Home's card: the latest missed meeting (none when the setting is off). Dismissing hides it for good and tells Home to show the toast. */
export function MissedStart({ onDismissed }: { onDismissed: (event: CalendarEvent) => void }) {
  const { navigate } = useRouter();
  const { missed, dismiss } = useMissedMeetings();
  const latest = missed[0]?.event;
  if (!latest) return null;
  return (
    <MissedCard
      event={latest} more={missed.length - 1}
      onCatchUp={() => navigate('catchupTell', { eventId: latest.id })}
      onDismiss={() => { onDismissed(latest); void dismiss(latest.id).catch((error) => console.error('Rekord: could not dismiss the missed-meeting card', error)); }}
      onMore={() => navigate('catchupPick')}
    />
  );
}

/** Undo for "Won’t ask about …": the card comes back. */
export async function restoreMissed(eventId: string): Promise<void> {
  try {
    const ids = await dismissedIds();
    await browser.storage.local.set({ [DISMISSED_KEY]: ids.filter((id) => id !== eventId) });
  } catch (error) {
    console.error('Rekord: could not bring back the missed-meeting card', error);
  }
}

/** "Missed a meeting? Catch up", the quiet line above the record bar; goes to the picker. */
export function CatchUpLine({ className = 'cu-quiet' }: { className?: string }) {
  const { navigate } = useRouter();
  return <button type="button" className={className} onClick={() => navigate('catchupPick')}>Missed a meeting? <b>Catch up</b></button>;
}
