import { useEffect, useRef } from 'react';
import { setShape } from '@/lib/project/cuts';
import type { Project, Shape, VerticalFit } from '@/lib/project/types';
import { Seg } from '../timeline/controls';
import { C } from '../ui';

const SHAPES = (['16:9', '9:16', '1:1', '4:5'] as const).map((s) => ({ value: s, label: s }));
const FITS: { value: VerticalFit; name: string; hint: string }[] = [
  { value: 'stack', name: 'Screen over camera', hint: 'Screen on top, you below. Crop follows your cursor.' },
  { value: 'follow', name: 'Follow the cursor', hint: 'Full height crop that moves with clicks and zooms.' },
  { value: 'bars', name: 'Fit with bars', hint: 'The whole screen, smaller, on your background.' },
];

export interface ShapeMenuProps {
  shape: Shape;
  fit: VerticalFit;
  readOnly?: boolean;
  edit(op: (project: Project) => Project): void;
  onClose(): void;
}

/** AutoVertical: the shape of this cut and, for 9:16, how the screen fits. Opens from the aspect button. */
export function ShapeMenu({ shape, fit, readOnly = false, edit, onClose }: ShapeMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The aspect button toggles the menu itself.
      if (ref.current && !ref.current.contains(t) && !(t as Element).closest?.('[data-shape-button]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  return (
    <div ref={ref} role="dialog" aria-label="Shape" style={{ position: 'absolute', right: 12, bottom: 48, width: 276, zIndex: 20, padding: '12px 14px', borderRadius: 12, background: C.panel,
      border: `1px solid ${C.line}`, boxShadow: '0 18px 44px rgba(0,0,0,0.55)' }}>
      <ShapeSection shape={shape} fit={fit} readOnly={readOnly} edit={edit} />
    </div>
  );
}

export interface ShapeSectionProps {
  shape: Shape;
  fit: VerticalFit;
  readOnly?: boolean;
  edit(op: (project: Project) => Project): void;
}

/** The shape picker, the 9:16 fit cards and the safe-area note. Shared by the popover and the Layout tab. */
export function ShapeSection({ shape, fit, readOnly = false, edit }: ShapeSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 600, color: C.secondary }}>
        <span>Shape</span><span style={{ fontWeight: 400, color: C.muted }}>this cut</span>
      </div>
      <Seg label="Shape" options={SHAPES} value={shape} onChange={(s) => !readOnly && edit((p) => setShape(p, { shape: s }))} />
      {shape === '9:16' && (
        <>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.secondary }}>Fit the screen into 9:16</div>
          <div role="radiogroup" aria-label="Fit the screen into 9:16" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FITS.map((f) => {
              const on = f.value === fit;
              return (
                <button key={f.value} type="button" role="radio" aria-checked={on} disabled={readOnly} onClick={() => edit((p) => setShape(p, { shape, fit: f.value }))}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 9, background: C.raised, border: `1.5px solid ${on ? C.accentText : C.line}`,
                    color: C.text, fontFamily: 'inherit', textAlign: 'left', cursor: readOnly ? 'default' : 'pointer' }}>
                  <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${on ? C.accentText : C.muted}`, boxSizing: 'border-box', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.accentText }} />}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{f.name}</span>
                    <span style={{ fontSize: 11.5, color: C.muted }}>{f.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <p style={{ margin: 0, fontSize: 11.5, color: C.muted, lineHeight: 1.45 }}>Captions and cards move into the safe area for Shorts, Reels and TikTok.</p>
    </div>
  );
}
