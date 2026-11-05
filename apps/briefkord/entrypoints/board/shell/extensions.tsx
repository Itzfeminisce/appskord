// Later tasks (List T5, Brief me T7, Share T6, meeting T5, diagram editing T4) plug in with `extendBoard({...})` from a module main.tsx imports.
import type { ComponentType, ReactNode } from 'react';
import type { Board } from '@/lib/board/types';
import type { BoardApi } from '../useBoard';
import { openPanelSettings } from './panel';

/** What a plug-in gets: the board, its history and saving, and a place to show a screen over the board. */
export interface BoardShell {
  board: Board;
  api: BoardApi;
  /** Selected card ids on the canvas. */
  selection: readonly string[];
  /** Shows `node` over the board (BriefMe, Share, Meeting…); one at a time. */
  openOverlay(node: ReactNode): void;
  closeOverlay(): void;
  /** Switches to the canvas, selects the card and centres it ("Show on canvas"). */
  showCard(cardId: string): void;
  setView(view: 'canvas' | 'list'): void;
}

export interface BoardExtensions {
  /** The List view behind the Canvas / List switch. */
  ListView: ComponentType<{ shell: BoardShell }>;
  /** A banner under the top bar (the ImportedBoard banner); null shows nothing. */
  Banner: ComponentType<{ shell: BoardShell }>;
  /** The List's "Suggest an order" (T7). */
  suggestOrder(shell: BoardShell): void;
  briefMe(shell: BoardShell): void;
  share(shell: BoardShell): void;
  startMeeting(shell: BoardShell): void;
  /** board-empty "Describe a flow". */
  describeFlow(shell: BoardShell): void;
  /** Double-click a diagram card, or the Diagram tool. */
  editDiagram(shell: BoardShell, cardId: string): void;
  summarize(shell: BoardShell, cardId: string): void;
  /** A dropped .briefkord file. */
  importFile(shell: BoardShell, file: File): void;
  /** AllBoards: "Share as a file" on a board's menu, and the settings button. */
  shareBoard(boardId: string): void;
  openSettings(): void;
}

function ListPlaceholder() {
  return <main className="bk-list-placeholder" aria-label="List" />;
}

const noop = () => undefined;

export const boardExtensions: BoardExtensions = {
  ListView: ListPlaceholder,
  Banner: () => null,
  suggestOrder: noop,
  briefMe: noop,
  share: noop,
  startMeeting: noop,
  describeFlow: noop,
  editDiagram: noop,
  summarize: noop,
  importFile: () => {
    location.hash = '#/import';
  },
  shareBoard: (boardId) => {
    location.hash = `#/b/${boardId}`;
  },
  openSettings: () => openPanelSettings(),
};

export function extendBoard(patch: Partial<BoardExtensions>): void {
  Object.assign(boardExtensions, patch);
}
