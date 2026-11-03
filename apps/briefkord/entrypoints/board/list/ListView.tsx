/** The List (BoardList, SectionEdit): sections with times, rows that drag by the handle or move with Alt ↑ ↓, and the selected card on the right. */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { addSection, cardNumbers, listOrder, moveCardInList, moveSection, newId, renameSection, setSectionMinutes } from '@/lib/board/ops';
import type { Board, Card, Section } from '@/lib/board/types';
import { Badge, useFileUrl } from '../cards';
import { Sparkle } from '../icons';
import { boardExtensions, type BoardShell } from '../shell/extensions';
import { CardDetails } from './CardDetails';
import { agendaCount, deleteSectionKeepCards, nearestSlot, numberAfterDrop, ordinal, rowDetail, slotIndex, stepInList, type Slot } from './logic';
import './list.css';

const Plus = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
const Grip = () => (
  <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
    {[3, 8, 13].flatMap((y) => [<circle key={`a${y}`} cx="3" cy={y} r="1.4" />, <circle key={`b${y}`} cx="9" cy={y} r="1.4" />])}
  </svg>
);
const Dots = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
);

interface Drag { id: string; slots: Slot[]; slot?: Slot; x: number; y: number; ghostLeft: number; ghostWidth: number; lineLeft: number; lineWidth: number }

export function ListView({ shell }: { shell: BoardShell }) {
  const { board } = shell;
  const change = shell.api.change;
  const order = listOrder(board);
  const numbers = cardNumbers(board);
  const [picked, setPicked] = useState<string | undefined>(() => shell.selection.find((id) => board.cards[id]));
  const selectedId = picked && board.cards[picked] ? picked : order[0];
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag>();
  const dragRef = useRef<Drag>(undefined);
  dragRef.current = drag;
  const content = useRef<HTMLDivElement>(null);
  const refocus = useRef<string>(undefined);

  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = undefined;
    content.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)?.focus();
  });

  const startDrag = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0 || !content.current) return;
    e.preventDefault();
    setPicked(id);
    const box = content.current.getBoundingClientRect();
    const slots: Slot[] = [];
    let lineLeft = 0, lineWidth = 0, ghostLeft = 0, ghostWidth = 0;
    content.current.querySelectorAll<HTMLElement>('[data-section-id]').forEach((el) => {
      const section = el.dataset.sectionId!;
      const rows = [...el.querySelectorAll<HTMLElement>('[data-card-id]')].map((r) => r.getBoundingClientRect());
      const head = el.querySelector('[data-section-head]')!.getBoundingClientRect();
      rows.forEach((r, i) => slots.push({ section, slot: i, y: (i === 0 ? r.top - 4 : (rows[i - 1]!.bottom + r.top) / 2) - box.top }));
      slots.push({ section, slot: rows.length, y: (rows.length ? rows[rows.length - 1]!.bottom + 4 : head.bottom + 6) - box.top });
      if (rows[0] && !lineWidth) {
        lineLeft = rows[0].left - box.left;
        lineWidth = rows[0].width;
        ghostLeft = rows[0].left + 34;
        ghostWidth = Math.min(560, rows[0].width - 60);
      }
    });
    setDrag({ id, slots, x: e.clientX, y: e.clientY, ghostLeft, ghostWidth, lineLeft, lineWidth });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const top = content.current?.getBoundingClientRect().top ?? 0;
      setDrag((d) => d && { ...d, x: e.clientX, y: e.clientY, slot: nearestSlot(d.slots, e.clientY - top) });
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(undefined);
      if (!d?.slot) return;
      const { id, slot } = d;
      refocus.current = id;
      change((b, now) => moveCardInList(b, id, slot.section, slotIndex(b, id, slot), now));
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setDrag(undefined);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
    document.body.classList.add('bk-ls-dragging');
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      document.body.classList.remove('bk-ls-dragging');
    };
  }, [!!drag, change]);

  const onRowKey = (e: KeyboardEvent, id: string) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const by = e.key === 'ArrowUp' ? -1 : 1;
    if (e.altKey) {
      refocus.current = id;
      change((b, now) => stepInList(b, id, by, now));
      return;
    }
    const next = order[order.indexOf(id) + by];
    if (next) {
      setPicked(next);
      refocus.current = next;
    }
  };

  const addSectionAt = (index?: number) => {
    const id = newId();
    change((b, now) => addSection(b, { id, title: '', minutes: 0 }, now, index));
    setEditing(id);
  };

  const dragCard = drag ? board.cards[drag.id] : undefined;
  const selected = selectedId ? board.cards[selectedId] : undefined;

  return (
    <div className="bk-ls">
      <main className="bk-ls-main" aria-label="Agenda">
        <div className="bk-ls-content" ref={content}>
          <div className="bk-ls-top">
            <h2>Agenda <span>· {agendaCount(board)}</span></h2>
            <button type="button" className="bk-ls-btn" onClick={() => boardExtensions.suggestOrder(shell)}><span className="bk-ls-accent"><Sparkle small /></span>Suggest an order</button>
            <button type="button" className="bk-ls-btn" onClick={() => addSectionAt()}><Plus />Section</button>
          </div>
          {board.sections.map((section, i) => (
            <section key={section.id} className="bk-ls-section" data-section-id={section.id}>
              {editing === section.id ? (
                <SectionEditor
                  key={section.id}
                  board={board}
                  section={section}
                  index={i}
                  change={change}
                  onAddBelow={() => addSectionAt(i + 1)}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <h3 className="bk-ls-head" data-section-head="">
                  <button type="button" className="bk-ls-name" title="Rename, set time or delete" onClick={() => setEditing(section.id)}>{i + 1} · {section.title}</button>
                  <span className="bk-ls-rule" />
                  <span className="bk-ls-min">{section.minutes} min</span>
                </h3>
              )}
              {section.cards.map((id) => {
                const card = board.cards[id];
                if (!card) return null;
                return (
                  <Row
                    key={id}
                    board={board}
                    card={card}
                    number={numbers[id]}
                    selected={id === selectedId}
                    source={drag?.id === id}
                    onSelect={() => setPicked(id)}
                    onKey={(e) => onRowKey(e, id)}
                    onGrab={(e) => startDrag(e, id)}
                  />
                );
              })}
            </section>
          ))}
          <button type="button" className="bk-ls-add" onClick={() => addSectionAt()}>+ Add a section</button>
          {drag?.slot && <span className="bk-ls-line" aria-hidden="true" style={{ top: drag.slot.y - 1.5, left: drag.lineLeft, width: drag.lineWidth }} />}
        </div>
      </main>
      {selected && <CardDetails key={selected.id} shell={shell} card={selected} />}
      {drag && dragCard && (
        <div className="bk-ls-ghost" aria-hidden="true" style={{ left: drag.ghostLeft, top: drag.y - 24, width: drag.ghostWidth }}>
          <span className="bk-ls-grip"><Grip /></span>
          <span className="bk-ls-ghost-n">{drag.slot ? numberAfterDrop(board, drag.id, drag.slot) : numbers[drag.id]}</span>
          <span className="bk-ls-ghost-title">{dragCard.title}</span>
          {drag.slot && <span className="bk-ls-ghost-hint">Drop to make it {ordinal(numberAfterDrop(board, drag.id, drag.slot))}</span>}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  board: Board;
  card: Card;
  number?: number;
  selected: boolean;
  source: boolean;
  onSelect(): void;
  onKey(e: KeyboardEvent): void;
  onGrab(e: ReactPointerEvent): void;
}

function Row({ board, card, number, selected, source, onSelect, onKey, onGrab }: RowProps) {
  const cls = `bk-ls-row${selected ? ' is-selected' : ''}${source ? ' is-source' : ''}`;
  return (
    <div className={cls} data-card-id={card.id} tabIndex={0} aria-current={selected ? 'true' : undefined} onClick={onSelect} onFocus={onSelect} onKeyDown={onKey}>
      <span className="bk-ls-grip" onPointerDown={onGrab}><Grip /></span>
      <Badge n={number} />
      <Thumb boardId={board.id} card={card} />
      <span className="bk-ls-text">
        <span className="bk-ls-title">{card.title}</span>
        <span className="bk-ls-detail">{rowDetail(board, card)}</span>
      </span>
    </div>
  );
}

function Thumb({ boardId, card }: { boardId: string; card: Card }) {
  const fileId = card.kind === 'link' ? card.preview?.id : card.kind === 'image' ? card.file.id : undefined;
  const url = useFileUrl(boardId, fileId);
  const colour = card.kind === 'note' || card.kind === 'checklist' ? ` bk-c-${card.colour}` : '';
  return <span className={`bk-ls-thumb bk-ls-thumb-${card.kind}${colour}`} aria-hidden="true">{url && <img src={url} alt="" draggable={false} />}</span>;
}

interface EditorProps {
  board: Board;
  section: Section;
  index: number;
  change(edit: (board: Board, now: number) => Board): void;
  onAddBelow(): void;
  onDone(): void;
}

/** SectionEdit: rename, minutes and the section menu. Saves as one step when focus leaves it. */
function SectionEditor({ board, section, index, change, onAddBelow, onDone }: EditorProps) {
  const [title, setTitle] = useState(section.title);
  const [minutes, setMinutes] = useState(String(section.minutes));
  const [menu, setMenu] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const draft = useRef({ title, minutes, done: false });
  draft.current = { ...draft.current, title, minutes };
  const last = index === board.sections.length - 1;
  const only = board.sections.length < 2;

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const withDrafts = (b: Board, now: number): Board => {
    const m = Number(draft.current.minutes);
    const named = renameSection(b, section.id, draft.current.title.trim(), now);
    return Number.isFinite(m) && draft.current.minutes.trim() !== '' ? setSectionMinutes(named, section.id, m, now) : named;
  };
  const finish = (edit?: (b: Board, now: number) => Board) => {
    if (draft.current.done) return;
    draft.current.done = true;
    change((b, now) => (edit ? edit(withDrafts(b, now), now) : withDrafts(b, now)));
    onDone();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      finish();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      if (menu) return setMenu(false);
      draft.current.done = true;
      onDone();
    }
  };

  return (
    <div
      className="bk-ls-edit-wrap"
      data-section-head=""
      onKeyDown={onKey}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish();
      }}
    >
      <div className="bk-ls-edit">
        <span className="bk-ls-edit-n">{index + 1} ·</span>
        <input ref={nameRef} type="text" aria-label="Section name" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="bk-ls-time">
          Time
          <input type="number" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          min
        </label>
        <button type="button" className="bk-ls-menu-btn" aria-label="Section menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Dots /></button>
      </div>
      {menu && (
        <div role="menu" aria-label="Section" className="bk-ls-menu">
          <button type="button" role="menuitem" disabled={last} onClick={() => finish((b, now) => moveSection(b, section.id, index + 1, now))}>Move section down</button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              finish();
              onAddBelow();
            }}
          >
            Add a section below
          </button>
          <span className="bk-ls-menu-rule" aria-hidden="true" />
          <button type="button" role="menuitem" className="bk-ls-danger" disabled={only} onClick={() => finish((b, now) => deleteSectionKeepCards(b, section.id, now))}>
            Delete section
            {section.cards.length > 0 && <span>{section.cards.length === 1 ? 'Its 1 card moves' : `Its ${section.cards.length} cards move`} to the {last ? 'section above' : 'next section'}. Nothing is deleted from the board.</span>}
          </button>
        </div>
      )}
    </div>
  );
}
