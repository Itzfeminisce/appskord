import { useEffect, useLayoutEffect, useState } from 'react';
import { C, MONO } from '../ui';

export interface Tip {
  id: 'transcript' | 'timeline' | 'ask' | 'export';
  /** What the tip points at; a tip whose target is missing is skipped. */
  target: string;
  title?: string;
  body?: string;
  place: 'right' | 'above' | 'below';
}

/** FirstRunTour, in order: transcript, timeline, Ask AI, Export. Ask AI and Export have no copy in the frame yet, so they are skipped. */
export const TIPS: Tip[] = [
  { id: 'transcript', target: 'section[aria-label="Transcript"]', place: 'right', title: 'Edit like a document', body: 'Select words and press Delete. The video follows. Click a word to jump there.' },
  { id: 'timeline', target: 'section[aria-label="Timeline"]', place: 'above', title: 'Fine-tune on the timeline', body: 'Zooms, text and music are blocks. Drag, stretch or delete them. Press ? for every shortcut.' },
  { id: 'ask', target: '[data-tour="ask-ai"]', place: 'below' },
  { id: 'export', target: '[data-tour="export"]', place: 'below' },
];

/** The tips that can show now, in tour order: their copy exists and `has(target)` finds what they point at. */
export const tourTips = (tips: readonly Tip[], has: (selector: string) => boolean): Tip[] => tips.filter((t) => t.title && t.body && has(t.target));

const has = (selector: string) => !!document.querySelector(selector);

/** FirstRunTour: four tips in order, "Skip the tour", "Next". `onDone` turns it off for this project. */
export function FirstRunTour({ onDone }: { onDone: () => void }) {
  const [tips] = useState(() => tourTips(TIPS, has));
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tip = tips[step];
  useLayoutEffect(() => {
    if (!tip) return;
    const measure = () => setRect(document.querySelector(tip.target)?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [tip]);
  useEffect(() => { if (!tip) onDone(); }, [tip, onDone]);
  if (!tip || !rect) return null;
  const last = step === tips.length - 1;
  const card = tip.place === 'right'
    ? { left: rect.right + 10, top: rect.top + 62 }
    : tip.place === 'above'
      ? { left: rect.left + 338, bottom: window.innerHeight - rect.top + 18 }
      : { left: Math.max(8, rect.right - 280), top: rect.bottom + 12 };
  return (
    <>
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 18, background: 'rgba(5,5,7,0.45)', pointerEvents: 'none' }} />
      <div aria-hidden="true" style={{ position: 'fixed', zIndex: 18, left: rect.left, top: rect.top, width: rect.width, height: rect.height, boxShadow: `0 0 0 2px ${C.accentText} inset`, pointerEvents: 'none' }} />
      <div role="dialog" aria-label={tip.title} style={{ position: 'fixed', zIndex: 19, width: tip.place === 'right' ? 250 : 280, borderRadius: 12, background: C.text, color: C.ground, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 18px 44px rgba(0,0,0,0.55)', ...card }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: '#52525B' }}>{`${step + 1} of ${tips.length}`}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{tip.title}</span>
        <span style={{ fontSize: 12.5, lineHeight: 1.45, color: '#3F3F46' }}>{tip.body}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={onDone} style={{ border: 0, background: 'transparent', color: '#3F3F46', fontFamily: 'inherit', fontSize: 12.5, padding: 0, cursor: 'pointer' }}>Skip the tour</button>
          <span style={{ flexGrow: 1 }} />
          <button type="button" onClick={() => (last ? onDone() : setStep(step + 1))}
            style={{ height: 30, padding: '0 12px', borderRadius: 8, background: C.ground, color: '#FFFFFF', border: 0, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>Next</button>
        </div>
      </div>
    </>
  );
}
