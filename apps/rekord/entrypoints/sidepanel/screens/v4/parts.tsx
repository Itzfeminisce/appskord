import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { isCatchup } from '@/lib/catchup/label';
import { listMeetings, listSegments, listTellingAudio, tellingAudioAt, type TellingAudio } from '@/lib/db';
import { quoteFound } from '@/lib/memory/check';
import { nextWake } from '@/lib/memory/rank';
import { itemsByStatus, listPeople } from '@/lib/memory/store';
import type { MemoryItem, Person, Quote } from '@/lib/memory/types';
import { useRouter } from '../../router';
import { world } from '../../components/v4/world';
import { QuoteMissingCard } from '../../components/v4/states';
import { answerCaption, initials, meetingLine, quoteCaption, quoteClock, tint, type Chip, type Meetings } from './loops';
import './loops.css';
import { refreshBadge } from '@/lib/messages';

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
export const PromiseIcon = ({ size = 13 }: { size?: number }) => <svg {...base} width={size} height={size} strokeWidth="2.2"><path d="M4 12h13M13 7l5 5-5 5" /></svg>;
export const DecisionIcon = ({ size = 20, stroke = 2 }: { size?: number; stroke?: number }) => (
  <svg {...base} width={size} height={size} strokeWidth={stroke}><path d="M12 3l9 9-9 9-9-9z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>
);
export const CloseIcon = () => <svg {...base} width="18" height="18" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const ChevronIcon = () => <svg {...base} width="14" height="14" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>;
export const MailIcon = () => <svg {...base} width="18" height="18" strokeWidth="2"><path d="M4 6h16v12H4z" /><path d="M4 7l8 6 8-6" /></svg>;
export const AgainIcon = () => <svg {...base} width="15" height="15" strokeWidth="2"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>;
export const BigCheck = ({ size = 18 }: { size?: number }) => <svg {...base} width={size} height={size} strokeWidth="2.4"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const PlayIcon = () => <svg {...base} width="14" height="14" strokeWidth="2"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>;

/** 28 px initials on the person's tint; "A" on black for the user. */
export function Avatar({ name, me = false, size = 28 }: { name: string; me?: boolean; size?: number }) {
  const style = me ? { background: '#111114', color: '#FFFFFF' } : tint(name);
  return <span aria-hidden="true" className="lp-avatar" style={{ ...style, width: size, height: size }}>{me ? name.slice(0, 1).toUpperCase() : initials(name)}</span>;
}

export function DueChip({ chip }: { chip: Chip }) {
  return <span className={`lp-chip lp-chip-${chip.tone}`}>{chip.label}</span>;
}

export function KindTag({ kind }: { kind: MemoryItem['kind'] }) {
  if (kind === 'promise') return <span className="lp-tag lp-tag-promise"><PromiseIcon />Promise</span>;
  if (kind === 'question') return <span className="lp-tag lp-tag-question">?&nbsp;Question</span>;
  return <span className="lp-tag lp-tag-decision"><DecisionIcon size={13} stroke={2.2} />Decision</span>;
}

let player: { audio: HTMLAudioElement; url: string } | undefined;
const stopPlayer = () => { if (player) { player.audio.pause(); URL.revokeObjectURL(player.url); player = undefined; } };

/** Plays your telling from `atMs` into it (0 = the start) and on through the later parts; false when no audio is kept for that moment. */
export async function playTelling(meetingId: string, atMs = 0): Promise<boolean> {
  stopPlayer();
  const at = atMs > 0 ? await tellingAudioAt(meetingId, atMs) : undefined;
  const all = await listTellingAudio(meetingId);
  const first = at ?? (atMs > 0 ? undefined : all[0] && { ...all[0], seekMs: 0 });
  if (!first) return false;
  const queue: (TellingAudio & { seekMs?: number })[] = [first, ...all.filter((a) => a.part > first.part)];
  const next = () => {
    const a = queue.shift();
    if (!a) { stopPlayer(); return; }
    const url = URL.createObjectURL(a.blob);
    const audio = new Audio(url);
    if (a.seekMs) audio.currentTime = a.seekMs / 1000;
    audio.onended = () => { URL.revokeObjectURL(url); next(); };
    player = { audio, url };
    void audio.play().catch((error) => { console.error('Rekord: could not play your telling', error); stopPlayer(); });
  };
  next();
  return true;
}
/** Stops your telling when its screen closes. */
export const stopTelling = stopPlayer;

/** The quote with its caption and a play button that opens the transcript at that moment (a catch-up plays your telling). */
export function QuoteBlock({ quote, meetings, accent = '#3730A3', variant, caption, playLabel }: {
  quote: Quote; meetings: Meetings; accent?: string; variant?: 'compact' | 'log' | 'question'; caption?: string; playLabel?: string;
}) {
  const { navigate } = useRouter();
  const [missing, setMissing] = useState(false);
  const told = isCatchup(meetings.get(quote.meetingId));
  // The transcript may have been edited since the checker found the quote: say so instead of opening the wrong moment.
  const play = async () => {
    if (told && (await playTelling(quote.meetingId, quote.atMs).catch(() => false))) return;
    const found = quoteFound(quote, await listSegments(quote.meetingId).catch(() => []));
    if (found) navigate('transcript', { meetingId: quote.meetingId, atMs: quote.atMs });
    else setMissing(true);
  };
  if (missing) {
    return (
      <QuoteMissingCard quote={`${quote.speaker}: “${quote.text}”`} caption={caption ?? (told ? meetingLine(quote.meetingId, meetings) : [meetingLine(quote.meetingId, meetings), quoteClock(quote.atMs)].join(' · '))}
        onOpen={() => navigate('summary', { meetingId: quote.meetingId })} />
    );
  }
  return (
    <figure className={variant ? `lp-quote lp-quote-${variant}` : 'lp-quote'} style={{ borderLeftColor: accent }}>
      <div className="lp-quote-text">
        <blockquote>{`“${quote.text}”`}</blockquote>
        <figcaption>{caption ?? quoteCaption(quote, meetings)}</figcaption>
      </div>
      <button type="button" className="lp-play" aria-label={playLabel ?? (told ? 'Play this moment in your telling' : 'Play this moment in the transcript')}
        onClick={() => void play()}>
        <span><PlayIcon /></span>
      </button>
    </figure>
  );
}

/** The follow-up answer a promise's due date came from, captioned with the question it answered. */
export function AnswerBlock({ quote, question, meetings }: { quote: Quote; question: string; meetings: Meetings }) {
  return <QuoteBlock quote={quote} meetings={meetings} caption={answerCaption(quote, question, meetings)} playLabel="Play your answer" />;
}

/** A bottom sheet over the screen behind it. */
export function Sheet({ label, onClose, children, roomy = false, className }: { label: string; onClose: () => void; children: ReactNode; roomy?: boolean; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div aria-hidden="true" className="lp-scrim" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-label={label} className={['lp-sheet', roomy && 'lp-sheet-roomy', className].filter(Boolean).join(' ')}>
        <div aria-hidden="true" className="lp-grab" />
        {children}
      </section>
    </>
  );
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return <button type="button" className="lp-close" aria-label="Close" onClick={onClose}><CloseIcon /></button>;
}

export function ToastBar({ text, onUndo }: { text: string; onUndo?: () => void }) {
  return (
    <div role="status" className="lp-toast">
      <span>{text}</span>
      {onUndo && <button type="button" onClick={onUndo}>Undo</button>}
    </div>
  );
}

/** Closes a sheet: back to the screen it came from, else Open loops. */
export function useCloseSheet(): () => void {
  const { back, canGoBack, replace } = useRouter();
  return useCallback(() => (canGoBack ? back() : replace('home')), [back, canGoBack, replace]);
}

export interface MemoryView { items: MemoryItem[]; people: Map<string, Person>; meetings: Meetings; ready: boolean }

/** Open and looks-done items (snoozed ones included, rank filters them), people and meeting titles. Reloads when a snooze wakes. */
export function useMemoryView(): [MemoryView, () => void] {
  const [view, setView] = useState<MemoryView>({ items: [], people: new Map(), meetings: new Map(), ready: false });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [open, looks, people, meetings] = await Promise.all([itemsByStatus('open'), itemsByStatus('looksDone'), listPeople(), listMeetings()]);
      if (!alive) return;
      setView({
        items: [...open, ...looks],
        people: new Map(people.map((p) => [p.id, p])),
        meetings: new Map(meetings.map((m) => [m.id, m])),
        ready: true,
      });
    })().catch((error) => console.error('Rekord: could not load open loops', error));
    return () => { alive = false; };
  }, [tick]);
  useEffect(() => {
    const wake = nextWake(view.items, world.now());
    if (wake === undefined) return;
    const timer = setTimeout(() => { reload(); refreshBadge(); }, Math.min(wake - world.now() + 500, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [view.items, reload]);
  return [view, reload];
}

export { refreshBadge };
