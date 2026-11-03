import { memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type Ref } from 'react';
import type { Rect } from '../board/types';
import { arrowLine, visibleCards, worldRect, zoomAt, ZOOM_MAX, ZOOM_MIN, type Camera, type Size } from './geometry';

export interface CanvasItem { id: string; rect: Rect; z?: number }
export interface CanvasArrow { id: string; from: string; to: string; dashed?: boolean }

export interface CanvasHandle {
  camera(): Camera;
  setCamera(camera: Camera): void;
  size(): Size;
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
  ref?: Ref<CanvasHandle>;
  className?: string;
  style?: CSSProperties;
}

const ROOT: CSSProperties = { position: 'relative', overflow: 'hidden', touchAction: 'none', userSelect: 'none', cursor: 'grab' };
const LAYER: CSSProperties = { position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', willChange: 'transform' };
const ARROWS: CSSProperties = { position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' };
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

/** Pannable, zoomable board: items on one transformed layer, arrows in one SVG, full content only in view. */
export function Canvas<T extends CanvasItem>(props: CanvasProps<T>) {
  const { items, arrows = [], renderItem, renderPlaceholder = defaultPlaceholder, minZoom = ZOOM_MIN, maxZoom = ZOOM_MAX, margin = 200, onCameraChange } = props;
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
      refreshVisible();
      onChange.current?.(next);
    },
    [refreshVisible],
  );

  useImperativeHandle(props.ref, () => ({ camera: () => camera.current, setCamera: apply, size: () => size.current }), [apply]);

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
    if ((event.target as Element).closest('[data-canvas-item]')) return;
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
        return a && b ? [{ ...arrow, ...arrowLine(a, b) }] : [];
      }),
    [arrows, byId],
  );

  return (
    <div ref={root} className={props.className} style={{ ...ROOT, ...props.style }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div ref={layer} style={LAYER}>
        <svg style={ARROWS} aria-hidden="true">
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--canvas-arrow, #6b7280)" />
            </marker>
          </defs>
          {lines.map((line) => (
            <line key={line.id} x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} stroke="var(--canvas-arrow, #6b7280)" strokeWidth={2} strokeDasharray={line.dashed ? '6 5' : undefined} markerEnd={`url(#${markerId})`} />
          ))}
        </svg>
        {items.map((item) => (
          <Item key={item.id} item={item} full={visible.has(item.id)} render={renderItem} placeholder={renderPlaceholder} />
        ))}
      </div>
    </div>
  );
}
