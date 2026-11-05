import { memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type Ref } from 'react';
import type { Rect } from '../board/types';
import { arrowPath, visibleCards, worldRect, zoomAt, ZOOM_MAX, ZOOM_MIN, type Camera, type Point, type Size } from './geometry';

export interface CanvasItem { id: string; rect: Rect; z?: number }
export interface CanvasArrow { id: string; from: string; to: string; dashed?: boolean; both?: boolean }

export interface CanvasHandle {
  camera(): Camera;
  setCamera(camera: Camera): void;
  size(): Size;
  /** The world point under a screen (client) point. */
  toWorld(clientX: number, clientY: number): Point;
}

export interface CanvasProps<T extends CanvasItem> {
  items: readonly T[];
  arrows?: readonly CanvasArrow[];
  /** Full content of an item in view. Keep it stable (useCallback): items re-render when it changes. */
  renderItem: (item: T) => ReactNode;
  /** Content of an item out of view; a light box by default. */
  renderPlaceholder?: (item: T) => ReactNode;
  initialCamera?: Camera;
  minZoom?: number;
  maxZoom?: number;
  /** Screen pixels around the view whose items also get full content. */
  margin?: number;
  onCameraChange?: (camera: Camera) => void;
  /** A press on empty canvas; return true to take the gesture (e.g. a marquee) instead of panning. */
  onBackgroundPointerDown?: (event: PointerEvent<HTMLDivElement>, at: Point) => boolean;
  /** Pan from anywhere, items included (Space held). */
  panAnywhere?: boolean;
  /** Called with an arrow's id when it is pressed. */
  onArrowPointerDown?: (id: string, event: PointerEvent<SVGPathElement>) => void;
  selectedArrows?: ReadonlySet<string>;
  /** World-space content under the items (groups) and over them (handles, marquee, drafts). */
  underlay?: ReactNode;
  overlay?: ReactNode;
  ref?: Ref<CanvasHandle>;
  className?: string;
  style?: CSSProperties;
  cursor?: string;
}

const ROOT: CSSProperties = { position: 'relative', overflow: 'hidden', touchAction: 'none', userSelect: 'none' };
const LAYER: CSSProperties = { position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', willChange: 'transform' };
const ARROWS: CSSProperties = { position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' };
const OVER: CSSProperties = { position: 'absolute', left: 0, top: 0, zIndex: 2147483000 };
const PLACEHOLDER: CSSProperties = { width: '100%', height: '100%', borderRadius: 8, background: 'var(--canvas-placeholder, rgba(127, 127, 127, 0.12))' };

const defaultPlaceholder = (): ReactNode => <div style={PLACEHOLDER} />;

interface ItemProps<T extends CanvasItem> { item: T; full: boolean; render: (item: T) => ReactNode; placeholder: (item: T) => ReactNode }

const Item = memo(function Item<T extends CanvasItem>({ item, full, render, placeholder }: ItemProps<T>) {
  const { x, y, w, h } = item.rect;
  return (
    <div data-canvas-item={item.id} data-full={full || undefined} style={{ position: 'absolute', left: x, top: y, width: w, height: h, zIndex: item.z }}>
      {full ? render(item) : placeholder(item)}
    </div>
  );
}) as <T extends CanvasItem>(props: ItemProps<T>) => ReactNode;

const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((id) => b.has(id));

/** Pannable, zoomable board: items on one transformed layer, arrows in one SVG above them, full content only in view. */
export function Canvas<T extends CanvasItem>(props: CanvasProps<T>) {
  const { items, arrows = [], renderItem, renderPlaceholder = defaultPlaceholder, minZoom = ZOOM_MIN, maxZoom = ZOOM_MAX, margin = 200, onCameraChange, cursor = 'grab' } = props;
  const markerId = `canvas-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const root = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const camera = useRef<Camera>(props.initialCamera ?? { x: 0, y: 0, zoom: 1 });
  const size = useRef<Size>({ w: 0, h: 0 });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const visibleRef = useRef(visible);
  const onChange = useRef(onCameraChange);
  onChange.current = onCameraChange;

  const refreshVisible = useCallback(() => {
    const next = visibleCards(itemsRef.current, worldRect(camera.current, size.current), camera.current.zoom, margin);
    if (!sameSet(next, visibleRef.current)) {
      visibleRef.current = next;
      setVisible(next);
    }
  }, [margin]);

  // Moves the layer directly; React only re-renders when the set of items in view changes.
  const apply = useCallback(
    (next: Camera) => {
      camera.current = next;
      if (layer.current) layer.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
      if (root.current) root.current.style.backgroundPosition = `${next.x}px ${next.y}px`;
      refreshVisible();
      onChange.current?.(next);
    },
    [refreshVisible],
  );

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const box = root.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const cam = camera.current;
    return { x: (clientX - box.left - cam.x) / cam.zoom, y: (clientY - box.top - cam.y) / cam.zoom };
  }, []);

  useImperativeHandle(props.ref, () => ({ camera: () => camera.current, setCamera: apply, size: () => size.current, toWorld }), [apply, toWorld]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
      refreshVisible();
    };
    measure();
    apply(camera.current);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [apply, refreshVisible]);

  useEffect(() => refreshVisible(), [items, refreshVisible]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.current.h : 1;
      const cam = camera.current;
      if (event.ctrlKey || event.metaKey) {
        const box = el.getBoundingClientRect();
        apply(zoomAt(cam, { x: event.clientX - box.left, y: event.clientY - box.top }, Math.exp(-event.deltaY * unit * 0.01), minZoom, maxZoom));
      } else {
        apply({ ...cam, x: cam.x - event.deltaX * unit, y: cam.y - event.deltaY * unit });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [apply, minZoom, maxZoom]);

  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const pan = props.panAnywhere || event.button === 1;
    if (!pan) {
      const target = event.target as Element;
      if (target.closest('[data-canvas-item], [data-canvas-control]')) return;
      if (props.onBackgroundPointerDown?.(event, toWorld(event.clientX, event.clientY))) return;
    }
    event.preventDefault();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.style.cursor = 'grabbing';
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const cam = camera.current;
    apply({ ...cam, x: cam.x + event.clientX - d.x, y: cam.y + event.clientY - d.y });
    d.x = event.clientX;
    d.y = event.clientY;
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.style.cursor = '';
  };

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item.rect])), [items]);
  const lines = useMemo(
    () =>
      arrows.flatMap((arrow) => {
        const a = byId.get(arrow.from), b = byId.get(arrow.to);
        return a && b ? [{ ...arrow, d: arrowPath(a, b) }] : [];
      }),
    [arrows, byId],
  );
  // Arrows sit above every card so a line that crosses another card stays readable.
  const topZ = useMemo(() => items.reduce((z, item) => Math.max(z, item.z ?? 0), 0), [items]);
  const onArrow = props.onArrowPointerDown;
  const selected = props.selectedArrows;

  return (
    <div ref={root} className={props.className} style={{ ...ROOT, cursor: props.panAnywhere ? 'grab' : cursor, ...props.style }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div ref={layer} style={LAYER}>
        {props.underlay}
        {items.map((item) => (
          <Item key={item.id} item={item} full={visible.has(item.id)} render={renderItem} placeholder={renderPlaceholder} />
        ))}
        <svg style={{ ...ARROWS, zIndex: topZ + 1 }} aria-hidden="true">
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--canvas-arrow, #6b7280)" />
            </marker>
            <marker id={`${markerId}-on`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--canvas-arrow-selected, #0F766E)" />
            </marker>
          </defs>
          {lines.map((line) => {
            const on = selected?.has(line.id);
            return (
              <g key={line.id}>
                {onArrow && (
                  <path d={line.d} data-canvas-control="" stroke="transparent" strokeWidth={14} fill="none" style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onPointerDown={(e) => onArrow(line.id, e)} />
                )}
                <path d={line.d} fill="none" stroke="var(--canvas-arrow-halo, #ffffff)" strokeWidth={on ? 6 : 5} strokeLinecap="round" opacity={0.85} />
                <path d={line.d} fill="none" stroke={on ? 'var(--canvas-arrow-selected, #0F766E)' : 'var(--canvas-arrow, #6b7280)'} strokeWidth={on ? 2.2 : 1.5} strokeDasharray={line.dashed ? '5 4' : undefined} markerEnd={`url(#${markerId}${on ? '-on' : ''})`} markerStart={line.both ? `url(#${markerId}${on ? '-on' : ''})` : undefined} />
              </g>
            );
          })}
        </svg>
        {props.overlay && <div style={OVER}>{props.overlay}</div>}
      </div>
    </div>
  );
}
