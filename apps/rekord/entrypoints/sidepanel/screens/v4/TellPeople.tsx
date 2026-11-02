import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { APP_LABEL, whenChip } from '@/lib/memory/brief';
import type { MeetingPlace } from '@/lib/capture';
import type { CalendarEvent } from '@/lib/types';
import { BrandMark } from '../../components';
import { CopyIcon, ListIcon } from './liveIcons';
import './live.css';

export const TELL_MESSAGE = 'Hi all, I’m using Rekord to take notes on this call. It runs on my computer and I can pause it any time.';

/** "1:1 with Sarah · In 5 min · Google Meet", with the agenda chip when a brief made one. */
function CalendarLine({ event, now, agendaItems, onAgenda }: { event: CalendarEvent; now: number; agendaItems?: number; onAgenda: () => void }) {
  const when = whenChip(event, now).label;
  const sub = [when.charAt(0).toUpperCase() + when.slice(1), event.app ? APP_LABEL[event.app] : undefined].filter(Boolean).join(' · ');
  return (
    <section aria-label="From your calendar" className="tp-cal">
      <span className="tp-cal-text"><span>{event.title}</span><span>{sub}</span></span>
      {agendaItems !== undefined && agendaItems > 0 && (
        <button type="button" className="tp-agenda" onClick={onAgenda}><span><ListIcon />Agenda: {agendaItems} {agendaItems === 1 ? 'item' : 'items'}</span></button>
      )}
    </section>
  );
}

export interface TellPeopleProps {
  event?: CalendarEvent; now: number; agendaItems?: number; onAgenda: () => void; onNotNow: () => void;
  every: boolean; onEvery: (on: boolean) => void;
  place: MeetingPlace; onPlace: (p: MeetingPlace, focus?: boolean) => void; placeRef: (p: MeetingPlace, el: HTMLButtonElement | null) => void;
  mic: boolean; onMic: (on: boolean) => void;
  /** Warnings and errors from the start checks, shown above Start recording. */
  notices: ReactNode; canRecord: boolean; busy: boolean; onRecord: () => void;
}

/** V4TellPeople: the start screen with the ready message to tell people Rekord is taking notes. */
export function TellPeople(p: TellPeopleProps) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(TELL_MESSAGE);
      setCopied(true);
    } catch (error) {
      console.error('Rekord: could not copy the message', error);
    }
  }
  function onKey(e: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    p.onPlace(p.place === 'tab' ? 'app' : 'tab', true);
  }
  return (
    <main className="tp">
      <header className="tp-head">
        <div className="brand"><BrandMark />Rekord</div>
        <button type="button" className="tp-link" onClick={p.onNotNow}>Not now</button>
      </header>

      {p.event && <CalendarLine event={p.event} now={p.now} agendaItems={p.agendaItems} onAgenda={p.onAgenda} />}

      <section aria-label="Before you start" className="tp-card">
        <h1>Tell people you’re taking notes</h1>
        <blockquote>{TELL_MESSAGE}</blockquote>
        <div className="tp-copy-row">
          <button type="button" className="tp-copy" onClick={() => void copy()}><CopyIcon /> Copy message</button>
          <label className="tp-every">
            <input type="checkbox" checked={p.every} onChange={(e) => p.onEvery(e.target.checked)} />Show this every time
          </label>
        </div>
        {copied && <p className="tp-copied" role="status">Copied. Paste it in the meeting chat.</p>}
        <div className="tp-rule" />
        <div className="tp-where">
          <span id="where-lbl" className="tp-where-lbl">Where is the meeting?</span>
          <div role="radiogroup" aria-labelledby="where-lbl" className="tp-seg" onKeyDown={onKey}>
            <button type="button" role="radio" aria-checked={p.place === 'tab'} tabIndex={p.place === 'tab' ? 0 : -1} ref={(el) => p.placeRef('tab', el)} onClick={() => p.onPlace('tab')}>In this tab</button>
            <button type="button" role="radio" aria-checked={p.place === 'app'} tabIndex={p.place === 'app' ? 0 : -1} ref={(el) => p.placeRef('app', el)} onClick={() => p.onPlace('app')}>In an app</button>
          </div>
          {p.place === 'app' && (
            <p className="tp-steps">Next, Chrome asks what to share. Choose <b>Entire screen</b> and turn on <b>Also share system audio</b>. Rekord only listens. It never records your screen.</p>
          )}
          <label className="tp-mic">
            <input type="checkbox" checked={p.mic} onChange={(e) => p.onMic(e.target.checked)} />Include my microphone
          </label>
        </div>
      </section>

      <div className="tp-go">
        {p.notices}
        <button type="button" className="tp-start" onClick={p.onRecord} disabled={!p.canRecord}>
          <span aria-hidden="true" />{p.busy ? 'Starting…' : 'Start recording'}
        </button>
        {p.place === 'tab' && <span className="tp-hint">Next, Chrome asks which tab to share.</span>}
      </div>
    </main>
  );
}
