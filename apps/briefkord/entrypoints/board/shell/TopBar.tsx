/** The 52 px bar on every board frame: Boards ›, name (rename in place), save status, Canvas / List, search, undo, redo, Brief me, Share, Start meeting. */
import { useState, type KeyboardEvent } from 'react';
import { CanvasIcon, Check, ChevronRight, ListIcon, Logo, Play, RedoIcon, SearchIcon, ShareIcon, Sparkle, UndoIcon } from '../icons';
import type { SaveStatus } from '../useBoard';

export interface TopBarProps {
  name: string;
  status: SaveStatus;
  view: 'canvas' | 'list';
  canUndo: boolean;
  canRedo: boolean;
  onBoards(): void;
  onRename(name: string): void;
  onView(view: 'canvas' | 'list'): void;
  onSearch(): void;
  onUndo(): void;
  onRedo(): void;
  onBriefMe(): void;
  onShare(): void;
  onStartMeeting(): void;
}

export function TopBar(props: TopBarProps) {
  return (
    <header className="bk-topbar">
      <Logo />
      <a className="bk-crumb" href="#/boards" onClick={(e) => (e.preventDefault(), props.onBoards())}>Boards<ChevronRight /></a>
      <BoardName name={props.name} onRename={props.onRename} />
      <SaveState status={props.status} />
      <span className="bk-grow" />
      <div role="tablist" aria-label="View" className="bk-switch">
        <button type="button" role="tab" aria-selected={props.view === 'canvas'} onClick={() => props.onView('canvas')}><CanvasIcon />Canvas</button>
        <button type="button" role="tab" aria-selected={props.view === 'list'} onClick={() => props.onView('list')}><ListIcon />List</button>
      </div>
      <button type="button" className="bk-icon-btn" aria-label="Search all boards" onClick={props.onSearch}><SearchIcon /></button>
      <button type="button" className="bk-icon-btn" aria-label="Undo" disabled={!props.canUndo} onClick={props.onUndo}><UndoIcon /></button>
      <button type="button" className="bk-icon-btn" aria-label="Redo" disabled={!props.canRedo} onClick={props.onRedo}><RedoIcon /></button>
      <span className="bk-bar-sep" aria-hidden="true" />
      <button type="button" className="bk-btn" onClick={props.onBriefMe}><span className="bk-accent-ink"><Sparkle /></span>Brief me</button>
      <button type="button" className="bk-btn" onClick={props.onShare}><ShareIcon />Share</button>
      <button type="button" className="bk-btn bk-btn-primary" onClick={props.onStartMeeting}><Play />Start meeting</button>
    </header>
  );
}

function SaveState({ status }: { status: SaveStatus }) {
  if (status === 'not-saved') return <span className="bk-not-saved" role="status">Not saved</span>;
  if (status === 'saving') return <span className="bk-save" role="status">Saving…</span>;
  return <span className="bk-save" role="status"><span className="bk-accent-ink"><Check /></span>Saved</span>;
}

/** board-rename: click the name, Enter saves, Esc cancels; an empty name is refused. */
function BoardName({ name, onRename }: { name: string; onRename(name: string): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const empty = draft !== null && draft.trim() === '';
  const finish = (save: boolean) => {
    if (draft === null) return;
    if (save && empty) return;
    if (save && draft.trim() !== name) onRename(draft.trim());
    setDraft(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') {
      e.stopPropagation();
      finish(false);
    }
  };
  if (draft === null) {
    return <h1 className="bk-board-name"><button type="button" onClick={() => setDraft(name)}>{name}</button></h1>;
  }
  return (
    <span className="bk-rename">
      <label className="bk-sr" htmlFor="bk-board-name">Board name</label>
      <input id="bk-board-name" autoFocus className={empty ? 'is-error' : undefined} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => finish(!empty)} aria-invalid={empty} />
      <span className={empty ? 'bk-rename-hint is-error' : 'bk-rename-hint'}>{empty ? 'Give the board a name.' : 'Enter to save'}</span>
    </span>
  );
}
