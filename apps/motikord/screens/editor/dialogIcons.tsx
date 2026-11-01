import type { CSSProperties } from 'react';

// Small icons and pieces shared by the editor dialogs (NewLook, SwapTemplate, TransitionPicker, Changes, Music).

const svg = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const CloseX = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...svg}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const Tick = ({ size = 11, colour = '#FFFFFF', width = 3 }: { size?: number; colour?: string; width?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" {...svg} stroke={colour} strokeWidth={width}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const ArrowRight = () => <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth={2} {...svg}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const Swap = ({ colour = 'currentColor' }: { colour?: string }) => <svg width="13" height="13" viewBox="0 0 24 24" strokeWidth={2.2} {...svg} stroke={colour}><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>;
export const Note = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...svg}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>;
export const UndoIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" strokeWidth={2} {...svg}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></svg>;
export const BackHere = () => <svg width="13" height="13" viewBox="0 0 24 24" strokeWidth={2} {...svg}><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8" /><path d="M3 3v5h5" /></svg>;
export const Laptop = () => <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth={2} {...svg}><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></svg>;

/** The round close button in every dialog's top-right corner. */
export function CloseButton({ onClick, size = 30 }: { onClick: () => void; size?: number }) {
  return (
    <button type="button" aria-label="Close" onClick={onClick} style={{ width: size, height: size, flexShrink: 0, border: 0, padding: 0, borderRadius: 8, background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
      <CloseX />
    </button>
  );
}

/** The 12px rotated square that points a popover at what opened it. */
export function Caret({ side, style }: { side: 'right' | 'bottom'; style: CSSProperties }) {
  const edge = side === 'right' ? { borderTop: '1px solid var(--line)', borderRight: '1px solid var(--line)' } : { borderBottom: '1px solid var(--line)', borderRight: '1px solid var(--line)' };
  return <span aria-hidden="true" style={{ position: 'absolute', width: 12, height: 12, background: 'var(--surface)', transform: 'rotate(45deg)', ...edge, ...style }} />;
}

/** An on/off switch: a real checkbox for keyboard and screen readers, drawn as a 36x20 track. */
export function Toggle({ on, label, onChange }: { on: boolean; label?: string; onChange: (on: boolean) => void }) {
  return (
    <span style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}>
      <input type="checkbox" role="switch" aria-label={label} checked={on} aria-checked={on} onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', inset: 0, margin: 0, opacity: 0, cursor: 'pointer' }} />
      <span aria-hidden="true" style={{ width: 36, height: 20, borderRadius: 10, background: on ? 'var(--accent)' : 'var(--line-strong)', position: 'relative', transition: 'background-color 120ms', pointerEvents: 'none' }}>
        <span style={{ position: 'absolute', left: on ? 18 : 2, top: 2, width: 16, height: 16, borderRadius: '50%', background: '#FFFFFF', boxShadow: '0 1px 2px rgba(0,0,0,0.2)', transition: 'left 120ms' }} />
      </span>
    </span>
  );
}
