import { listOrder } from '@/lib/board/ops';
import type { BoardShell } from '../shell/extensions';
import { Meeting } from './Meeting';

/** "Start meeting": meeting mode over the board, from the first card in the list. */
export function startMeeting(shell: BoardShell): void {
  if (listOrder(shell.board).length === 0) return;
  shell.openOverlay(<Meeting key={Date.now()} shell={shell} />);
}
