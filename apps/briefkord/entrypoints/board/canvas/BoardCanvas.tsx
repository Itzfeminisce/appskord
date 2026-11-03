/** The board canvas on lib/canvas: cards, groups and arrows, with select, move, resize, marquee, connect, zoom, map and file drop. */
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { addArrow, moveCards, newId, resizeCard, updateCard } from '@/lib/board/ops';
import type { Board, Card, Rect } from '@/lib/board/types';
import { Canvas, centreOn, fitAll, itemsInRect, normalRect, topItemAt, zoomAt, type Camera, type CanvasHandle, type Point } from '@/lib/canvas';
import { CardBody } from '../cards';
import { ToolArrow, ToolAttach, ToolChecklist, ToolDiagram, ToolGroup, ToolNote, ToolSelect, UploadIcon, DownloadIcon } from '../icons';
import { regroup } from '../logic/groups';
import type { Tool } from '../logic/keys';
import { ArrowBar, CardBar, GroupBar, MultiBar, type BarActions } from './Bars';
import { Minimap } from './Minimap';
import { useUi, type UiStore } from './uiStore';

export interface CanvasActions extends BarActions {
  /** One undo step. */
  change(edit: (board: Board, now: number) => Board): void;
  addCardAt(kind: 'note' | 'checklist' | 'diagram', at: Point): void;
  openLarge(id: string): void;
  openMenu(id: string, x: number, y: number): void;
  editDiagram(id: string): void;
  addFiles(files: File[], at: Point): void;
  importFile(file: File): void;
  pickFiles(): void;
  showHelp(): void;
}

export interface BoardCanvasProps {
  board: Board;
  store: UiStore;
  canvasRef: RefObject<CanvasHandle | null>;
  tool: Tool;
  setTool(tool: Tool): void;
  spaceHeld: boolean;
  actions: CanvasActions;
  /** Select and centre this card on open (`?card=`). */
  focusCard?: string;
  /** Shown over the empty canvas (board-empty). */
  empty?: ReactNode;
}

type Gesture =
  | { kind: 'move'; ids: string[]; from: Point; dx: number; dy: number; moved: boolean; click?: string }
  | { kind: 'resize'; id: string; corner: 'nw' | 'ne' | 'sw' | 'se'; start: Rect; from: Point; rect: Rect }
  | { kind: 'marquee'; from: Point; to: Point; add: boolean }
  | { kind: 'link'; from: string; to: Point };

interface Handlers {
  cardDown(e: PointerEvent<HTMLElement>, id: string): void;
  cardMenu(e: MouseEvent<HTMLElement>, id: string): void;
}

const HandlersContext = createContext<{ current: Handlers } | null>(null);
const StoreContext = createContext<UiStore | null>(null);
const BoardContext = createContext<{ current: { boardId: string; change: CanvasActions['change'] } } | null>(null);

const CardFrame = memo(function CardFrame({ card }: { card: Card }) {
  const store = useContext(StoreContext)!;
  const handlers = useContext(HandlersContext)!;
  const boardRef = useContext(BoardContext)!;
  const selected = useUi(store, (s) => s.selected.has(card.id));
  const editing = useUi(store, (s) => s.editing === card.id);
  const number = useUi(store, (s) => s.numbers[card.id]);
  const cls = `bk-card bk-kind-${card.kind} bk-c-${card.colour}${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}${card.mark ? ` is-${card.mark}` : ''}`;
  return (
    <article className={cls} aria-label={card.title} onPointerDown={(e) => handlers.current.cardDown(e, card.id)} onContextMenu={(e) => handlers.current.cardMenu(e, card.id)}>
      <CardBody
        card={card}
        number={number}
        boardId={boardRef.current.boardId}
        editing={editing}
        onCommit={(next) => boardRef.current.change((b, now) => updateCard(b, card.id, now, () => next))}
        onDone={() => store.set({ editing: undefined })}
      />
    </article>
  );
});

const renderCard = (card: Card) => <CardFrame card={card} />;

const TOOLS: { tool: Tool; label: string; icon: ReactNode }[] = [
  { tool: 'select', label: 'Select (V)', icon: <ToolSelect /> },
  { tool: 'note', label: 'Note (N)', icon: <ToolNote /> },
  { tool: 'checklist', label: 'Checklist (C)', icon: <ToolChecklist /> },
  { tool: 'diagram', label: 'Diagram (D)', icon: <ToolDiagram /> },
  { tool: 'arrow', label: 'Arrow (A)', icon: <ToolArrow /> },
  { tool: 'group', label: 'Group (G)', icon: <ToolGroup /> },
];

export function BoardCanvas(props: BoardCanvasProps) {
  const { board, store, canvasRef, tool, actions } = props;
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ count: number; boardFile: boolean } | null>(null);
  const dragDepth = useRef(0);
  const minimap = useRef<(camera: Camera) => void>(undefined);
  const live = useRef({ board, tool, actions, gesture, setTool: props.setTool, spaceHeld: props.spaceHeld });
  live.current = { board, tool, actions, gesture, setTool: props.setTool, spaceHeld: props.spaceHeld };
  const boardRef = useRef({ boardId: board.id, change: actions.change });
  boardRef.current = { boardId: board.id, change: actions.change };

  const selected = useUi(store, (s) => s.selected);
  const selArrow = useUi(store, (s) => s.arrow);
  const selGroup = useUi(store, (s) => s.group);
  const editing = useUi(store, (s) => s.editing);
  const connectFrom = useUi(store, (s) => s.connectFrom);

  const items = useMemo(() => {
    const cards = Object.values(board.cards);
    if (gesture?.kind === 'move' && gesture.moved) {
      const moving = new Set(gesture.ids);
      return cards.map((c) => (moving.has(c.id) ? { ...c, rect: { ...c.rect, x: c.rect.x + gesture.dx, y: c.rect.y + gesture.dy } } : c));
    }
    if (gesture?.kind === 'resize') return cards.map((c) => (c.id === gesture.id ? { ...c, rect: gesture.rect } : c));
    return cards;
  }, [board.cards, gesture]);
  const rectOf = useMemo(() => new Map(items.map((c) => [c.id, c.rect])), [items]);

  const toWorld = (x: number, y: number): Point => canvasRef.current?.toWorld(x, y) ?? { x, y };
  const viewCentre = (): Point => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const cam = c.camera(), size = c.size();
    return { x: (size.w / 2 - cam.x) / cam.zoom, y: (size.h / 2 - cam.y) / cam.zoom };
  };

  // One window listener pair per gesture, so a drag keeps going outside the card or the canvas.
  const track = (start: Gesture, onMove: (g: Gesture, e: globalThis.PointerEvent) => Gesture, onUp: (g: Gesture, e: globalThis.PointerEvent) => void) => {
    let current = start;
    setGesture(start);
    const move = (e: globalThis.PointerEvent) => {
      current = onMove(current, e);
      setGesture(current);
    };
    const up = (e: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setGesture(null);
      onUp(current, e);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const startMove = (ids: string[], e: PointerEvent, click?: string) => {
    const from = toWorld(e.clientX, e.clientY);
    const zoomNow = canvasRef.current?.camera().zoom ?? 1;
    track(
      { kind: 'move', ids, from, dx: 0, dy: 0, moved: false, click },
      (g, ev) => {
        if (g.kind !== 'move') return g;
        const p = toWorld(ev.clientX, ev.clientY);
        const dx = Math.round(p.x - g.from.x), dy = Math.round(p.y - g.from.y);
        const moved = g.moved || Math.hypot(dx, dy) * zoomNow > 3;
        return { ...g, dx, dy, moved };
      },
      (g) => {
        if (g.kind !== 'move') return;
        if (g.moved) live.current.actions.change((b, now) => regroup(moveCards(b, g.ids, g.dx, g.dy, now), g.ids, now));
        else if (g.click) store.select([g.click]);
      },
    );
  };

  const handlers = useRef<Handlers>({ cardDown: () => undefined, cardMenu: () => undefined });
  handlers.current = {
    cardDown(e, id) {
      if (e.button !== 0 || live.current.spaceHeld) return;
      const s = store.get();
      if (s.editing === id) return;
      if (s.editing) store.set({ editing: undefined });
      if (s.connectFrom) {
        e.stopPropagation();
        const from = s.connectFrom;
        store.set({ connectFrom: undefined });
        if (from !== id) actions.change((b, now) => addArrow(b, { id: newId(), from, to: id }, now));
        return;
      }
      if (live.current.tool === 'arrow') {
        e.preventDefault();
        track(
          { kind: 'link', from: id, to: toWorld(e.clientX, e.clientY) },
          (g, ev) => (g.kind === 'link' ? { ...g, to: toWorld(ev.clientX, ev.clientY) } : g),
          (g) => {
            if (g.kind !== 'link') return;
            const target = topItemAt(Object.values(live.current.board.cards), g.to);
            if (target && target.id !== g.from) actions.change((b, now) => addArrow(b, { id: newId(), from: g.from, to: target.id }, now));
          },
        );
        return;
      }
      if ((e.target as Element).closest('input, textarea, button, a, label')) return;
      e.preventDefault();
      let ids: string[];
      if (e.shiftKey) {
        const next = new Set(s.selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        store.select(next);
        if (!next.has(id)) return;
        ids = [...next];
      } else if (!s.selected.has(id)) {
        store.select([id]);
        ids = [id];
      } else {
        ids = [...s.selected];
      }
      startMove(ids, e, !e.shiftKey && s.selected.has(id) && s.selected.size > 1 ? id : undefined);
    },
    cardMenu(e, id) {
      e.preventDefault();
      if (!store.get().selected.has(id)) store.select([id]);
      actions.openMenu(id, e.clientX, e.clientY);
    },
  };

  const onBackgroundDown = (e: PointerEvent<HTMLDivElement>, at: Point): boolean => {
    if (e.button !== 0) return false;
    const s = store.get();
    if (s.editing || s.connectFrom) store.set({ editing: undefined, connectFrom: undefined });
    const t = live.current.tool;
    if (t === 'note' || t === 'checklist') {
      actions.addCardAt(t, at);
      props.setTool('select');
      return true;
    }
    track(
      { kind: 'marquee', from: at, to: at, add: e.shiftKey },
      (g, ev) => (g.kind === 'marquee' ? { ...g, to: toWorld(ev.clientX, ev.clientY) } : g),
      (g) => {
        if (g.kind !== 'marquee') return;
        const area = normalRect({ x: g.from.x, y: g.from.y, w: g.to.x - g.from.x, h: g.to.y - g.from.y });
        const zoomNow = canvasRef.current?.camera().zoom ?? 1;
        if (Math.max(area.w, area.h) * zoomNow < 4) {
          if (!g.add) store.select([]);
          return;
        }
        const hit = itemsInRect(Object.values(live.current.board.cards), area);
        store.select(g.add ? [...store.get().selected, ...hit] : hit);
        if (live.current.tool === 'group' && hit.length > 0) {
          actions.group(hit);
          props.setTool('select');
        }
      },
    );
    return true;
  };

  const onArrowDown = (id: string, e: PointerEvent<SVGPathElement>) => {
    e.stopPropagation();
    store.set({ selected: new Set(), arrow: id, group: undefined, editing: undefined });
  };

  const onGroupDown = (e: PointerEvent<HTMLElement>, groupId: string) => {
    if (e.button !== 0 || props.spaceHeld) return;
    if ((e.target as Element).closest('input')) return;
    e.stopPropagation();
    e.preventDefault();
    const group = board.groups.find((g) => g.id === groupId);
    if (!group) return;
    store.set({ selected: new Set(), arrow: undefined, group: groupId, editing: undefined });
    startMove(group.cards, e);
  };

  const startResize = (e: PointerEvent<HTMLElement>, id: string, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    e.stopPropagation();
    e.preventDefault();
    const start = board.cards[id]?.rect;
    if (!start) return;
    const from = toWorld(e.clientX, e.clientY);
    track(
      { kind: 'resize', id, corner, start, from, rect: start },
      (g, ev) => {
        if (g.kind !== 'resize') return g;
        const p = toWorld(ev.clientX, ev.clientY);
        const dx = Math.round(p.x - g.from.x), dy = Math.round(p.y - g.from.y);
        const r = { ...g.start };
        const w = Math.max(120, g.corner.includes('e') ? r.w + dx : r.w - dx);
        const h = Math.max(60, g.corner.includes('s') ? r.h + dy : r.h - dy);
        return { ...g, rect: { x: g.corner.includes('w') ? r.x + r.w - w : r.x, y: g.corner.includes('n') ? r.y + r.h - h : r.y, w, h } };
      },
      (g) => g.kind === 'resize' && actions.change((b, now) => resizeCard(b, g.id, g.rect, now)),
    );
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const item = target.closest('[data-canvas-item]');
    if (item) {
      const id = item.getAttribute('data-canvas-item')!;
      const card = board.cards[id];
      if (!card || store.get().editing === id) return;
      if (card.kind === 'note' || card.kind === 'checklist') store.set({ editing: id, selected: new Set([id]) });
      else if (card.kind === 'diagram') actions.editDiagram(id);
      else actions.openLarge(id);
      return;
    }
    if (target.closest('[data-canvas-control]') || !target.closest('.bk-canvas')) return;
    actions.addCardAt('note', toWorld(e.clientX, e.clientY));
  };

  const registerMap = useCallback((fn: (camera: Camera) => void) => (minimap.current = fn), []);
  const onCamera = useCallback((cam: Camera) => {
    setZoom((z) => (z === cam.zoom ? z : cam.zoom));
    minimap.current?.(cam);
  }, []);

  // The first view: the card named in the address, or every card.
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const card = props.focusCard ? board.cards[props.focusCard] : undefined;
    if (card) {
      c.setCamera(centreOn(card.rect, c.size(), 1));
      store.select([card.id]);
      return;
    }
    const cam = fitAll(Object.values(board.cards).map((x) => x.rect), c.size());
    if (cam) c.setCamera(cam);
  }, [board.id, props.focusCard]);

  const zoomBy = (factor: number) => {
    const c = canvasRef.current;
    if (!c) return;
    const size = c.size();
    c.setCamera(zoomAt(c.camera(), { x: size.w / 2, y: size.h / 2 }, factor));
  };
  const fit = () => {
    const c = canvasRef.current;
    const cam = c && fitAll(Object.values(board.cards).map((x) => x.rect), c.size());
    if (cam) c.setCamera(cam);
  };

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    const files = [...e.dataTransfer.items].filter((i) => i.kind === 'file');
    // A .briefkord file has no type while it is dragged; that is the only hint before the drop.
    setDrag({ count: files.length, boardFile: files.length === 1 && files[0]!.type === '' });
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDrag(null);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDrag(null);
    actions.addFiles([...e.dataTransfer.files], toWorld(e.clientX, e.clientY));
  };

  // Keeps the size hint and bars readable at any zoom.
  const unscale = { transform: `scale(${1 / zoom})`, transformOrigin: '0 0' };
  const single = selected.size === 1 && !editing ? [...selected][0] : undefined;
  const singleRect = single ? rectOf.get(single) : undefined;
  const singleCard = single ? board.cards[single] : undefined;

  const groups = board.groups.flatMap((group) => {
    const box = boxAround(group.cards.map((id) => rectOf.get(id)).filter((r): r is Rect => !!r), 18);
    return box ? [{ group, box }] : [];
  });

  const underlay = groups.map(({ group, box }) => (
    <section
      key={group.id}
      data-canvas-control=""
      aria-label={group.title}
      className={selGroup === group.id ? 'bk-group is-selected' : 'bk-group'}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onPointerDown={(e) => onGroupDown(e, group.id)}
    >
      {selGroup === group.id ? (
        <GroupName title={group.title} onRename={(title) => actions.renameGroup(group.id, title)} />
      ) : (
        group.title && <span className="bk-group-label">{group.title}</span>
      )}
    </section>
  ));

  const selRects = [...selected].map((id) => rectOf.get(id)).filter((r): r is Rect => !!r);
  const selBox = selRects.length > 1 ? { x: Math.min(...selRects.map((r) => r.x)), y: Math.min(...selRects.map((r) => r.y)) } : undefined;
  const arrow = selArrow ? board.arrows.find((a) => a.id === selArrow) : undefined;
  const arrowMid = arrow && rectOf.get(arrow.from) && rectOf.get(arrow.to) ? midpoint(rectOf.get(arrow.from)!, rectOf.get(arrow.to)!) : undefined;
  const groupSel = selGroup ? groups.find((g) => g.group.id === selGroup) : undefined;

  const overlay = (
    <>
      {gesture?.kind === 'marquee' && <div className="bk-marquee" style={rectStyle(normalRect({ x: gesture.from.x, y: gesture.from.y, w: gesture.to.x - gesture.from.x, h: gesture.to.y - gesture.from.y }))} />}
      {gesture?.kind === 'link' && rectOf.get(gesture.from) && <LinkDraft from={rectOf.get(gesture.from)!} to={gesture.to} />}
      {singleRect && singleCard && !(gesture?.kind === 'move' && gesture.moved) && (
        <>
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <span
              key={corner}
              data-canvas-control=""
              className={`bk-handle bk-handle-${corner}`}
              style={{ left: singleRect.x + (corner.includes('e') ? singleRect.w + 4 : -4), top: singleRect.y + (corner.includes('s') ? singleRect.h + 4 : -4), transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
              onPointerDown={(e) => startResize(e, single!, corner)}
            />
          ))}
          <div className="bk-float" style={{ left: singleRect.x - 4, top: singleRect.y - 4, ...unscale }}>
            <CardBar card={singleCard} actions={actions} connecting={connectFrom === single} />
          </div>
          <p className="bk-size-hint" style={{ left: singleRect.x, top: singleRect.y + singleRect.h, ...unscale }}>
            {Math.round(singleRect.w)} × {Math.round(singleRect.h)} · drag a corner to resize · Shift-click to pick more
          </p>
        </>
      )}
      {selBox && !(gesture?.kind === 'move' && gesture.moved) && (
        <div className="bk-float" style={{ left: selBox.x, top: selBox.y - 4, ...unscale }}>
          <MultiBar ids={[...selected]} board={board} actions={actions} />
        </div>
      )}
      {arrow && arrowMid && (
        <div className="bk-float bk-float-centre" style={{ left: arrowMid.x, top: arrowMid.y - 10, ...unscale }}>
          <ArrowBar arrow={arrow} actions={actions} />
        </div>
      )}
      {groupSel && (
        <div className="bk-float" style={{ left: groupSel.box.x, top: groupSel.box.y - 8, ...unscale }}>
          <GroupBar group={groupSel.group} actions={actions} />
        </div>
      )}
    </>
  );

  const cursor = connectFrom || tool === 'arrow' ? 'crosshair' : tool === 'note' || tool === 'checklist' ? 'copy' : 'default';

  return (
    <StoreContext.Provider value={store}>
      <HandlersContext.Provider value={handlers}>
        <BoardContext.Provider value={boardRef}>
          <main className="bk-canvas-wrap" aria-label="Canvas" onDoubleClick={onDoubleClick} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
            <Canvas
              ref={canvasRef}
              className="bk-canvas"
              style={FILL}
              items={items}
              arrows={board.arrows}
              renderItem={renderCard}
              onCameraChange={onCamera}
              onBackgroundPointerDown={onBackgroundDown}
              panAnywhere={props.spaceHeld}
              onArrowPointerDown={onArrowDown}
              selectedArrows={selArrow ? new Set([selArrow]) : undefined}
              underlay={underlay}
              overlay={overlay}
              cursor={cursor}
            />
            {props.empty}
            <nav aria-label="Tools" className="bk-dock">
              {TOOLS.map(({ tool: t, label, icon }) => (
                <button key={t} type="button" aria-label={label} title={label} aria-pressed={tool === t} onClick={() => (t === 'diagram' ? actions.addCardAt('diagram', viewCentre()) : props.setTool(t))}>
                  {icon}
                </button>
              ))}
              <span className="bk-dock-sep" aria-hidden="true" />
              <button type="button" aria-label="Add a file or image" title="Add a file or image" onClick={actions.pickFiles}><ToolAttach /></button>
            </nav>
            <div className="bk-zoom">
              <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>−</button>
              <span className="bk-zoom-pc">{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>+</button>
              <span className="bk-zoom-sep" aria-hidden="true" />
              <button type="button" className="bk-zoom-fit" onClick={fit}>Fit all</button>
              <span className="bk-zoom-sep" aria-hidden="true" />
              <button type="button" className="bk-zoom-help" aria-label="Keyboard shortcuts (?)" onClick={actions.showHelp}>?</button>
            </div>
            <p className="bk-canvas-hint">Double-click to add a note. Drop files anywhere. Numbers are the order in the list.</p>
            {!props.empty && <Minimap cards={board.cards} canvasRef={canvasRef} register={registerMap} />}
            {drag && <DropOverlay count={drag.count} boardFile={drag.boardFile} />}
          </main>
        </BoardContext.Provider>
      </HandlersContext.Provider>
    </StoreContext.Provider>
  );
}

function GroupName({ title, onRename }: { title: string; onRename(title: string): void }) {
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  return (
    <input
      className="bk-group-input"
      type="text"
      aria-label="Group name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== title && onRename(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setValue(title);
      }}
    />
  );
}

function LinkDraft({ from, to }: { from: Rect; to: Point }) {
  const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const left = Math.min(a.x, to.x), top = Math.min(a.y, to.y);
  return (
    <svg className="bk-link-draft" style={{ left, top, width: Math.abs(to.x - a.x) + 2, height: Math.abs(to.y - a.y) + 2 }}>
      <line x1={a.x - left} y1={a.y - top} x2={to.x - left} y2={to.y - top} />
    </svg>
  );
}

function DropOverlay({ count, boardFile }: { count: number; boardFile: boolean }) {
  if (boardFile) {
    return (
      <div className="bk-drop" aria-live="polite">
        <span className="bk-drop-icon"><DownloadIcon /></span>
        <span className="bk-drop-title">This is a Briefkord board file</span>
        <span className="bk-drop-sub">Drop it to open it as a new board. Nothing on this board changes.</span>
        <a className="bk-drop-link" href="#/import">What happens on import</a>
      </div>
    );
  }
  return (
    <div className="bk-drop" aria-live="polite">
      <span className="bk-drop-icon"><UploadIcon /></span>
      <span className="bk-drop-title">Drop to add {count} {count === 1 ? 'file' : 'files'}</span>
      <span className="bk-drop-sub">Images, PDFs and documents, up to 50 MB each</span>
      <span className="bk-drop-mono">stays on this computer</span>
    </div>
  );
}

/** The box around some rects, `pad` out, as a group draws it. */
function boxAround(rects: readonly Rect[], pad: number): Rect | undefined {
  if (rects.length === 0) return undefined;
  const x = Math.min(...rects.map((r) => r.x)) - pad, y = Math.min(...rects.map((r) => r.y)) - pad;
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) + pad - x, h: Math.max(...rects.map((r) => r.y + r.h)) + pad - y };
}

const FILL = { position: 'absolute', inset: 0 } as const;
const rectStyle = (r: Rect) => ({ left: r.x, top: r.y, width: r.w, height: r.h });
const midpoint = (a: Rect, b: Rect): Point => ({ x: (a.x + a.w / 2 + b.x + b.w / 2) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 });
