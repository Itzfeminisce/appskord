/** DiagramEdit: a diagram card opened over the board. Edits stay in a draft; Done saves them as one undo step. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cardLabel } from '@/lib/board/label';
import { cardNumbers, listOrder, newId, updateCard } from '@/lib/board/ops';
import type { Board, CardColour, Diagram, DiagramNode, DiagramNodeKind } from '@/lib/board/types';
import { addEdge, addNode, deleteEdge, deleteNode, labelEdge, linkNode, NODE_COLOUR, updateNode } from '@/lib/diagram/edit';
import { layoutDiagram, needsLayout } from '@/lib/diagram/layout';
import { EDGE_FONT, fitNodes, fitSize, LABEL_FONT, nodeLines, relabel } from '@/lib/diagram/size';
import { fitView, openView, toDiagram, ZOOM_STEP, zoomTo, type View } from '@/lib/diagram/zoom';
import { routeEdge } from '../cards/DiagramView';
import { KIND_LABEL } from '../logic/cards';
import type { BoardShell } from '../shell/extensions';
import { diagramHooks } from './hooks';
import './diagram.css';

type Tool = DiagramNodeKind | 'arrow';
type Selection = { kind: 'node' | 'edge'; id: string } | undefined;
interface Point { x: number; y: number }
interface Box { x: number; y: number; w: number; h: number }
type Gesture =
  | { kind: 'move'; id: string; start: Point; from: Point; moved: boolean }
  | { kind: 'arrow'; from: string; to: Point }
  | { kind: 'pan'; start: Point; from: Point };
interface Pinch { a: number; b: number; dist: number; mid: Point; view: View }

const TOOLS: { tool: Tool; label: string; icon?: ReactNode }[] = [
  { tool: 'step', label: 'Step', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3" /></svg> },
  { tool: 'choice', label: 'Choice', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 21 12 12 21 3 12z" /></svg> },
  { tool: 'end', label: 'Start or end', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="5" /></svg> },
  { tool: 'arrow', label: 'Arrow', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 12h15M14 7l5 5-5 5" /></svg> },
  { tool: 'text', label: 'Text' },
];

/** The step colours DiagramEdit offers, by their frame names. */
const STEP_COLOURS: { colour: CardColour; name: string; swatch: string }[] = [
  { colour: 'teal', name: 'Teal', swatch: 'teal' },
  { colour: 'yellow', name: 'Amber', swatch: 'amber' },
  { colour: 'rose', name: 'Red', swatch: 'red' },
  { colour: 'white', name: 'White', swatch: 'white' },
];

const AREA_FALLBACK = { w: 1200, h: 528 };

/** The board as it is now: `shell.board` can be a render behind, and a change that edits nothing only reads it. */
export function liveBoard(shell: BoardShell): Board {
  let board = shell.board;
  shell.api.change((b) => (board = b));
  return board;
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function DiagramEdit({ shell, cardId }: { shell: BoardShell; cardId: string }) {
  const [board] = useState(() => liveBoard(shell));
  const card = board.cards[cardId];
  const original = card?.kind === 'diagram' ? card.diagram : { nodes: [], edges: [] };
  const [draft, setDraft] = useState<Diagram>(() => fitNodes(needsLayout(original) ? layoutDiagram(original) : original));
  const [view, setView] = useState<View>(() => openView(draft, AREA_FALLBACK));
  const [tool, setTool] = useState<Tool | undefined>(original.nodes.length === 0 ? 'step' : undefined);
  const [selection, setSelection] = useState<Selection>();
  const [renaming, setRenaming] = useState<string>();
  const [labelling, setLabelling] = useState<string>();
  const [linkMenu, setLinkMenu] = useState(false);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const marker = `de-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const live = useRef({ draft, view });
  live.current = { draft, view };
  const space = useRef(false);
  const pinch = useRef<Pinch | null>(null);
  const touches = useRef(new Map<number, Point>());

  const areaSize = () => {
    const r = area.current?.getBoundingClientRect();
    return r && r.width > 0 ? { w: r.width, h: r.height } : AREA_FALLBACK;
  };
  useLayoutEffect(() => setView(openView(live.current.draft, areaSize())), []);
  const zoomBy = (factor: number, at?: Point) => {
    const size = areaSize();
    setView((v) => zoomTo(v, at ?? { x: size.w / 2, y: size.h / 2 }, v.zoom * factor));
  };
  const fit = () => setView(fitView(live.current.draft, areaSize()));

  const number = cardNumbers(board)[cardId] ?? (card ? undefined : listOrder(board).length + 1);
  const title = card?.title || KIND_LABEL.diagram;
  const describe = diagramHooks.describeChange;

  const screen = (n: Box): Box => ({ x: view.x + n.x * view.zoom, y: view.y + n.y * view.zoom, w: n.w * view.zoom, h: n.h * view.zoom });
  const toLocal = (clientX: number, clientY: number): Point => {
    const r = area.current?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  };
  const nodeAt = (p: Point): DiagramNode | undefined => {
    const { draft: d, view: v } = live.current;
    return [...d.nodes].reverse().find((n) => {
      const x = v.x + n.x * v.zoom, y = v.y + n.y * v.zoom;
      return p.x >= x && p.x <= x + n.w * v.zoom && p.y >= y && p.y <= y + n.h * v.zoom;
    });
  };

  const save = () => {
    const d = live.current.draft;
    if (d !== original) shell.api.change((b, now) => updateCard(b, cardId, now, (c) => (c.kind === 'diagram' ? { ...c, diagram: d } : c)));
  };
  const done = () => {
    save();
    shell.closeOverlay();
  };
  const describeChange = () => {
    if (!describe) return;
    save();
    shell.closeOverlay();
    describe(shell, cardId);
  };

  const removeSelected = () => {
    if (!selection) return;
    setDraft((d) => (selection.kind === 'node' ? deleteNode(d, selection.id) : deleteEdge(d, selection.id)));
    setSelection(undefined);
    setLinkMenu(false);
  };

  const liveKeys = useRef({ done, removeSelected, renaming, labelling, linkMenu });
  liveKeys.current = { done, removeSelected, renaming, labelling, linkMenu };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = liveKeys.current;
      if (isTyping(e.target) || k.renaming || k.labelling) return;
      if (e.key === ' ') {
        e.preventDefault();
        space.current = true;
        area.current?.setAttribute('data-space', '');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (k.linkMenu) setLinkMenu(false);
        else k.done();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        k.removeSelected();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      space.current = false;
      area.current?.removeAttribute('data-space');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const r = el.getBoundingClientRect();
      // Trackpad pinch arrives as a wheel with ctrlKey.
      if (e.ctrlKey || e.metaKey) setView((v) => zoomTo(v, { x: e.clientX - r.left, y: e.clientY - r.top }, v.zoom * Math.exp(-e.deltaY * unit * 0.01)));
      else setView((v) => ({ ...v, x: v.x - e.deltaX * unit, y: v.y - e.deltaY * unit }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const pinchFrom = (a: number, b: number): Pinch => {
    const p = touches.current.get(a)!, q = touches.current.get(b)!;
    return { a, b, dist: Math.max(1, Math.hypot(p.x - q.x, p.y - q.y)), mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, view: live.current.view };
  };
  const onTouchDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.set(e.pointerId, toLocal(e.clientX, e.clientY));
    if (touches.current.size !== 2) return;
    e.stopPropagation();
    const [a, b] = [...touches.current.keys()];
    pinch.current = pinchFrom(a!, b!);
    const onMove = (ev: PointerEvent) => {
      const g = pinch.current;
      if (!g || !touches.current.has(ev.pointerId)) return;
      touches.current.set(ev.pointerId, toLocal(ev.clientX, ev.clientY));
      const now = pinchFrom(g.a, g.b);
      const moved = zoomTo(g.view, g.mid, (g.view.zoom * now.dist) / g.dist);
      setView({ ...moved, x: moved.x + now.mid.x - g.mid.x, y: moved.y + now.mid.y - g.mid.y });
    };
    const onUp = (ev: PointerEvent) => {
      touches.current.delete(ev.pointerId);
      if (touches.current.size >= 2) return;
      pinch.current = null;
      touches.current.clear();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const pan = (e: ReactPointerEvent) => {
    track(
      { kind: 'pan', start: { x: live.current.view.x, y: live.current.view.y }, from: toLocal(e.clientX, e.clientY) },
      (g, q) => {
        if (g.kind === 'pan') setView((v) => ({ ...v, x: g.start.x + q.x - g.from.x, y: g.start.y + q.y - g.from.y }));
        return g;
      },
      () => undefined,
    );
  };

  const track = (start: Gesture, move: (g: Gesture, p: Point) => Gesture, up: (g: Gesture) => void) => {
    let current = start;
    setGesture(start);
    const onMove = (e: PointerEvent) => {
      if (pinch.current) return;
      current = move(current, toLocal(e.clientX, e.clientY));
      setGesture(current);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setGesture(null);
      up(current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const startArrow = (e: ReactPointerEvent, from: string) => {
    e.stopPropagation();
    e.preventDefault();
    track(
      { kind: 'arrow', from, to: toLocal(e.clientX, e.clientY) },
      (g, p) => (g.kind === 'arrow' ? { ...g, to: p } : g),
      (g) => {
        if (g.kind !== 'arrow') return;
        const target = nodeAt(g.to);
        if (!target || target.id === g.from) return;
        const id = newId();
        setDraft((d) => addEdge(d, { id, from: g.from, to: target.id }));
        setSelection({ kind: 'edge', id });
        setTool(undefined);
      },
    );
  };

  const onNodeDown = (e: ReactPointerEvent, node: DiagramNode) => {
    if (e.button !== 0 || renaming === node.id || pinch.current) return;
    setLinkMenu(false);
    if (space.current) {
      e.stopPropagation();
      e.preventDefault();
      return pan(e);
    }
    if (tool === 'arrow') return startArrow(e, node.id);
    e.stopPropagation();
    e.preventDefault();
    setSelection({ kind: 'node', id: node.id });
    const from = toLocal(e.clientX, e.clientY);
    track(
      { kind: 'move', id: node.id, start: { x: node.x, y: node.y }, from, moved: false },
      (g, p) => {
        if (g.kind !== 'move') return g;
        const dx = p.x - g.from.x, dy = p.y - g.from.y;
        const moved = g.moved || Math.hypot(dx, dy) > 3;
        if (moved) {
          const z = live.current.view.zoom;
          setDraft((d) => updateNode(d, g.id, { x: Math.round(g.start.x + dx / z), y: Math.round(g.start.y + dy / z) }));
        }
        return { ...g, moved };
      },
      () => undefined,
    );
  };

  const onAreaDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || pinch.current) return;
    if (e.target !== e.currentTarget && !space.current) return;
    setLinkMenu(false);
    const p = toLocal(e.clientX, e.clientY);
    if (tool && tool !== 'arrow' && !space.current) {
      // Keeps the browser from moving focus off the new step's name field.
      e.preventDefault();
      const label = TOOLS.find((t) => t.tool === tool)!.label;
      const { w, h } = fitSize(tool, label);
      const at = toDiagram(view, p);
      const node: DiagramNode = { id: newId(), kind: tool, label, x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h, colour: NODE_COLOUR[tool] };
      setDraft((d) => addNode(d, node));
      setSelection({ kind: 'node', id: node.id });
      setRenaming(node.id);
      setTool(undefined);
      return;
    }
    if (!space.current) setSelection(undefined);
    pan(e);
  };

  const byId = new Map(draft.nodes.map((n) => [n.id, n]));
  const selectedNode = selection?.kind === 'node' ? byId.get(selection.id) : undefined;
  const selBox = selectedNode ? screen(selectedNode) : undefined;
  const others = listOrder(board).filter((id) => id !== cardId && board.cards[id]);
  const numbers = cardNumbers(board);
  const arrowFrom = gesture?.kind === 'arrow' ? byId.get(gesture.from) : undefined;

  return (
    <div className="bk-de-scrim">
      <section role="dialog" aria-modal="true" aria-label={`Edit diagram: ${title}`} className="bk-de">
        <header className="bk-de-head">
          {number && <span className="bk-de-number">{number}</span>}
          <h2 className="bk-de-title">{title}</h2>
          <span className="bk-grow" />
          <div role="toolbar" aria-label="Diagram tools" className="bk-de-tools">
            {TOOLS.map((t) => (
              <button key={t.tool} type="button" aria-pressed={tool === t.tool} onClick={() => setTool((now) => (now === t.tool ? undefined : t.tool))}>
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <span className="bk-de-sep" aria-hidden="true" />
          <button type="button" className="bk-de-describe" disabled={!describe} onClick={describeChange}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /></svg>
            Describe a change
          </button>
          <button type="button" className="bk-de-done" onClick={done}>Done</button>
        </header>
        <div
          ref={area}
          className="bk-de-area"
          data-tool={tool ?? ''}
          onPointerDownCapture={onTouchDown}
          onPointerDown={onAreaDown}
        >
          <svg className="bk-de-edges" aria-hidden="true">
            <defs>
              <marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 10 5 0 10z" fill="var(--bk-text)" />
              </marker>
              <marker id={`${marker}-on`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 10 5 0 10z" fill="var(--bk-accent)" />
              </marker>
            </defs>
            {draft.edges.map((edge) => {
              const a = byId.get(edge.from), b = byId.get(edge.to);
              if (!a || !b) return null;
              const route = routeEdge(screen(a), screen(b));
              const on = selection?.kind === 'edge' && selection.id === edge.id;
              return (
                <g key={edge.id}>
                  <path
                    d={route.d}
                    className="bk-de-edge-hit"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelection({ kind: 'edge', id: edge.id });
                    }}
                    onDoubleClick={() => setLabelling(edge.id)}
                  />
                  <path d={route.d} fill="none" stroke={on ? 'var(--bk-accent)' : 'var(--bk-text)'} strokeWidth={on ? 2.2 : 1.6} markerEnd={`url(#${marker}${on ? '-on' : ''})`} />
                  {edge.label && labelling !== edge.id && route.label && (
                    <text x={route.label.x} y={route.label.y} textAnchor={route.label.anchor} fontSize={EDGE_FONT * view.zoom} fill="var(--bk-text-2)" fontFamily="var(--bk-font)">{edge.label}</text>
                  )}
                </g>
              );
            })}
            {arrowFrom && gesture?.kind === 'arrow' && (() => {
              const s = screen(arrowFrom);
              return <line className="bk-de-draft" x1={s.x + s.w / 2} y1={s.y + s.h / 2} x2={gesture.to.x} y2={gesture.to.y} />;
            })()}
          </svg>
          {draft.nodes.map((node) => (
            <NodeView
              key={node.id}
              node={node}
              box={screen(node)}
              zoom={view.zoom}
              selected={selectedNode?.id === node.id}
              renaming={renaming === node.id}
              onPointerDown={(e) => onNodeDown(e, node)}
              onRename={(label) => {
                setRenaming(undefined);
                const text = label.trim();
                if (text && text !== node.label) setDraft((d) => {
                  const { label: l, x, y, w, h } = relabel(node, text);
                  return updateNode(d, node.id, { label: l, x, y, w, h });
                });
              }}
              onStartRename={() => setRenaming(node.id)}
            />
          ))}
          {draft.edges.map((edge) => {
            if (labelling !== edge.id) return null;
            const a = byId.get(edge.from), b = byId.get(edge.to);
            const at = a && b ? routeEdge(screen(a), screen(b)).label : undefined;
            if (!at) return null;
            return (
              <InlineInput
                key={edge.id}
                className="bk-de-edge-input"
                label="Label"
                value={edge.label ?? ''}
                style={{ left: at.x, top: at.y }}
                onDone={(text) => {
                  setLabelling(undefined);
                  setDraft((d) => labelEdge(d, edge.id, text));
                }}
                onCancel={() => setLabelling(undefined)}
              />
            );
          })}
          {selectedNode && selBox && !gesture && renaming !== selectedNode.id && (
            <>
              {([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] as const).map(([fx, fy]) => (
                <span key={`${fx}-${fy}`} className="bk-de-dot" aria-hidden="true" style={{ left: selBox.x + selBox.w * fx, top: selBox.y + selBox.h * fy }} onPointerDown={(e) => startArrow(e, selectedNode.id)} />
              ))}
              <div role="group" aria-label={`Step: ${selectedNode.label}`} className="bk-de-bar" style={{ left: selBox.x + selBox.w / 2, top: selBox.y - 34 }} onPointerDown={(e) => e.stopPropagation()}>
                <span className="bk-swatches" role="radiogroup" aria-label="Colour">
                  {STEP_COLOURS.map(({ colour, name, swatch }) => (
                    <button key={colour} type="button" role="radio" aria-checked={selectedNode.colour === colour} aria-label={name} className={`bk-swatch bk-sw-${swatch}`} onClick={() => setDraft((d) => updateNode(d, selectedNode.id, { colour }))} />
                  ))}
                </span>
                <span className="bk-de-bar-wrap">
                  <button type="button" aria-expanded={linkMenu} aria-pressed={!!selectedNode.card} onClick={() => setLinkMenu((o) => !o)}>Link a card</button>
                  {linkMenu && (
                    <div className="bk-pop bk-de-links" role="menu" aria-label="Link a card">
                      {others.map((id) => {
                        const c = board.cards[id]!;
                        return (
                          <button
                            key={id}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={selectedNode.card === id}
                            onClick={() => {
                              setDraft((d) => linkNode(d, selectedNode.id, selectedNode.card === id ? undefined : id));
                              setLinkMenu(false);
                            }}
                          >
                            <span className="bk-badge">{numbers[id]}</span>
                            <span className="bk-de-link-title">{cardLabel(c)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </span>
                <button type="button" className="bk-de-bar-delete" aria-label="Delete step" onClick={removeSelected}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                </button>
              </div>
            </>
          )}
          <p className="bk-de-hint">Drag from a dot to draw an arrow. Double-click a step to rename it. Ctrl + scroll to zoom. Space + drag to move. Esc or Done goes back to the board.</p>
          <div role="group" aria-label="Zoom" className="bk-zoom bk-de-zoom" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
            <span className="bk-zoom-pc">{Math.round(view.zoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>+</button>
            <span className="bk-zoom-sep" aria-hidden="true" />
            <button type="button" className="bk-zoom-fit" onClick={fit}>Fit</button>
          </div>
        </div>
      </section>
    </div>
  );
}

interface NodeViewProps {
  node: DiagramNode;
  box: Box;
  zoom: number;
  selected: boolean;
  renaming: boolean;
  onPointerDown(e: ReactPointerEvent): void;
  onRename(label: string): void;
  onStartRename(): void;
}

function NodeView({ node, box, zoom, selected, renaming, onPointerDown, onRename, onStartRename }: NodeViewProps) {
  const style = {
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    fontSize: LABEL_FONT * zoom,
    '--n-fill': `var(--bk-d-${node.colour}-fill)`,
    '--n-line': `var(--bk-d-${node.colour}-line)`,
    '--n-ink': `var(--bk-d-${node.colour}-ink)`,
    borderRadius: node.kind === 'end' ? box.h / 2 : undefined,
  } as CSSProperties;
  return (
    <div
      className={`bk-de-node bk-de-${node.kind}${selected ? ' is-selected' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartRename();
      }}
    >
      {node.kind === 'choice' && (
        <svg className="bk-de-diamond" viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true">
          <path d={`M${box.w / 2} 2 ${box.w - 2} ${box.h / 2} ${box.w / 2} ${box.h - 2} 2 ${box.h / 2}z`} />
        </svg>
      )}
      {renaming ? (
        <InlineInput className="bk-de-rename" label="Step name" value={node.label} onDone={onRename} onCancel={() => onRename(node.label)} select />
      ) : (
        <span className="bk-de-label">
          {nodeLines(node).map((line, i) => (
            <span key={i} className="bk-de-line">{line}</span>
          ))}
          {node.card && (
            <svg className="bk-de-linked" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
          )}
        </span>
      )}
    </div>
  );
}

interface InlineInputProps { className: string; label: string; value: string; style?: CSSProperties; select?: boolean; onDone(value: string): void; onCancel(): void }

function InlineInput({ className, label, value: initial, style, select, onDone, onCancel }: InlineInputProps) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    if (select) ref.current?.select();
  }, [select]);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save) onDone(value);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      className={className}
      type="text"
      aria-label={label}
      value={value}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
    />
  );
}
