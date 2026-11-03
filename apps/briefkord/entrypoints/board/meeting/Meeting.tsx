/** Meeting mode (Meeting, MeetingFocus, MeetingEnd): one card at a time in list order, agenda, timer, notes and keys. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { briefPointsFor } from '@/lib/ai/apply';
import { updateCard } from '@/lib/board/ops';
import type { Board, Card } from '@/lib/board/types';
import { agenda, agendaCards, endLine, plannedMinutes, sectionTimes, stepOf } from '@/lib/meeting/agenda';
import { elapsed, startClock, switchSection, timerText } from '@/lib/meeting/clock';
import { meetingKey, stepTo } from '@/lib/meeting/keys';
import { CardBody } from '../cards';
import { ChevronLeft, ChevronRight } from '../icons';
import { boardExtensions, type BoardShell } from '../shell/extensions';
import './meeting.css';

const Tick = ({ size, width }: { size: number; width: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
);

const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

const exitFullScreen = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch((error: unknown) => console.error('Briefkord: could not leave full screen', error));
};

export function Meeting({ shell }: { shell: BoardShell }) {
  const [board, setBoard] = useState<Board>(shell.board);
  const sections = useMemo(() => agenda(shell.board), [shell.board.id]);
  const cards = useMemo(() => agendaCards(sections), [sections]);
  const count = cards.length;
  const planned = plannedMinutes(shell.board);
  const [at, setAt] = useState(0);
  const [clock, setClock] = useState(() => startClock(cards[0]?.section ?? null, Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const [notesHidden, setNotesHidden] = useState(false);
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const [room, setRoom] = useState({ w: 826, h: 592 });
  const ended = at >= count;

  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    root.current?.focus();
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      exitFullScreen();
    };
  }, []);

  useEffect(() => {
    if (ended) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ended]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ended]);

  const go = (to: number) => {
    const next = Math.min(Math.max(to, 0), count);
    const t = Date.now();
    setAt(next);
    setClock((c) => switchSection(c, cards[next]?.section ?? null, t));
    setNow(t);
  };
  const toggleFull = () => {
    if (document.fullscreenElement) exitFullScreen();
    else document.documentElement.requestFullscreen().catch((error: unknown) => console.error('Briefkord: could not go full screen', error));
  };
  const leave = () => {
    exitFullScreen();
    shell.closeOverlay();
  };
  const live = { ...shell, board };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = meetingKey({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, typing: isTyping(e.target) });
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === 'end') return leave();
      if (action === 'full-screen') return toggleFull();
      if (action === 'notes') return !ended && setNotesHidden((h) => !h);
      if (ended && action === 'next') return;
      go(stepTo(at, count, action));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const commit = (next: Card) => {
    const t = Date.now();
    setBoard((b) => updateCard(b, next.id, t, () => next));
    shell.api.change((b, n) => updateCard(b, next.id, n, () => next));
  };

  const totalMs = elapsed(clock, now);

  if (ended) {
    const times = sectionTimes(sections, clock, now);
    return (
      <div className="bk-mt bk-mt-done" role="dialog" aria-label="Meeting" tabIndex={-1} ref={root}>
        <section aria-label="End of meeting" className="bk-mt-end-box">
          <span className="bk-mt-end-icon"><Tick size={26} width={2.4} /></span>
          <h1>That was the last card</h1>
          <p>{endLine(count, totalMs, planned)}</p>
          <div className="bk-mt-tiles" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(3, times.length))}, minmax(0, 1fr))` }}>
            {times.map((t) => (
              <div key={t.id} className="bk-mt-tile">
                <span className={t.overMs > 0 ? 'bk-mt-tile-time is-over' : 'bk-mt-tile-time'}>{t.time}</span>
                <span className="bk-mt-tile-label">{t.label}</span>
              </div>
            ))}
          </div>
          <div className="bk-mt-end-actions">
            <button type="button" className="bk-mt-primary" onClick={leave}>Back to the board</button>
            <button
              type="button"
              className="bk-mt-outline"
              onClick={() => {
                leave();
                boardExtensions.share(live);
              }}
            >
              Share as a file
            </button>
            <button type="button" className="bk-mt-ghost" onClick={() => go(count - 1)}>Go back a card</button>
          </div>
        </section>
      </div>
    );
  }

  const current = cards[at]!;
  const card = board.cards[current.id];
  const section = sections.find((s) => s.id === current.section);
  const nextCard = cards[at + 1];
  const timer = timerText(totalMs, planned);
  const say = (card?.say ?? '').split('\n').filter((line) => line.trim());
  const focus = full || notesHidden;
  const boxW = Math.min(640 * (focus ? 1.18 : 1), room.w - 64);
  const boxH = Math.min(400 * (focus ? 1.18 : 1), room.h - 120);

  return (
    <div className="bk-mt" role="dialog" aria-label="Meeting" tabIndex={-1} ref={root}>
      <header className="bk-mt-head">
        <span className="bk-mt-board">{board.name}</span>
        <span className="bk-mt-section">{section?.title}</span>
        <span className="bk-mt-progress" role="progressbar" aria-label={`Card ${at + 1} of ${count}`} aria-valuemin={1} aria-valuemax={count} aria-valuenow={at + 1}>
          {cards.map((c, i) => <span key={c.id} className={`is-${stepOf(i, at)}`} />)}
        </span>
        <span role="timer" className={timer.over ? 'bk-mt-timer is-over' : 'bk-mt-timer'}>
          {timer.time}
          {timer.plan && <span> {timer.plan}</span>}
        </span>
        <button type="button" className="bk-mt-leave" onClick={leave}>End<span>Esc</span></button>
      </header>
      <div className="bk-mt-body">
        {!full && (
          <nav aria-label="Agenda" className="bk-mt-agenda">
            {sections.map((s, si) => (
              <div key={s.id} className="bk-mt-ag-group">
                <span className={si === 0 ? 'bk-mt-ag-head is-first' : 'bk-mt-ag-head'}>{s.number} · {s.title}</span>
                {s.cards.map((c) => {
                  const step = stepOf(c.index, at);
                  return (
                    <button key={c.id} type="button" className={`bk-mt-ag-item is-${step}`} aria-current={step === 'current' ? 'step' : undefined} onClick={() => go(c.index)}>
                      {step === 'done' ? <span className="bk-mt-ag-done" role="img" aria-label="Done"><Tick size={14} width={2.6} /></span> : <span className="bk-mt-ag-n">{c.number}</span>}
                      <span className="bk-mt-ag-title">{board.cards[c.id]?.title ?? c.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        )}
        <main aria-label={`Card ${at + 1} of ${count}`} className="bk-mt-stage" ref={stage}>
          {card && <Shown card={card} number={current.number} boardId={board.id} boxW={boxW} boxH={boxH} onCommit={commit} />}
          {focus && (
            <div className="bk-mt-corner">
              {notesHidden && <button type="button" onClick={() => setNotesHidden(false)}>Show notes<span>N</span></button>}
              {full && <button type="button" onClick={toggleFull}>Exit full screen<span>F</span></button>}
            </div>
          )}
          <div className="bk-mt-bar">
            <button type="button" className="bk-mt-prev" aria-label="Previous card" disabled={at === 0} onClick={() => go(at - 1)}><ChevronLeft /></button>
            <span className="bk-mt-count">{at + 1} of {count}</span>
            <button type="button" className="bk-mt-next" onClick={() => go(at + 1)}>
              <span>{nextCard ? `Next: ${board.cards[nextCard.id]?.title ?? nextCard.title}` : 'Next'}</span>
              <ChevronRight size={16} />
            </button>
            <span className="bk-mt-sep" aria-hidden="true" />
            {card?.kind === 'link' && <button type="button" className="bk-mt-plain" onClick={() => window.open(card.url, '_blank', 'noopener')}>Open the page</button>}
            <button
              type="button"
              className="bk-mt-plain"
              onClick={() => {
                leave();
                shell.showCard(current.id);
              }}
            >
              Show on canvas
            </button>
          </div>
        </main>
        {!notesHidden && (
          <aside aria-label="Your notes" className="bk-mt-notes">
            <div className="bk-mt-notes-head"><h2>Your notes</h2><span>Only you see these</span></div>
            {say.map((line, i) => <p key={i}>{line}</p>)}
            {briefPointsFor(board, current.id).length > 0 && (
              <div className="bk-mt-brief">
                <span>From Brief me</span>
                {briefPointsFor(board, current.id).map((point, i) => <p key={i}>{point}</p>)}
              </div>
            )}
            <div className="bk-mt-keys">
              <kbd>→</kbd>next
              <button type="button" onClick={() => setNotesHidden(true)}><kbd>N</kbd>hide notes</button>
              <button type="button" onClick={toggleFull}><kbd>F</kbd>full screen</button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/** The canvas card, drawn by the same renderer, scaled up to fit the stage. */
function Shown({ card, number, boardId, boxW, boxH, onCommit }: { card: Card; number: number; boardId: string; boxW: number; boxH: number; onCommit(next: Card): void }) {
  const { w, h } = card.rect;
  const s = Math.max(0.1, Math.min(boxW / w, boxH / h));
  return (
    <div className="bk-mt-card" style={{ width: w * s, height: h * s }}>
      <article
        className={`bk-card bk-kind-${card.kind} bk-c-${card.colour}`}
        aria-label={card.title}
        style={{ width: w, height: h, transform: `scale(${s})`, borderRadius: 20 / s, borderWidth: 1 / s }}
      >
        <CardBody card={card} number={number} boardId={boardId} editing={false} onCommit={onCommit} onDone={() => undefined} />
      </article>
    </div>
  );
}
