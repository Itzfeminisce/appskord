/** ImportedBoard banner: who changed what, "Open my board" and "Send back" (ShareEditFile). */
import { useEffect, useState } from 'react';
import type { Board } from '@/lib/board/types';
import { findOwnBoard, NO_SENDER } from '@/lib/share/importBoard';
import { formatDay } from '@/lib/share/prepare';
import { loadAllBoards } from '@/lib/store/db';
import { Close } from '../icons';
import type { BoardShell } from '../shell/extensions';
import { ShareDialog } from './ShareDialog';

const initials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : name.trim().slice(0, 2)).toUpperCase();
};

export function ImportedBanner({ shell }: { shell: BoardShell }) {
  const { board } = shell;
  const [hidden, setHidden] = useState(false);
  const [mine, setMine] = useState<Board>();
  useEffect(() => {
    let live = true;
    loadAllBoards()
      .then((boards) => live && setMine(findOwnBoard(boards.filter((b) => b.id !== board.id), board.id)))
      .catch((error) => console.error('Briefkord: could not load boards', error));
    return () => {
      live = false;
    };
  }, [board.id]);

  const imported = board.imported;
  if (!imported || hidden) return null;
  const person = imported.person || NO_SENDER;
  return (
    <div role="status" className="bk-imported">
      <span className="bk-imported-avatar" aria-hidden="true">{initials(person)}</span>
      <span className="bk-grow">
        <b>Imported from {person}’s edit file</b> on {formatDay(imported.at)}. {person} changed {imported.changed} {imported.changed === 1 ? 'card' : 'cards'} and added {imported.added}. Your own board is unchanged.
      </span>
      <span className="bk-imported-chips">
        <span className="is-changed">{imported.changed} changed</span>
        <span className="is-added">{imported.added} new</span>
      </span>
      {mine && <a className="bk-imported-btn" href={`#/b/${mine.id}`}>Open my board</a>}
      <button type="button" className="bk-imported-btn is-primary" onClick={() => shell.openOverlay(<ShareDialog board={board} initialKind="edit" onClose={shell.closeOverlay} />)}>Send back</button>
      <button type="button" className="bk-imported-hide" aria-label="Hide this note" onClick={() => setHidden(true)}><Close size={14} /></button>
    </div>
  );
}
