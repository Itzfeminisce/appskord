import type { PointerEvent as ReactPointerEvent } from 'react';
import { clock } from '../format';
import { C, MONO } from '../ui';
import type { CutChapter } from './chapters';
import { HEAD_PX, inView, ticks, xOf, type View } from './geometry';

export interface RulerProps {
  view: View;
  width: number;
  chapters: CutChapter[];
  /** While a flag is dragged: its index and where it shows. */
  dragging?: { index: number; at: number } | null;
  onScrub(e: ReactPointerEvent): void;
  onFlag(e: ReactPointerEvent, chapter: CutChapter): void;
}

/** Ruler with time labels and chapter flags (click → ChaptersEdit, drag → move). */
export function Ruler({ view, width, chapters, dragging, onScrub, onFlag }: RulerProps) {
  return (
    <div style={{ display: 'flex', height: 22, flexShrink: 0, borderBottom: `1px solid ${C.line}` }}>
      <div style={{ width: HEAD_PX, flexShrink: 0, background: C.panel }} />
      <div data-ruler style={{ flexGrow: 1, position: 'relative', overflow: 'hidden', cursor: 'text' }} onPointerDown={(e) => { if (e.button === 0) onScrub(e); }}>
        {ticks(view, width).map((t) => (
          <span key={t} style={{ position: 'absolute', left: xOf(t, view, width), top: 0, bottom: 0, borderLeft: `1px solid ${C.line}`, paddingLeft: 4, fontFamily: MONO, fontSize: 10, color: C.muted, lineHeight: '20px', pointerEvents: 'none' }}>{clock(t)}</span>
        ))}
        {chapters.map((c) => {
          const at = dragging?.index === c.index ? dragging.at : c.at;
          if (!inView(at, at + 1, view)) return null;
          return (
            <span key={c.index} role="button" tabIndex={-1} title={`Chapter: ${c.title}`} data-chapter={c.index}
              onPointerDown={(e) => { e.stopPropagation(); if (e.button === 0) onFlag(e, c); }}
              style={{ position: 'absolute', left: xOf(at, view, width), top: 2, display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: C.accentText, transform: 'translateX(6px)', cursor: 'grab', whiteSpace: 'nowrap', background: C.ground, paddingRight: 2, touchAction: 'none' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.accentText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 22V4" /><path d="M4 4h13l-2 4 2 4H4" /></svg>
              <span>{c.title}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
