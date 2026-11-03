/** BoardList's right pane: the selected card's place, a look at it, its summary and "What to say about it". */
import { useEffect, useState } from 'react';
import { cardNumbers, listOrder, sectionOf, updateCard } from '@/lib/board/ops';
import type { Card } from '@/lib/board/types';
import { Badge, DiagramView, useFileUrl } from '../cards';
import { KIND_LABEL, shortDate } from '../logic/cards';
import { formatBytes } from '../logic/drop';
import type { BoardShell } from '../shell/extensions';
import { rowDetail, summaryOf } from './logic';

function meta(card: Card, detail: string): string {
  if (card.kind === 'link') return [card.site, `saved ${shortDate(card.savedAt)}`].filter(Boolean).join(' · ');
  if (card.kind === 'file') return [KIND_LABEL.file, formatBytes(card.file.size), card.pages ? `${card.pages} pages` : ''].filter(Boolean).join(' · ');
  if (card.kind === 'note') return KIND_LABEL.note;
  return detail;
}

export function CardDetails({ shell, card }: { shell: BoardShell; card: Card }) {
  const { board } = shell;
  const [say, setSay] = useState(card.say);
  useEffect(() => setSay(card.say), [card.say]);
  const number = cardNumbers(board)[card.id];
  const section = sectionOf(board, card.id);
  const summary = card.kind === 'link' ? summaryOf(board, card.id)?.text : card.kind === 'note' && card.summary ? card.text : undefined;
  const save = () => say !== card.say && shell.api.change((b, now) => updateCard(b, card.id, now, (c) => ({ ...c, say })));

  return (
    <aside className="bk-ls-details" aria-label="Selected card">
      <div className="bk-ls-place">
        <Badge n={number} />
        <span>{section?.title} · {number} of {listOrder(board).length}</span>
        <button type="button" className="bk-ls-link" onClick={() => shell.showCard(card.id)}>Show on canvas</button>
      </div>
      <Media boardId={board.id} card={card} />
      <div className="bk-ls-what">
        <span className="bk-ls-meta">{meta(card, rowDetail(board, card))}</span>
        {card.title && <span className="bk-ls-big">{card.title}</span>}
      </div>
      {summary !== undefined ? (
        <div className="bk-ls-box">
          <span className="bk-ls-label">Summary</span>
          <span className="bk-ls-prose">{summary}</span>
        </div>
      ) : card.kind === 'note' && card.text ? (
        <div className="bk-ls-box"><span className="bk-ls-prose">{card.text}</span></div>
      ) : card.kind === 'checklist' && card.items.length > 0 ? (
        <div className="bk-ls-box">
          {card.items.map((item) => (
            <span key={item.id} className={item.done ? 'bk-ls-item is-done' : 'bk-ls-item'}>{item.text}</span>
          ))}
        </div>
      ) : null}
      <div className="bk-ls-say">
        <label htmlFor="bk-ls-say" className="bk-ls-label">What to say about it</label>
        <textarea id="bk-ls-say" rows={2} value={say} onChange={(e) => setSay(e.target.value)} onBlur={save} />
      </div>
    </aside>
  );
}

function Media({ boardId, card }: { boardId: string; card: Card }) {
  const fileId = card.kind === 'link' ? card.preview?.id : card.kind === 'image' ? card.file.id : undefined;
  const url = useFileUrl(boardId, fileId);
  if (card.kind === 'diagram') {
    return <div className="bk-ls-media is-diagram"><DiagramView diagram={card.diagram} /></div>;
  }
  if (card.kind !== 'link' && card.kind !== 'image') return null;
  return <div className={`bk-ls-media is-${card.kind}`}>{url && <img src={url} alt="" draggable={false} />}</div>;
}
