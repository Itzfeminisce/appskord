/** The map of the board (bottom right): every card as a block and the part in view as a frame; a click moves the view there. */
import { memo, useEffect, useMemo, useRef, type PointerEvent, type RefObject } from 'react';
import type { Card } from '@/lib/board/types';
import { boundsOf, worldRect, type Camera, type CanvasHandle } from '@/lib/canvas';

const W = 150, H = 92, PAD = 8;

const FILL = { white: 'var(--bk-map-card)', yellow: 'var(--bk-map-yellow)', teal: 'var(--bk-map-teal)', blue: 'var(--bk-blue-line)', rose: 'var(--bk-rose-line)' } as const;
const fill = (card: Card) => (card.kind === 'diagram' ? FILL.teal : FILL[card.colour]);

export const Minimap = memo(function Minimap({ cards, canvasRef, register }: { cards: Record<string, Card>; canvasRef: RefObject<CanvasHandle | null>; register(update: (camera: Camera) => void): void }) {
  const view = useRef<HTMLSpanElement>(null);
  const list = useMemo(() => Object.values(cards), [cards]);
  const map = useMemo(() => {
    const b = boundsOf(list.map((c) => c.rect)) ?? { x: 0, y: 0, w: 1, h: 1 };
    const scale = Math.min((W - PAD * 2) / b.w, (H - PAD * 2) / b.h);
    return { scale, x: (W - b.w * scale) / 2 - b.x * scale, y: (H - b.h * scale) / 2 - b.y * scale };
  }, [list]);
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    const update = (cam: Camera) => {
      const el = view.current, c = canvasRef.current;
      if (!el || !c) return;
      const m = mapRef.current;
      const r = worldRect(cam, c.size());
      const x1 = Math.max(1, r.x * m.scale + m.x), y1 = Math.max(1, r.y * m.scale + m.y);
      const x2 = Math.min(W - 1, (r.x + r.w) * m.scale + m.x), y2 = Math.min(H - 1, (r.y + r.h) * m.scale + m.y);
      el.style.cssText = `left:${x1}px;top:${y1}px;width:${Math.max(0, x2 - x1)}px;height:${Math.max(0, y2 - y1)}px`;
    };
    register(update);
    const c = canvasRef.current;
    if (c) update(c.camera());
  }, [register, canvasRef, map]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const c = canvasRef.current;
    if (!c) return;
    const go = (clientX: number, clientY: number) => {
      const box = e.currentTarget.getBoundingClientRect();
      const m = mapRef.current;
      const wx = (clientX - box.left - m.x) / m.scale, wy = (clientY - box.top - m.y) / m.scale;
      const cam = c.camera(), size = c.size();
      c.setCamera({ ...cam, x: size.w / 2 - wx * cam.zoom, y: size.h / 2 - wy * cam.zoom });
    };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    go(e.clientX, e.clientY);
    const move = (ev: globalThis.PointerEvent) => go(ev.clientX, ev.clientY);
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  return (
    <div role="img" aria-label="Map of the board" className="bk-map" onPointerDown={onDown}>
      {list.map((c) => (
        <span key={c.id} className="bk-map-card" style={{ left: c.rect.x * map.scale + map.x, top: c.rect.y * map.scale + map.y, width: Math.max(2, c.rect.w * map.scale), height: Math.max(2, c.rect.h * map.scale), background: fill(c) }} />
      ))}
      <span ref={view} className="bk-map-view" />
    </div>
  );
});
