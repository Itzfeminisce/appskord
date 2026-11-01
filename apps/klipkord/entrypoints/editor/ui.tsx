import type { CSSProperties, ReactNode } from 'react';

/** FRAMES.md "Look": the dark editor. */
export const C = {
  ground: '#0E0E11', panel: '#16161A', raised: '#1F1F25', line: '#2C2C34', text: '#F4F4F5', secondary: '#A9A9B2',
  muted: '#8E8E98', accent: '#C2410C', accentText: '#FB923C', tabOn: '#26262D', ok: '#22C55E',
} as const;

export const MONO = "'Geist Mono Variable', 'Geist Mono', monospace";

/** Icon paths copied from the frames (24 × 24, stroked). */
export const ICONS = {
  back: <path d="M15 18l-6-6 6-6" />,
  down: <path d="M6 9l6 6 6-6" />,
  check: <path d="M20 6L9 17l-5-5" />,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>,
  keys: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  ai: <><path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" /><path d="M17.8 11.8L19 13" /><path d="M17.8 6.2L19 5" /><path d="M3 21l9-9" /><path d="M12.2 6.2L11 5" /></>,
  export: <><path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 21h14" /></>,
  prev: <><path d="M19 20L9 12l10-8z" /><path d="M5 19V5" /></>,
  play: <path d="M7 4l13 8-13 8z" />,
  pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
  next: <><path d="M5 4l10 8-10 8z" /><path d="M19 5v14" /></>,
  full: <><path d="M8 3H3v5" /><path d="M16 3h5v5" /><path d="M8 21H3v-5" /><path d="M16 21h5v-5" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
};

export function Icon({ children, size = 16, color = 'currentColor' }: { children: ReactNode; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}

/** The frames' 32 px icon button. */
export const iconButton = (size = 32): CSSProperties => ({
  width: size, height: size, border: 0, borderRadius: 8, background: 'transparent', color: C.secondary, display: 'flex',
  alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer', flexShrink: 0,
});

export type Tone = 'primary' | 'secondary' | 'ghost';

const TONES: Record<Tone, CSSProperties> = {
  primary: { background: C.text, color: C.ground, border: 0 },
  secondary: { background: C.raised, color: C.text, border: `1px solid ${C.line}` },
  ghost: { background: 'transparent', color: C.secondary, border: 0 },
};

/** The StatesOpen card buttons: light primary, raised secondary, quiet ghost. */
export const actionButton = (tone: Tone): CSSProperties => ({
  height: 30, padding: '0 12px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, display: 'inline-flex',
  alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', boxSizing: 'border-box', ...TONES[tone],
});

/** A grey bar that stands in for content while the editor opens. */
export function Bone({ style }: { style?: CSSProperties }) {
  return <span aria-hidden="true" style={{ display: 'block', borderRadius: 8, background: C.raised, ...style }} />;
}
