/** Search (Ctrl K): this board first, then other boards, matched words highlighted. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cardLabel } from '@/lib/board/label';
import { sectionOf } from '@/lib/board/ops';
import type { Board, Card } from '@/lib/board/types';
import { searchBoards, snippet, type FieldMatch, type Range, type SearchField, type SearchMatch } from '@/lib/search';
import { listBoards, loadAllBoards } from '@/lib/store/db';
import { SearchIcon } from '../icons';
import { KIND_LABEL } from '../logic/cards';

const FIELD: Record<SearchField, string> = { title: 'title', note: 'note', say: 'what to say', page: 'page text' };

export function Search({ board, onClose, onOpen }: { board: Board; onClose(): void; onOpen(boardId: string, cardId: string): void }) {
  const [query, setQuery] = useState('');
  const [others, setOthers] = useState<Board[] | null>(null);
  const [allBoards, setAllBoards] = useState(false);
  const [count, setCount] = useState<number>();
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    listBoards()
      .then((rows) => alive && setCount(rows.length))
      .catch(() => undefined);
    loadAllBoards()
      .then((boards) => alive && setOthers(boards.filter((b) => b.id !== board.id)))
      .catch((error: unknown) => {
        console.error('Briefkord: could not search other boards', error);
        if (alive) setOthers([]);
      });
    return () => {
      alive = false;
    };
  }, [board.id]);

  const here = useMemo(() => searchBoards([board], query), [board, query]);
  const there = useMemo(() => (others ? searchBoards(others, query) : []), [others, query]);
  const boardsById = useMemo(() => new Map([board, ...(others ?? [])].map((b) => [b.id, b])), [board, others]);
  const showOthers = here.length > 0 || allBoards;
  const rows = [...here, ...(showOthers ? there : [])];
  const typed = query.trim() !== '';
  const loading = typed && others === null;

  useEffect(() => setActive(0), [query]);
  useEffect(() => listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }), [active]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && rows[active]) {
      onOpen(rows[active]!.boardId, rows[active]!.cardId);
    }
  };

  const row = (m: SearchMatch, i: number) => {
    const b = boardsById.get(m.boardId);
    const card = b?.cards[m.cardId];
    if (!b || !card) return null;
    return <ResultRow key={`${m.boardId}/${m.cardId}`} match={m} card={card} board={b} other={m.boardId !== board.id} active={i === active} onHover={() => setActive(i)} onOpen={() => onOpen(m.boardId, m.cardId)} />;
  };

  const empty = typed && !loading && here.length === 0 && (!allBoards || there.length === 0);

  return (
    <div className="bk-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-label="Search all boards" className="bk-search" onKeyDown={onKey}>
        <div className="bk-search-head">
          <span className="bk-muted"><SearchIcon size={20} /></span>
          <label htmlFor="bk-q" className="bk-sr">Search all boards</label>
          <input id="bk-q" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          {loading ? <span role="status" className="bk-search-status">Looking through {count ?? '…'} boards…</span> : empty ? <span className="bk-mono-small">0 results</span> : <kbd className="bk-kbd-esc">Esc</kbd>}
        </div>
        {typed && (
          <div className="bk-search-body" ref={listRef}>
            {loading && <SkeletonRows />}
            {!loading && empty && (
              <div className="bk-search-empty">
                <span className="bk-search-empty-title">Nothing on this board matches “{query.trim()}”</span>
                <span className="bk-muted-sm">Search looks at titles, notes and saved page text.</span>
                {!allBoards && <button type="button" className="bk-link" onClick={() => setAllBoards(true)}>Search all boards instead</button>}
              </div>
            )}
            {!loading && !empty && (
              <div className="bk-results" role="listbox" aria-label="Results">
                {here.length > 0 && <div className="bk-results-head">This board · {here.length}</div>}
                {here.map((m, i) => row(m, i))}
                {showOthers && there.length > 0 && <div className="bk-results-head bk-results-head-2">Other boards · {there.length}</div>}
                {showOthers && there.map((m, i) => row(m, here.length + i))}
              </div>
            )}
          </div>
        )}
        <div className="bk-search-foot">
          <span>Searches titles, notes and saved page text on every board.</span>
          <span className="bk-grow" />
          <span><span className="bk-mono">↑ ↓</span> move</span>
          <span><span className="bk-mono">Enter</span> open</span>
          <span><span className="bk-mono">Ctrl K</span> search</span>
        </div>
      </section>
    </div>
  );
}

function ResultRow({ match, card, board, other, active, onHover, onOpen }: { match: SearchMatch; card: Card; board: Board; other: boolean; active: boolean; onHover(): void; onOpen(): void }) {
  const title = match.fields.find((f) => f.field === 'title');
  const body = match.fields.find((f) => f.field !== 'title');
  const kind = KIND_LABEL[card.kind];
  const where = other ? `${kind} · in ${board.name}` : [kind, sectionOf(board, card.id)?.title].filter(Boolean).join(' · ');
  return (
    <button type="button" role="option" aria-selected={active} className="bk-result" onPointerMove={onHover} onClick={onOpen}>
      <span aria-hidden="true" className={`bk-result-thumb bk-thumb-${card.kind} bk-c-${card.colour}`} />
      <span className="bk-result-text">
        <span className="bk-result-title">{title ? <Marked text={card.title} ranges={title.ranges} /> : cardLabel(card)}</span>
        <span className="bk-result-sub">{body ? <Snippet field={body} /> : where}</span>
      </span>
      <span className="bk-result-kind">{body ? `${kind} · ${FIELD[body.field]}` : other ? `${kind} · title` : kind}</span>
    </button>
  );
}

function Snippet({ field }: { field: FieldMatch }) {
  const s = snippet(field);
  return <>{s.cutStart && '…'}<Marked text={s.text} ranges={s.ranges} />{s.cutEnd && '…'}</>;
}

function Marked({ text, ranges }: { text: string; ranges: Range[] }) {
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach((r, i) => {
    if (r.start > at) out.push(text.slice(at, r.start));
    out.push(<mark key={i}>{text.slice(r.start, r.end)}</mark>);
    at = r.end;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

function SkeletonRows() {
  return (
    <div className="bk-skeleton-rows" aria-hidden="true">
      {[70, 60, 75].map((w, i) => (
        <span key={i} className="bk-skeleton-row" style={{ animationDelay: `${i * 0.2}s` }}>
          <span className="bk-sk-thumb" />
          <span className="bk-sk-lines"><span style={{ width: `${w}%` }} /><span style={{ width: `${w - 25}%` }} /></span>
        </span>
      ))}
    </div>
  );
}
