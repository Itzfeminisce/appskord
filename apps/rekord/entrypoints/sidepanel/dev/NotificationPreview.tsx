// Dev only: V4Notification and V4NotificationMore drawn around the content Rekord gives Chrome (badge text, notification title, message, buttons).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { listMeetings } from '@/lib/db';
import { buildBrief, briefNote, dueNote, dueToday, type NoteContent } from '@/lib/memory/brief';
import { buildWeek, lookBackStart } from '@/lib/memory/lookback';
import { rankOpenLoops } from '@/lib/memory/rank';
import { listItems, listPeople, openLoops } from '@/lib/memory/store';
import { DUE_HOUR, oweNote, oweToday, weekNote } from '@/lib/reminders';
import { world } from '../components/v4/world';

const mark = (
  <div style={{ width: 28, height: 28, borderRadius: 9, background: '#111114', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M5 9v6M9 6v12M13 9v6M17 11v2" /></svg>
  </div>
);
const card: CSSProperties = { boxSizing: 'border-box', padding: '14px 16px 12px', borderRadius: 10, background: '#F7F7F9', border: '1px solid #D5D7DD', boxShadow: '0 10px 30px rgba(16,16,20,0.18)', display: 'flex', flexDirection: 'column', gap: 10 };
const grey: CSSProperties = { height: 44, border: 'none', borderRadius: 8, background: '#E8E8EC', font: 'inherit', fontSize: 13, fontWeight: 600, color: '#111114' };

function Note({ note, primary, when = 'now' }: { note: NoteContent; primary?: boolean; when?: string }) {
  return (
    <section aria-label={`Notification: ${note.title}`} style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#44464D' }}>{mark}<span>Rekord · Chrome</span><span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)' }}>{when}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{note.title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.4, color: '#44464D' }}>{note.message}</span>
      </div>
      {primary
        ? <button type="button" style={{ ...grey, background: '#111114', color: '#FFFFFF' }}>{note.buttons[0]?.title}</button>
        : <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{note.buttons.map((b) => <button key={b.title} type="button" style={grey}>{b.title}</button>)}</div>}
    </section>
  );
}

const badgeAt = async (now: number) => {
  const overdue = rankOpenLoops(await openLoops(now), now).overdue;
  return overdue > 0 ? String(overdue) : '';
};

export default function NotificationPreview() {
  const [notes, setNotes] = useState<{ brief: NoteContent; due?: NoteContent; badge: string }>();
  useEffect(() => {
    void (async () => {
      const now = world.now();
      const events = world.events ?? [];
      const [people, items, meetings, badge] = await Promise.all([listPeople(), listItems(), listMeetings(), badgeAt(now)]);
      const brief = buildBrief({ event: events[0]!, people, items, meetings, now });
      const item = dueToday(items, now)[0];
      const owner = people.find((p) => p.id === item?.ownerId);
      setNotes({ brief: briefNote(brief, now), due: item && owner ? dueNote(item, owner, events, now) : undefined, badge });
    })();
  }, []);
  return (
    <Desktop badge={notes?.badge} clock={['09:55', '02/11/2026']}>
      {notes && <>
        {notes.due && <Note note={notes.due} />}
        <Note note={notes.brief} primary />
      </>}
    </Desktop>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// The desktop's clock in V4NotificationMore: Friday 6 Nov, 16:00.
const FRIDAY = new Date(2026, 10, 6, 16, 0).getTime();

/** V4NotificationMore: Thursday's due-day note for a promise you owe, and the Friday look back for the week in the sample world. */
export function NotificationMore() {
  const [notes, setNotes] = useState<{ owe?: { note: NoteContent; when: string }; week: NoteContent; badge: string }>();
  useEffect(() => {
    void (async () => {
      const now = world.now();
      const [people, items, meetings, badge] = await Promise.all([listPeople(), listItems(), listMeetings(), badgeAt(now)]);
      const sent = new Date(FRIDAY);
      sent.setDate(sent.getDate() - 1);
      sent.setHours(DUE_HOUR, 0, 0, 0);
      const item = oweToday(items, sent.getTime())[0];
      const to = people.find((p) => p.id === item?.toId);
      const owe = item && to ? { note: oweNote(item, to, meetings.find((m) => m.id === item.meetingId)), when: `${DAYS[sent.getDay()]} ${pad(sent.getHours())}:00` } : undefined;
      setNotes({ owe, week: weekNote(buildWeek({ meetings, items, people, now, start: lookBackStart(now) })), badge });
    })();
  }, []);
  const d = new Date(FRIDAY);
  return (
    <Desktop badge={notes?.badge} clock={[`${pad(d.getHours())}:${pad(d.getMinutes())}`, `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`]}>
      {notes && <>
        {notes.owe && <Note note={notes.owe.note} when={notes.owe.when} />}
        <Note note={notes.week} primary />
      </>}
    </Desktop>
  );
}

function Desktop({ badge, clock, children }: { badge?: string; clock: [string, string]; children: ReactNode }) {
  return (
    <div style={{ width: 1366, height: 640, position: 'relative', overflow: 'hidden', background: 'linear-gradient(135deg, #B9C6E4 0%, #D8DDF0 45%, #E9D9E6 100%)', color: '#111114' }}>
      <div style={{ position: 'absolute', left: 56, top: 24, right: 56, bottom: 64, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px rgba(16,16,20,0.22)', background: '#FFFFFF', display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 40, background: '#DEE1E6', display: 'flex', alignItems: 'flex-end', padding: '0 12px', gap: 4 }}>
          <div style={{ height: 32, width: 220, boxSizing: 'border-box', padding: '0 14px', borderRadius: '10px 10px 0 0', background: '#FFFFFF', display: 'flex', alignItems: 'center', fontSize: 12 }}>Calendar</div>
        </div>
        <div style={{ height: 44, boxSizing: 'border-box', borderBottom: '1px solid #E8E8EB', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px' }}>
          <div style={{ flexGrow: 1, height: 30, borderRadius: 15, background: '#F1F3F4', display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: 13, color: '#44464D' }}>calendar.google.com</div>
          <div style={{ position: 'relative', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {mark}
            {badge && <span aria-label={`${badge} overdue`} style={{ position: 'absolute', top: -3, right: -5, minWidth: 18, height: 18, boxSizing: 'border-box', padding: '0 5px', borderRadius: 9, background: '#D92D20', color: '#FFFFFF', fontSize: 11, fontWeight: 700, lineHeight: '18px', textAlign: 'center' }}>{badge}</span>}
          </div>
        </div>
        <div style={{ flexGrow: 1, padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ width: 220, height: 18, borderRadius: 9, background: '#F1F1F3' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, flexGrow: 1 }}>
            {[0, 1, 2, 3, 4].map((n) => <div key={n} style={{ borderRadius: 12, background: '#F6F6F7' }} />)}
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 40, boxSizing: 'content-box', background: 'rgba(243,243,246,0.94)', borderTop: '1px solid #D5D7DD', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 20px', fontFamily: 'var(--mono)', fontSize: 12, color: '#44464D' }}>
        <span style={{ textAlign: 'right', lineHeight: 1.2 }}>{clock[0]}<br />{clock[1]}</span>
      </div>
      <div style={{ position: 'absolute', right: 20, bottom: 52, width: 364, display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}
