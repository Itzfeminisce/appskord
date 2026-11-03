/** DiagramEdit: a diagram card opened over the board. Edits stay in a draft; Done saves them as one undo step. */
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cardNumbers, listOrder, newId, updateCard } from '@/lib/board/ops';
import type { Board, CardColour, Diagram, DiagramNode, DiagramNodeKind } from '@/lib/board/types';
import { addEdge, addNode, deleteEdge, deleteNode, labelEdge, linkNode, NODE_COLOUR, NODE_SIZE, updateNode } from '@/lib/diagram/edit';
import { layoutDiagram, needsLayout } from '@/lib/diagram/layout';
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
const MARGIN = { x: 76, y: 92 };

/** The board as it is now: `shell.board` can be a render behind, and a change that edits nothing only reads it. */
export function liveBoard(shell: BoardShell): Board {
  let board = shell.board;
  shell.api.change((b) => (board = b));
  return board;
}

/** Diagram units to screen pixels: big enough to read, the whole diagram in view when it fits. */
function initialView(diagram: Diagram, area: { w: number; h: number }) {
  if (diagram.nodes.length === 0) return { zoom: 1, x: 0, y: 0 };
  const x0 = Math.min(...diagram.nodes.map((n) => n.x)), y0 = Math.min(...diagram.nodes.map((n) => n.y));
  const w = Math.max(...diagram.nodes.map((n) => n.x + n.w)) - x0, h = Math.max(...diagram.nodes.map((n) => n.y + n.h)) - y0;
  const zoom = Math.min(2, Math.max(0.5, Math.min((area.w - 2 * MARGIN.x) / Math.max(w, 1), (area.h - MARGIN.y - 60) / Math.max(h, 1))));
  return { zoom, x: MARGIN.x - x0 * zoom, y: MARGIN.y - y0 * zoom };
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function DiagramEdit({ shell, cardId }: { shell: BoardShell; cardId: string }) {
  const [board] = useState(() => liveBoard(shell));
  const card = board.cards[cardId];
  const original = card?.kind === 'diagram' ? card.diagram : { nodes: [], edges: [] };
  const [draft, setDraft] = useState<Diagram>(() => (needsLayout(original) ? layoutDiagram(original) : original));
  const [view, setView] = useState(() => initialView(draft, AREA_FALLBACK));
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

  const number = cardNumbers(board)[cardId] ?? (card ? undefined : listOrder(board).length + 1);
  const title = card?.title || KIND_LABEL.diagram;
  const describe = diagramHooks.describeChange;

  const screen = (n: Box): Box => ({ x: view.x + n.x * view.zoom, y: view.y + n.y * view.zoom, w: n.w * view.zoom, h: n.h * view.zoom });
  const toLocal = (clientX: number, clientY: number): Point => {
    const r = area.current?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  };
  const toData = (p: Point): Point => ({ x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom });
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
      if (e.key === 'Escape') {
        e.preventDefault();
        if (k.linkMenu) setLinkMenu(false);
        else k.done();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        k.removeSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const track = (start: Gesture, move: (g: Gesture, p: Point) => Gesture, up: (g: Gesture) => void) => {
    let current = start;
    setGesture(start);
    const onMove = (e: PointerEvent) => {
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
    if (e.button !== 0 || renaming === node.id) return;
    setLinkMenu(false);
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
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    setLinkMenu(false);
    const p = toLocal(e.clientX, e.clientY);
    if (tool && tool !== 'arrow') {
      // Keeps the browser from moving focus off the new step's name field.
      e.preventDefault();
      const size = NODE_SIZE[tool];
      const at = toData(p);
      const w = Math.round(size.w / view.zoom), h = Math.round(size.h / view.zoom);
      const node: DiagramNode = { id: newId(), kind: tool, label: TOOLS.find((t) => t.tool === tool)!.label, x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h, colour: NODE_COLOUR[tool] };
      setDraft((d) => addNode(d, node));
      setSelection({ kind: 'node', id: node.id });
      setRenaming(node.id);
      setTool(undefined);
      return;
    }
    setSelection(undefined);
    track(
      { kind: 'pan', start: { x: view.x, y: view.y }, from: p },
      (g, q) => {
        if (g.kind === 'pan') setView((v) => ({ ...v, x: g.start.x + q.x - g.from.x, y: g.start.y + q.y - g.from.y }));
        return g;
      },
      () => undefined,
    );
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
          onPointerDown={onAreaDown}
          onWheel={(e) => setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))}
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
                    <text x={route.label.x} y={route.label.y} textAnchor={route.label.anchor} fontSize={13} fill="var(--bk-text-2)" fontFamily="var(--bk-font)">{edge.label}</text>
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
              selected={selectedNode?.id === node.id}
              renaming={renaming === node.id}
              onPointerDown={(e) => onNodeDown(e, node)}
              onRename={(label) => {
                setRenaming(undefined);
                if (label.trim()) setDraft((d) => updateNode(d, node.id, { label: label.trim() }));
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
                            <span className="bk-de-link-title">{c.title || KIND_LABEL[c.kind]}</span>
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
          <p className="bk-de-hint">Drag from a dot to draw an arrow. Double-click a step to rename it. Esc or Done goes back to the board.</p>
        </div>
      </section>
    </div>
  );
}

interface NodeViewProps {
  node: DiagramNode;
  box: Box;
  selected: boolean;
  renaming: boolean;
  onPointerDown(e: ReactPointerEvent): void;
  onRename(label: string): void;
  onStartRename(): void;
}

function NodeView({ node, box, selected, renaming, onPointerDown, onRename, onStartRename }: NodeViewProps) {
  const style = {
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
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
          {node.label}
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
