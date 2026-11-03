/** ImageOpen (Open large): one card big on a dark ground; ← → for the next card in the list, scroll to zoom, Esc closes. */
import { useEffect, useState, type WheelEvent } from 'react';
import { cardNumbers, listOrder } from '@/lib/board/ops';
import type { Board, Card } from '@/lib/board/types';
import { CardBody, useFileUrl } from '../cards';
import { ChevronLeft, ChevronRight, Close } from '../icons';
import { KIND_LABEL, shortDate, siteOf } from '../logic/cards';

const pageOf = (card: Card): string | undefined => (card.kind === 'link' ? card.url : card.kind === 'image' ? card.pageUrl : undefined);

export function ImageOpen({ board, cardId, onClose, onShow }: { board: Board; cardId: string; onClose(): void; onShow(id: string): void }) {
  const card = board.cards[cardId];
  const order = listOrder(board);
  const at = order.indexOf(cardId);
  const number = cardNumbers(board)[cardId];
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState<{ w: number; h: number }>();
  useEffect(() => {
    setScale(1);
    setSize(undefined);
  }, [cardId]);

  const step = (by: number) => {
    const next = order[(at + by + order.length) % order.length];
    if (next) onShow(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const imageId = card?.kind === 'image' ? card.file.id : card?.kind === 'link' ? card.preview?.id : undefined;
  const src = useFileUrl(board.id, imageId);
  if (!card) return null;
  const page = pageOf(card);
  const saved = card.kind === 'link' ? card.savedAt : card.createdAt;
  const sub = [
    KIND_LABEL[card.kind] + (page ? ` · saved from ${siteOf(page)} on ${shortDate(saved)}` : ''),
    card.kind === 'image' && size ? `${size.w} × ${size.h}` : '',
  ].filter(Boolean).join(' · ');
  const zoom = (e: WheelEvent) => setScale((s) => Math.min(6, Math.max(0.25, s * Math.exp(-e.deltaY * 0.0015))));

  return (
    <div role="dialog" aria-label={card.title} className="bk-open">
      <header className="bk-open-head">
        {number && <span className="bk-badge bk-badge-light">{number}</span>}
        <span className="bk-open-titles"><span className="bk-open-title">{card.title}</span><span className="bk-open-sub">{sub}</span></span>
        {page && <a className="bk-btn-dark" href={page} target="_blank" rel="noreferrer">Open the page it came from</a>}
        <button type="button" className="bk-open-close" aria-label="Close (Esc)" onClick={onClose}><Close size={20} /></button>
      </header>
      <main className="bk-open-stage" onWheel={zoom}>
        {order.length > 1 && <button type="button" className="bk-open-nav is-prev" aria-label="Previous card" onClick={() => step(-1)}><ChevronLeft /></button>}
        <div className="bk-open-zoom" style={{ transform: `scale(${src ? scale : scale * Math.min(760 / card.rect.w, 476 / card.rect.h, 2.5)})` }}>
          {src ? (
            <img className="bk-open-img" src={src} alt={card.title} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} draggable={false} />
          ) : (
            <article className={`bk-card bk-open-card bk-kind-${card.kind} bk-c-${card.colour}`} style={{ width: card.rect.w, height: card.rect.h }}>
              <CardBody card={card} number={number} boardId={board.id} editing={false} onCommit={() => undefined} onDone={() => undefined} />
            </article>
          )}
        </div>
        {order.length > 1 && <button type="button" className="bk-open-nav is-next" aria-label="Next card" onClick={() => step(1)}><ChevronRight size={18} /></button>}
      </main>
      <footer className="bk-open-foot"><span>Scroll or pinch to zoom · ← → for the next card · Esc to close</span></footer>
    </div>
  );
}
