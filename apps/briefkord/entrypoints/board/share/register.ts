/** Share by file and Import plug into the board tab here; main.tsx imports this module once. */
import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadBoard } from '@/lib/store/db';
import { extendBoard } from '../shell/extensions';
import { setPendingImport } from './pending';
import { ImportedBanner } from './ImportedBanner';
import { ShareDialog } from './ShareDialog';
import './share.css';

// AllBoards has no board shell, so its Share opens in a root of its own.
function showOverlay(render: (close: () => void) => ReactNode): void {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(render(close));
}

extendBoard({
  Banner: ({ shell }) => (shell.board.imported ? createElement(ImportedBanner, { shell }) : null),
  share: (shell) => shell.openOverlay(createElement(ShareDialog, { board: shell.board, onClose: shell.closeOverlay })),
  shareBoard: (boardId) => {
    loadBoard(boardId)
      .then((board) => board && showOverlay((close) => createElement(ShareDialog, { board, onClose: close })))
      .catch((error) => console.error('Briefkord: could not open the board to share', error));
  },
  importFile: (_shell, file) => {
    setPendingImport(file);
    location.hash = '#/import';
  },
});
