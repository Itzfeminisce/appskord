/** Card details beside the canvas (CardSelected): title, place in the list, what to say, and where a link was saved from. */
import { useEffect, useState } from 'react';
import { moveCardInList, updateCard } from '@/lib/board/ops';
import type { Board, Card, LinkCard } from '@/lib/board/types';
import { ChevronDown, Close, Refresh } from '../icons';
import { dateTime, KIND_LABEL, shortDate } from '../logic/cards';

export type RefreshState =
  | { cardId: string; phase: 'refreshing' }
  | { cardId: string; phase: 'updated'; title: string; text: string; words: number }
  | { cardId: string; phase: 'unread' };

export interface DetailsProps {
  board: Board;
  card: Card;
  refresh?: RefreshState;
  change(edit: (board: Board, now: number) => Board): void;
  onRefresh(id: string): void;
  onKeepNew(): void;
  onKeepOld(): void;
  onClose(): void;
}

export function DetailsPanel({ board, card, refresh, change, onRefresh, onKeepNew, onKeepOld, onClose }: DetailsProps) {
  const [title, setTitle] = useState(card.title);
  const [say, setSay] = useState(card.say);
  useEffect(() => setTitle(card.title), [card.id, card.title]);
  useEffect(() => setSay(card.say), [card.id, card.say]);
  const sectionIndex = board.sections.findIndex((s) => s.cards.includes(card.id));
  const section = board.sections[sectionIndex];
  const place = section ? `${sectionIndex + 1} · ${section.title}, card ${section.cards.indexOf(card.id) + 1}` : '';
  const save = (patch: Partial<Pick<Card, 'title' | 'say'>>) => change((b, now) => updateCard(b, card.id, now, (c) => ({ ...c, ...patch }) as Card));

  return (
    <aside aria-label="Card details" className="bk-details">
      <div className="bk-details-head">
        <h2>{KIND_LABEL[card.kind]} card</h2>
        <button type="button" className="bk-icon-btn bk-icon-sm" aria-label="Close details" onClick={onClose}><Close /></button>
      </div>
      <div className="bk-field">
        <label htmlFor="card-title">Title</label>
        <input id="card-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== card.title && save({ title })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      </div>
      <div className="bk-field">
        <label htmlFor="card-section">Place in the list</label>
        <span className="bk-select">
          <span>{place}</span>
          <ChevronDown />
          <select id="card-section" value={section?.id ?? ''} onChange={(e) => change((b, now) => moveCardInList(b, card.id, e.target.value, Number.MAX_SAFE_INTEGER, now))}>
            {board.sections.map((s, i) => (
              <option key={s.id} value={s.id}>{i + 1} · {s.title}</option>
            ))}
          </select>
        </span>
      </div>
      <div className="bk-field">
        <label htmlFor="card-say">What to say about it</label>
        <textarea id="card-say" rows={3} value={say} onChange={(e) => setSay(e.target.value)} onBlur={() => say !== card.say && save({ say })} />
      </div>
      {card.kind === 'link' && (refresh?.cardId === card.id ? <RefreshCard card={card} state={refresh} onKeepNew={onKeepNew} onKeepOld={onKeepOld} /> : <SavedFrom card={card} onRefresh={() => onRefresh(card.id)} />)}
    </aside>
  );
}

function SavedFrom({ card, onRefresh }: { card: LinkCard; onRefresh(): void }) {
  return (
    <div className="bk-saved-from">
      <span>Saved {dateTime(card.savedAt)} from {card.site}. Title, preview and page text are kept as they were then.</span>
      <button type="button" className="bk-btn-sm" onClick={onRefresh}><Refresh />Refresh from the page</button>
    </div>
  );
}

/** StatesMore refresh-page: refreshing, changed (keep new or old), unread: the page is not open or could not be read (the saved copy stays). */
export function RefreshCard({ card, state, onKeepNew, onKeepOld }: { card: LinkCard; state: RefreshState; onKeepNew(): void; onKeepOld(): void }) {
  if (state.phase === 'refreshing') {
    return (
      <div className="bk-refresh">
        <span className="bk-refresh-spin"><Refresh size={15} /></span>
        <span className="bk-refresh-title">{card.title}</span>
        <span role="status" className="bk-refresh-status">Refreshing from the page…</span>
      </div>
    );
  }
  if (state.phase === 'updated') {
    return (
      <div className="bk-refresh is-updated">
        <span className="bk-row"><span className="bk-refresh-title">{card.title}</span><span className="bk-updated">Updated</span></span>
        <span className="bk-refresh-text">The page changed since {shortDate(card.savedAt)}. Your notes on the card are kept.</span>
        <span className="bk-refresh-links">
          <button type="button" className="bk-link" onClick={onKeepNew}>Keep the new text</button>
          <button type="button" className="bk-link" onClick={onKeepOld}>Keep the old text</button>
        </span>
      </div>
    );
  }
  return (
    <div className="bk-refresh is-gone" role="status">
      <span className="bk-refresh-title">The page could not be read</span>
      <span className="bk-refresh-text">Open {card.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} in a tab, then refresh again. Your saved copy is still on the card.</span>
    </div>
  );
}
