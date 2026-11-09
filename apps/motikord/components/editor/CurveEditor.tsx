import { useRef, useState, type PointerEvent } from 'react';
import type { Curve } from '@appskord/motion/types';
import { bounceFor, curveAria, curveLabel, curvePath, CUSTOM_CURVE, dragHandle, EDITOR_BOX, handles, snapToFeel, springPeak, toBox } from './curves';
import { C, Segmented } from './ui';

// EditorMotion's curve box (CurveLabelsV3): the selected layer's easing curve, labelled by its shape. A bezier's two
// handles drag and snap to a feel's curve; a spring's dot drags its bounce; any other shape offers "Reset to {feel}".

const W = 266;
const H = 64;

export function CurveEditor({ curve, onKind, onCommit, reset }: {
  curve: Curve;
  onKind: (kind: 'curve' | 'spring') => void;
  onCommit: (curve: Curve) => void;
  /** "Reset to {feel}" for a custom curve: the feel's name and what it does. */
  reset?: { name: string; onReset: () => void };
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [held, setHeld] = useState<0 | 1 | 'dot'>();
  // The dragged curve lives here while the pointer is held; one change is committed on release.
  const [drag, setDrag] = useState<Curve>();
  const b = EDITOR_BOX;
  const shown = drag ?? curve;
  const bezier = shown.kind === 'bezier' ? shown : undefined;
  const spring = shown.kind === 'spring' ? shown : undefined;
  const label = curveLabel(shown);
  const custom = label === CUSTOM_CURVE;
  const at = (e: PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return undefined;
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (held === undefined) return;
    const p = at(e);
    if (!p) return;
    if (held === 'dot' && spring) setDrag({ ...spring, bounce: bounceFor(spring, 1 - (p.y - b.top) / b.height) });
    else if (held !== 'dot' && bezier) setDrag(snapToFeel(dragHandle(bezier, held, p, b)));
  };
  const release = () => {
    if (drag && JSON.stringify(drag) !== JSON.stringify(curve)) onCommit(drag);
    setDrag(undefined);
    setHeld(undefined);
  };
  const start = toBox(b, 0, 0);
  const end = toBox(b, 1, 1);
  const hs = bezier ? handles(bezier, b) : undefined;
  const peak = spring ? springPeak(spring) : undefined;
  const dot = peak ? toBox(b, peak[0], peak[1]) : undefined;
  return (
    <div style={{ position: 'relative', userSelect: 'none', height: custom && reset ? 112 : 86, border: '1px solid #E8E8EB', borderRadius: 10, background: '#FAFAFB', overflow: 'hidden', flexShrink: 0 }}>
      <span style={{ position: 'absolute', left: 10, top: 9, fontFamily: C.mono, fontSize: 10, color: '#6E7079' }}>{label}</span>
      <span style={{ position: 'absolute', right: 6, top: 5, width: 112 }}>
        <Segmented small name="Curve or spring" options={[['curve', 'Curve'], ['spring', 'Spring']] as const} value={bezier ? 'curve' : 'spring'} onChange={onKind} />
      </span>
      <svg ref={svg} role="img" aria-label={curveAria(shown)} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        onPointerMove={move} onPointerUp={release} onPointerCancel={release}
        style={{ position: 'absolute', left: 0, top: 22, overflow: 'visible', touchAction: 'none' }}>
        <path d={`M${b.left} ${b.top + b.height}h${b.width}M${b.left} ${b.top - 2}h${b.width}`} stroke="#EDEDF0" strokeWidth="1" />
        {hs && <path d={`M${start.x} ${start.y} L${hs[0].x} ${hs[0].y}M${end.x} ${end.y} L${hs[1].x} ${hs[1].y}`} stroke="#F9A8D4" strokeWidth="1.2" />}
        <path data-curve d={curvePath(shown, b)} fill="none" stroke="#BE185D" strokeWidth="2" strokeLinecap="round" />
        {hs?.map((h, i) => (
          <circle key={i} data-handle={i} cx={h.x} cy={h.y} r="5" fill="#FFFFFF" stroke="#BE185D" strokeWidth="2" style={{ cursor: 'grab' }}
            onPointerDown={(e) => { svg.current?.setPointerCapture?.(e.pointerId); setHeld(i as 0 | 1); }} />
        ))}
        {dot && (
          <circle data-dot cx={dot.x} cy={dot.y} r="5" fill="#FFFFFF" stroke="#BE185D" strokeWidth="2" style={{ cursor: 'grab' }}
            onPointerDown={(e) => { svg.current?.setPointerCapture?.(e.pointerId); setHeld('dot'); }} />
        )}
        <circle cx={start.x} cy={start.y} r="2.5" fill="#BE185D" />
        <circle cx={end.x} cy={end.y} r="2.5" fill="#BE185D" />
      </svg>
      {custom && reset && (
        <button type="button" onClick={reset.onReset}
          style={{ position: 'absolute', left: 10, bottom: 6, height: 22, padding: '0 8px', border: '1px solid #E0E0E4', borderRadius: 6, background: '#FFFFFF', font: `11px/1 ${C.font}`, color: '#111114', cursor: 'pointer' }}>
          {`Reset to ${reset.name}`}
        </button>
      )}
    </div>
  );
}
