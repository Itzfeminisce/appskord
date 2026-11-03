/** Right-click a card, or "More actions" on its bar. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Board, Card, CardColour } from '@/lib/board/types';
import { Swatches } from './Bars';

export interface CardMenuActions {
  openLarge(id: string): void;
  edit(id: string): void;
  duplicate(ids: string[]): void;
  recolour(ids: string[], colour: CardColour): void;
  moveToSection(ids: string[], sectionId: string): void;
  bringToFront(ids: string[]): void;
  saveImage(id: string): void;
  summarize(id: string): void;
  refresh(id: string): void;
  deleteCards(ids: string[]): void;
}

export function CardMenu({ card, board, x, y, actions, onClose }: { card: Card; board: Board; x: number; y: number; actions: CardMenuActions; onClose(): void }) {
  const [sub, setSub] = useState<'colour' | 'section' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setAt({ x: Math.min(x, innerWidth - width - 8), y: Math.min(y, innerHeight - height - 8) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const id = card.id;
  return (
    <div ref={ref} role="menu" aria-label="Card" className="bk-menu" style={{ left: at.x, top: at.y }}>
      <button type="button" role="menuitem" onClick={run(() => actions.openLarge(id))}>Open large<kbd>Space</kbd></button>
      {(card.kind === 'note' || card.kind === 'checklist') && <button type="button" role="menuitem" onClick={run(() => actions.edit(id))}>Edit</button>}
      <button type="button" role="menuitem" onClick={run(() => actions.duplicate([id]))}>Duplicate<kbd>Ctrl D</kbd></button>
      <button type="button" role="menuitem" aria-expanded={sub === 'colour'} onClick={() => setSub(sub === 'colour' ? null : 'colour')}>Colour ›</button>
      {sub === 'colour' && <div className="bk-menu-sub"><Swatches value={card.colour} onPick={(c) => run(() => actions.recolour([id], c))()} /></div>}
      <button type="button" role="menuitem" aria-expanded={sub === 'section'} onClick={() => setSub(sub === 'section' ? null : 'section')}>Move to section ›</button>
      {sub === 'section' && (
        <div className="bk-menu-sub bk-menu-sections">
          {board.sections.map((s, i) => (
            <button key={s.id} type="button" role="menuitem" onClick={run(() => actions.moveToSection([id], s.id))}>{i + 1} · {s.title}</button>
          ))}
        </div>
      )}
      <button type="button" role="menuitem" onClick={run(() => actions.bringToFront([id]))}>Bring to front</button>
      {card.kind === 'link' && <button type="button" role="menuitem" onClick={run(() => actions.summarize(id))}>Summarize</button>}
      {card.kind === 'link' && <button type="button" role="menuitem" onClick={run(() => actions.refresh(id))}>Refresh from the page</button>}
      {card.kind === 'image' && <button type="button" role="menuitem" onClick={run(() => actions.saveImage(id))}>Save image to this computer</button>}
      <span className="bk-menu-sep" aria-hidden="true" />
      <button type="button" role="menuitem" className="is-danger" onClick={run(() => actions.deleteCards([id]))}>Delete<kbd>Del</kbd></button>
    </div>
  );
}
