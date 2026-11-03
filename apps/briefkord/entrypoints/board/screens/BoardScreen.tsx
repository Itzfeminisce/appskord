/** The board tab: top bar, canvas (or a plug-in's List), details, overlays, toasts and every board state. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from '@appskord/platform/router';
import {
  addCard, addGroup, bringToFront, cardNumbers, deleteArrow, deleteCards, deleteGroup, moveCardInList, newId, recolourCards, renameBoard, renameGroup,
  sectionOf, setArrowDashed, updateCard,
} from '@/lib/board/ops';
import type { Board, Card } from '@/lib/board/types';
import { lineUp, type CanvasHandle, type Point } from '@/lib/canvas';
import { saveBoard } from '@/lib/store/db';
import { writeFile } from '@/lib/store/files';
import { fileUrl } from '../cards';
import { BoardCanvas, type CanvasActions } from '../canvas/BoardCanvas';
import { CardMenu, type CardMenuActions } from '../canvas/CardMenu';
import { DetailsPanel, type RefreshState } from '../canvas/DetailsPanel';
import { createUiStore, useUi } from '../canvas/uiStore';
import { duplicateCard, newChecklist, newDiagram, newFileCard, newNote } from '../logic/cards';
import { planDrop } from '../logic/drop';
import { keyAction, type Tool } from '../logic/keys';
import { readOpenPage } from '../logic/refresh';
import { boardExtensions, type BoardShell } from '../shell/extensions';
import { TopBar } from '../shell/TopBar';
import { useBoard, type BoardApi } from '../useBoard';
import { ImageOpen } from './ImageOpen';
import { Search } from './Search';
import { ShortcutsHelp } from './ShortcutsHelp';
import { BoardDamaged, BoardEmpty, BoardOpening, NotSaved, Toast, type ToastState } from './States';

export interface BoardScreenProps {
  id: string;
  card?: string;
  view: 'canvas' | 'list';
}

const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

export function BoardScreen(props: BoardScreenProps) {
  const api = useBoard(props.id);
  const router = useRouter();
  const go = useCallback((path: string) => router.history.push(path), [router]);

  if (api.load.state === 'opening') return <><BlankTopBar /><BoardOpening /></>;
  if (api.load.state === 'missing') return <Missing go={go} />;
  if (api.load.state === 'damaged') {
    const { name, copy } = api.load;
    const openCopy = () =>
      copy &&
      saveBoard(copy)
        .then(() => go(`/b/${copy.id}`))
        .catch((error: unknown) => console.error('Briefkord: could not save the copy', error));
    return <BoardDamaged name={name} cards={copy ? Object.keys(copy.cards).length : undefined} onOpenCopy={openCopy} onBack={() => go('/boards')} />;
  }
  return <ReadyBoard key={props.id} {...props} api={api} board={api.board!} go={go} />;
}

function BlankTopBar() {
  return <header className="bk-topbar" aria-hidden="true" />;
}

function Missing({ go }: { go(path: string): void }) {
  useEffect(() => go('/boards'), [go]);
  return null;
}

function ReadyBoard({ api, board, view, card: focusCard, go }: BoardScreenProps & { api: BoardApi; board: Board; go(path: string): void }) {
  const store = useMemo(createUiStore, []);
  const canvasRef = useRef<CanvasHandle>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [overlay, setOverlay] = useState<ReactNode>(null);
  const [panel, setPanel] = useState<'search' | 'help' | null>(null);
  const [openId, setOpenId] = useState<string>();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  const [toast, setToast] = useState<ToastState>();
  const [refresh, setRefresh] = useState<RefreshState>();
  const [detailsHidden, setDetailsHidden] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const windowId = useRef<number>(undefined);
  const selected = useUi(store, (s) => s.selected);
  const live = useRef({ board, api });
  live.current = { board, api };

  const numbers = useMemo(() => cardNumbers(board), [board]);
  useEffect(() => store.set({ numbers }), [store, numbers]);
  // Undo can take away selected cards.
  useEffect(() => {
    const s = store.get();
    const kept = [...s.selected].filter((id) => board.cards[id]);
    if (kept.length !== s.selected.size) store.select(kept);
    if (s.arrow && !board.arrows.some((a) => a.id === s.arrow)) store.set({ arrow: undefined });
    if (s.group && !board.groups.some((g) => g.id === s.group)) store.set({ group: undefined });
  }, [board, store]);
  useEffect(() => setDetailsHidden(false), [selected]);
  useEffect(() => {
    chrome.windows?.getCurrent?.().then((w) => (windowId.current = w.id)).catch(() => undefined);
  }, []);

  const change = api.change;
  const closeToast = useCallback(() => setToast(undefined), []);
  const setView = useCallback((v: 'canvas' | 'list') => go(`/b/${board.id}${v === 'list' ? '?view=list' : ''}`), [go, board.id]);

  const showCard = useCallback(
    (cardId: string) => {
      go(`/b/${live.current.board.id}?card=${encodeURIComponent(cardId)}`);
    },
    [go],
  );

  const shell: BoardShell = useMemo(
    () => ({ board, api, selection: [...selected], openOverlay: setOverlay, closeOverlay: () => setOverlay(null), showCard, setView }),
    [board, api, selected, showCard, setView],
  );
  const shellRef = useRef(shell);
  shellRef.current = shell;

  const select = (ids: string[]) => store.select(ids);

  const deleteWithUndo = (ids: string[]) => {
    const gone = ids.filter((id) => live.current.board.cards[id]);
    if (gone.length === 0) return;
    change((b, now) => deleteCards(b, gone, now));
    store.select([]);
    setToast({ kind: 'undo', text: gone.length === 1 ? '1 card deleted.' : `${gone.length} cards deleted.`, onUndo: () => live.current.api.undo() });
  };

  const addCardAt = (kind: 'note' | 'checklist' | 'diagram', at: Point) => {
    const id = newId();
    const make = kind === 'note' ? newNote : kind === 'checklist' ? newChecklist : newDiagram;
    const card = make(id, at, Date.now());
    const placed = { ...card, rect: { ...card.rect, x: Math.round(at.x - card.rect.w / 2), y: Math.round(at.y - card.rect.h / 2) } } as Card;
    change((b, now) => addCard(b, placed, now));
    store.select([id]);
    if (kind === 'diagram') boardExtensions.editDiagram(shellRef.current, id);
    else store.set({ editing: id });
  };

  const viewCentre = (): Point => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const cam = c.camera(), size = c.size();
    return { x: (size.w / 2 - cam.x) / cam.zoom, y: (size.h / 2 - cam.y) / cam.zoom };
  };

  const addFiles = async (files: File[], at: Point) => {
    const plan = planDrop(files);
    if (plan.boardFile) {
      boardExtensions.importFile(shellRef.current, plan.boardFile);
      return;
    }
    const boardId = live.current.board.id;
    const cards: Card[] = [];
    for (const file of plan.accepted) {
      const fileId = newId();
      try {
        await writeFile(boardId, fileId, file);
      } catch (error) {
        console.error('Briefkord: could not store a dropped file', error);
        continue;
      }
      let image: { w: number; h: number } | undefined;
      if (file.type.startsWith('image/')) {
        try {
          const bitmap = await createImageBitmap(file);
          image = { w: bitmap.width, h: bitmap.height };
          bitmap.close();
        } catch {
          image = undefined;
        }
      }
      const n = cards.length;
      const ref = { id: fileId, name: file.name, mime: file.type || 'application/octet-stream', size: file.size };
      const card = newFileCard(newId(), { x: 0, y: 0 }, ref, Date.now(), image);
      cards.push({ ...card, rect: { ...card.rect, x: Math.round(at.x - card.rect.w / 2 + n * 28), y: Math.round(at.y - card.rect.h / 2 + n * 28) } });
    }
    if (cards.length) {
      change((b, now) => cards.reduce((acc, c) => addCard(acc, c, now), b));
      store.select(cards.map((c) => c.id));
    }
    if (plan.skipped.length || cards.length < plan.accepted.length) {
      const first = plan.skipped[0]?.file ?? plan.accepted.find((f) => !cards.some((c) => (c.kind === 'image' || c.kind === 'file') && c.file.name === f.name));
      setToast({
        kind: 'skipped',
        title: `${cards.length} of ${files.length} files added`,
        text: `“${first?.name ?? ''}” wasn’t added: videos aren’t supported. Files over 50 MB are skipped too.`,
      });
    }
  };

  const openUrl = (url: string) => {
    if (chrome.tabs?.create) void chrome.tabs.create({ url });
    else window.open(url, '_blank', 'noopener');
  };

  const openLarge = (id: string) => {
    const card = live.current.board.cards[id];
    if (!card) return;
    if (card.kind === 'file') {
      void fileUrl(live.current.board.id, card.file.id).then((url) => url && openUrl(url));
      return;
    }
    setOpenId(id);
  };

  const doRefresh = async (id: string) => {
    const card = live.current.board.cards[id];
    if (card?.kind !== 'link') return;
    store.select([id]);
    setDetailsHidden(false);
    setRefresh({ cardId: id, phase: 'refreshing' });
    const page = await readOpenPage(card.url);
    if (!page) setRefresh({ cardId: id, phase: 'gone' });
    else if (page.text === card.text) setRefresh(undefined);
    else setRefresh({ cardId: id, phase: 'updated', title: page.title, text: page.text, words: page.words });
  };

  const listMove = (id: string, by: -1 | 1) =>
    change((b, now) => {
      const at = b.sections.findIndex((s) => s.cards.includes(id));
      const section = b.sections[at];
      if (!section) return b;
      const i = section.cards.indexOf(id);
      if (by < 0) {
        if (i > 0) return moveCardInList(b, id, section.id, i - 1, now);
        const prev = b.sections[at - 1];
        return prev ? moveCardInList(b, id, prev.id, prev.cards.length, now) : b;
      }
      if (i < section.cards.length - 1) return moveCardInList(b, id, section.id, i + 1, now);
      const next = b.sections[at + 1];
      return next ? moveCardInList(b, id, next.id, 0, now) : b;
    });

  const duplicate = (ids: string[]) => {
    const copies = ids.flatMap((id) => (live.current.board.cards[id] ? [{ from: id, copy: duplicateCard(live.current.board.cards[id]!, newId(), Date.now()) }] : []));
    change((b, now) =>
      copies.reduce((acc, { from, copy }) => {
        const section = sectionOf(acc, from);
        return addCard(acc, copy, now, section ? { sectionId: section.id, index: section.cards.indexOf(from) + 1 } : {});
      }, b),
    );
    store.select(copies.map((c) => c.copy.id));
  };

  const menuActions: CardMenuActions = {
    openLarge,
    edit: (id) => store.set({ editing: id, selected: new Set([id]) }),
    duplicate,
    recolour: (ids, colour) => change((b, now) => recolourCards(b, ids, colour, now)),
    moveToSection: (ids, sectionId) => change((b, now) => ids.reduce((acc, id) => moveCardInList(acc, id, sectionId, Number.MAX_SAFE_INTEGER, now), b)),
    bringToFront: (ids) => change((b, now) => bringToFront(b, ids, now)),
    saveImage: (id) => {
      const card = live.current.board.cards[id];
      if (card?.kind !== 'image') return;
      void fileUrl(live.current.board.id, card.file.id).then((url) => {
        if (!url) return;
        const a = document.createElement('a');
        a.href = url;
        a.download = card.file.name;
        a.click();
      });
    },
    summarize: (id) => boardExtensions.summarize(shellRef.current, id),
    refresh: (id) => void doRefresh(id),
    deleteCards: deleteWithUndo,
  };

  const actions: CanvasActions = {
    change,
    addCardAt,
    openLarge,
    openMenu: (id, x, y) => setMenu({ id, x, y }),
    editDiagram: (id) => boardExtensions.editDiagram(shellRef.current, id),
    addFiles: (files, at) => void addFiles(files, at),
    importFile: (file) => boardExtensions.importFile(shellRef.current, file),
    pickFiles: () => fileInput.current?.click(),
    showHelp: () => setPanel('help'),
    recolour: menuActions.recolour,
    summarize: menuActions.summarize,
    openPage: (id) => {
      const card = live.current.board.cards[id];
      const url = card?.kind === 'link' ? card.url : card?.kind === 'image' ? card.pageUrl : undefined;
      if (url) openUrl(url);
    },
    connect: (id) => store.set({ connectFrom: store.get().connectFrom === id ? undefined : id }),
    more: (id, x, y) => setMenu({ id, x, y }),
    deleteCards: deleteWithUndo,
    group: (ids) => {
      const id = newId();
      change((b, now) => addGroup(b, { id, title: '', cards: ids }, now));
      store.set({ selected: new Set(), group: id, arrow: undefined });
    },
    lineUp: (ids) =>
      change((b, now) => {
        const ordered = ids.filter((id) => b.cards[id]).sort((x, y) => (numbers[x] ?? 0) - (numbers[y] ?? 0));
        const rects = lineUp(ordered.map((id) => b.cards[id]!.rect));
        return ordered.reduce((acc, id, i) => updateCard(acc, id, now, (c) => ({ ...c, rect: rects[i]! })), b);
      }),
    moveToSection: menuActions.moveToSection,
    setArrowDashed: (id, dashed) => change((b, now) => setArrowDashed(b, id, dashed, now)),
    deleteArrow: (id) => {
      change((b, now) => deleteArrow(b, id, now));
      store.set({ arrow: undefined });
    },
    ungroup: (id) => {
      change((b, now) => deleteGroup(b, id, now));
      store.set({ group: undefined });
    },
    renameGroup: (id, title) => change((b, now) => renameGroup(b, id, title, now)),
  };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (panel || openId || overlay) {
        if (panel && e.key === 'Escape') setPanel(null);
        return;
      }
      const s = store.get();
      const hasSelection = s.selected.size > 0 || !!s.arrow || !!s.group;
      const action = keyAction({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey, typing: isTyping(e.target), hasSelection });
      if (!action) {
        if (e.key === ' ' && !isTyping(e.target) && !e.repeat) {
          e.preventDefault();
          setSpaceHeld(true);
        }
        return;
      }
      if (isTyping(e.target) && action.type === 'escape') return;
      e.preventDefault();
      const ids = [...s.selected];
      const a = actionsRef.current;
      const { api: liveApi } = live.current;
      switch (action.type) {
        case 'search': return setPanel('search');
        case 'help': return setPanel('help');
        case 'undo': return liveApi.undo();
        case 'redo': return liveApi.redo();
        case 'duplicate': return ids.length && duplicate(ids);
        case 'open-large': return ids[0] && openLarge(ids[0]);
        case 'list-move': return ids.length === 1 && listMove(ids[0]!, action.by);
        case 'delete':
          if (s.arrow) return a.deleteArrow(s.arrow);
          if (s.group) return a.ungroup(s.group);
          return deleteWithUndo(ids);
        case 'escape':
          if (menu) return setMenu(undefined);
          if (s.connectFrom) return store.set({ connectFrom: undefined });
          if (tool !== 'select') return setTool('select');
          return store.select([]);
        case 'tool':
          if (action.tool === 'diagram') return a.addCardAt('diagram', viewCentre());
          if (action.tool === 'group' && ids.length > 0) return a.group(ids);
          return setTool(action.tool);
      }
    };
    const onUp = (e: KeyboardEvent) => e.key === ' ' && setSpaceHeld(false);
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  });

  const openSidePanel = () => {
    const id = windowId.current;
    if (id === undefined || !chrome.sidePanel) return;
    chrome.sidePanel.open({ windowId: id }).catch((error: unknown) => console.error('Briefkord: could not open the side panel', error));
  };

  const single = selected.size === 1 ? board.cards[[...selected][0]!] : undefined;
  const menuCard = menu ? board.cards[menu.id] : undefined;
  const ListView = boardExtensions.ListView;
  const empty = Object.keys(board.cards).length === 0;

  return (
    <div className="bk-board">
      <TopBar
        name={board.name}
        status={api.status}
        view={view}
        canUndo={api.canUndo}
        canRedo={api.canRedo}
        onBoards={() => go('/boards')}
        onRename={(name) => change((b, now) => renameBoard(b, name, now))}
        onView={setView}
        onSearch={() => setPanel('search')}
        onUndo={api.undo}
        onRedo={api.redo}
        onBriefMe={() => boardExtensions.briefMe(shell)}
        onShare={() => boardExtensions.share(shell)}
        onStartMeeting={() => boardExtensions.startMeeting(shell)}
      />
      <div className="bk-board-body">
        {view === 'list' ? (
          <ListView shell={shell} />
        ) : (
          <BoardCanvas
            board={board}
            store={store}
            canvasRef={canvasRef}
            tool={tool}
            setTool={setTool}
            spaceHeld={spaceHeld}
            actions={actions}
            focusCard={focusCard}
            empty={empty ? <BoardEmpty onAddNote={() => addCardAt('note', viewCentre())} onDescribe={() => boardExtensions.describeFlow(shell)} onSidePanel={openSidePanel} /> : undefined}
          />
        )}
        {view === 'canvas' && single && !detailsHidden && (
          <DetailsPanel
            board={board}
            card={single}
            refresh={refresh}
            change={change}
            onRefresh={(id) => void doRefresh(id)}
            onKeepNew={() => {
              if (refresh?.phase === 'updated') {
                const r = refresh;
                change((b, now) => updateCard(b, r.cardId, now, (c) => (c.kind === 'link' ? { ...c, text: r.text, words: r.words, savedAt: now } : c)));
              }
              setRefresh(undefined);
            }}
            onKeepOld={() => setRefresh(undefined)}
            onClose={() => setDetailsHidden(true)}
          />
        )}
        {api.status === 'not-saved' && <NotSaved changes={api.unsaved} onTry={api.retry} onExport={() => boardExtensions.share(shell)} />}
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void addFiles(files, viewCentre());
        }}
      />
      {menu && menuCard && <CardMenu card={menuCard} board={board} x={menu.x} y={menu.y} actions={menuActions} onClose={() => setMenu(undefined)} />}
      {toast && <Toast toast={toast} onClose={closeToast} />}
      {panel === 'search' && (
        <Search
          board={board}
          onClose={() => setPanel(null)}
          onOpen={(boardId, cardId) => {
            setPanel(null);
            go(`/b/${boardId}?card=${encodeURIComponent(cardId)}`);
          }}
        />
      )}
      {panel === 'help' && <ShortcutsHelp onClose={() => setPanel(null)} />}
      {openId && <ImageOpen board={board} cardId={openId} onClose={() => setOpenId(undefined)} onShow={setOpenId} />}
      {overlay}
    </div>
  );
}
