/** Board states from StatesBoard: board-empty, board-opening, board-damaged, delete-board, not-saved, and the toasts. */
import { useEffect } from 'react';

export function BoardEmpty({ onAddNote, onDescribe, onSidePanel }: { onAddNote(): void; onDescribe(): void; onSidePanel(): void }) {
  return (
    <div className="bk-empty" data-canvas-control="">
      <span className="bk-empty-title">Nothing on this board yet</span>
      <span className="bk-empty-sub">Save pages from the side panel, drop files here, or start with a note.</span>
      <div className="bk-empty-actions">
        <button type="button" className="bk-btn-s bk-btn-primary" onClick={onAddNote}>Add a note</button>
        <button type="button" className="bk-btn-s" onClick={onDescribe}>Describe a flow</button>
        <button type="button" className="bk-btn-s" onClick={onSidePanel}>Open the side panel</button>
      </div>
    </div>
  );
}

export function BoardOpening() {
  return (
    <main className="bk-opening" aria-busy="true">
      <span className="bk-ghost" style={{ left: '6%', top: '8%', width: '24%', height: '34%' }} />
      <span className="bk-ghost is-2" style={{ left: '33%', top: '8%', width: '18%', height: '25%' }} />
      <span className="bk-ghost" style={{ left: '54%', top: '8%', width: '15%', height: '40%' }} />
      <span className="bk-ghost is-3" style={{ left: '33%', top: '38%', width: '18%', height: '28%' }} />
      <span className="bk-ghost is-2" style={{ left: '6%', top: '47%', width: '24%', height: '19%' }} />
      <span className="bk-opening-label">Opening the board…</span>
    </main>
  );
}

export function BoardDamaged({ name, cards, onOpenCopy, onBack }: { name: string; cards?: number; onOpenCopy(): void; onBack(): void }) {
  return (
    <main className="bk-center-page">
      <div role="alert" className="bk-sheet">
        <span className="bk-sheet-title">“{name}” couldn’t be opened</span>
        <span className="bk-sheet-text">Part of its saved data is damaged. Briefkord kept every card it could read in a copy, and left the original untouched.</span>
        <div className="bk-sheet-actions">
          {cards !== undefined && <button type="button" className="bk-btn-m bk-btn-primary" onClick={onOpenCopy}>Open the copy ({cards} cards)</button>}
          <button type="button" className="bk-btn-m" onClick={onBack}>Back to boards</button>
        </div>
      </div>
    </main>
  );
}

export function DeleteBoardDialog({ name, cards, images, onKeep, onDelete }: { name: string; cards: number; images: number; onKeep(): void; onDelete(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onKeep();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKeep]);
  return (
    <div className="bk-scrim bk-scrim-light" onPointerDown={(e) => e.target === e.currentTarget && onKeep()}>
      <div role="alertdialog" aria-labelledby="del-t" className="bk-sheet bk-sheet-dialog">
        <span id="del-t" className="bk-sheet-title">Delete “{name}”?</span>
        <span className="bk-sheet-text">Its {cards} {cards === 1 ? 'card' : 'cards'} and {images} {images === 1 ? 'image' : 'images'} are removed from this computer. Files you exported before are not touched.</span>
        <div className="bk-sheet-actions">
          <button type="button" className="bk-btn-m" autoFocus onClick={onKeep}>Keep it</button>
          <button type="button" className="bk-btn-m bk-btn-danger" onClick={onDelete}>Delete board</button>
        </div>
        <span className="bk-sheet-note">After deleting, “Undo” shows for 10 seconds.</span>
      </div>
    </div>
  );
}

export function NotSaved({ changes, onTry, onExport }: { changes: number; onTry(): void; onExport(): void }) {
  return (
    <div role="alert" className="bk-not-saved-card">
      <span>Briefkord couldn’t save your last {changes} {changes === 1 ? 'change' : 'changes'}. They’re still on screen, and it tries again every few seconds.</span>
      <span className="bk-row">
        <button type="button" className="bk-btn-amber" onClick={onTry}>Try now</button>
        <button type="button" className="bk-btn-amber" onClick={onExport}>Export a copy</button>
      </span>
    </div>
  );
}

export type ToastState =
  | { kind: 'undo'; text: string; onUndo(): void }
  | { kind: 'skipped'; title: string; text: string };

export function Toast({ toast, onClose }: { toast: ToastState; onClose(): void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, toast.kind === 'undo' ? 10_000 : 8000);
    return () => clearTimeout(timer);
  }, [toast, onClose]);
  if (toast.kind === 'skipped') {
    return (
      <div role="status" className="bk-toast bk-toast-skipped">
        <span className="bk-toast-title">{toast.title}</span>
        <span className="bk-toast-text">{toast.text}</span>
      </div>
    );
  }
  return (
    <div role="status" className="bk-toast">
      <span>{toast.text}</span>
      <button type="button" onClick={() => (toast.onUndo(), onClose())}>Undo</button>
    </div>
  );
}
