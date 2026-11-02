import { useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Box, EventsTrack } from '@/lib/project/types';
import { box as newBox, overlayBox } from '@/lib/render/layers/geometry';
import { FRAME, renderPlan } from '@/lib/render/plan';
import type { SlotProps } from '../components/slots';
import { subscribeTimeline, timelineState } from '../timeline/store';
import { C } from '../ui';
import { changeOverlay, dragBox, toPicture } from './model';
import { OVERLAY_NAMES } from './store';

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
interface Drag { handle: Handle; x: number; y: number; dx: number; dy: number }

const CORNERS: [Exclude<Handle, 'move'>, CSSProperties][] = [
  ['nw', { left: -4, top: -4, cursor: 'nwse-resize' }], ['ne', { right: -4, top: -4, cursor: 'nesw-resize' }],
  ['sw', { left: -4, bottom: -4, cursor: 'nesw-resize' }], ['se', { right: -4, bottom: -4, cursor: 'nwse-resize' }],
];

/** The selected overlay's box on the preview (Overlays frame): drag to move, corners to resize; one Undo step per drag. */
export function OverlayHandles(p: SlotProps & { events?: EventsTrack }) {
  const selected = useSyncExternalStore(subscribeTimeline, () => timelineState().selected);
  const id = selected?.kind === 'overlays' && selected.ids.length === 1 ? selected.ids[0] : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const plan = useMemo(() => (id ? renderPlan(p.project, p.cut, p.out, p.events) : null), [id, p.project, p.cut, p.out, p.events]);
  const shown = plan?.overlays.find((o) => o.id === id);
  const stored = p.cut.overlays.find((o) => o.id === id);
  const screen = plan?.screen;
  if (!shown || !stored || !screen || p.playing) return null;

  const frame = FRAME[p.cut.shape];
  // Live drags move the frame box; the stored box changes once, on release.
  const toFrame = (d: Drag): { dx: number; dy: number } => {
    const r = ref.current?.getBoundingClientRect();
    return { dx: r?.width ? (d.dx / r.width) * frame.w : 0, dy: r?.height ? (d.dy / r.height) * frame.h : 0 };
  };
  const at = overlayBox(shown.box, screen, newBox());
  let b: Box = at;
  if (drag) {
    const { dx, dy } = toFrame(drag);
    b = dragBox(at, drag.handle, dx, dy);
  }
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  const down = (handle: Handle) => (e: ReactPointerEvent) => {
    if (p.readOnly || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ handle, x: e.clientX, y: e.clientY, dx: 0, dy: 0 });
  };
  const move = (e: ReactPointerEvent) => {
    if (drag) setDrag({ ...drag, dx: e.clientX - drag.x, dy: e.clientY - drag.y });
  };
  const up = () => {
    if (!drag) return;
    setDrag(null);
    if (drag.dx === 0 && drag.dy === 0) return;
    const f = toFrame(drag);
    const { dx, dy } = toPicture(f.dx, f.dy, screen.crop, screen.dest);
    const next = dragBox(stored.box, drag.handle, dx, dy);
    p.edit((q) => changeOverlay(q, stored.id, { box: next }));
  };
  const follows = shown.kind === 'blur' && !!shown.blur?.follow;

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div data-overlay-box={shown.id} onPointerDown={down('move')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}
        style={{ position: 'absolute', left: pct(b.x, frame.w), top: pct(b.y, frame.h), width: pct(b.w, frame.w), height: pct(b.h, frame.h),
          border: '1.5px solid #FFFFFF', outline: `1px dashed ${C.accent}`, boxSizing: 'border-box', cursor: p.readOnly ? 'default' : 'move', pointerEvents: 'auto', touchAction: 'none' }}>
        {CORNERS.map(([h, style]) => (
          <span key={h} data-handle={h} onPointerDown={down(h)} onPointerMove={move} onPointerUp={up}
            style={{ position: 'absolute', width: 8, height: 8, background: '#FFFFFF', border: `1px solid ${C.accent}`, ...style }} />
        ))}
        <span style={{ position: 'absolute', left: 0, top: -22, padding: '2px 6px', borderRadius: 4, background: C.accent, color: '#FFFFFF', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {follows ? 'Blur · follows the page' : OVERLAY_NAMES[shown.kind]}
        </span>
      </div>
    </div>
  );
}
