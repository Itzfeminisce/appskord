import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { C, Icon, iconButton, MONO } from '../ui';

/** Icon paths copied from the timeline frames (24 × 24, stroked). */
export const TL_ICONS = {
  split: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9" /><path d="M14.5 14.5L20 20" /><path d="M8.1 8.1L12 12" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>,
  speed: <><path d="M12 14l4-4" /><path d="M3.3 19a10 10 0 1 1 17.4 0" /></>,
  zoom: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /><path d="M11 8v6" /><path d="M8 11h6" /></>,
  text: <><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>,
  mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M19 10a7 7 0 0 1-14 0" /><path d="M12 19v3" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  magnet: <><path d="M6 3v8a6 6 0 0 0 12 0V3" /><path d="M6 7h4M14 7h4" /></>,
  fit: <><path d="M8 3H3v5" /><path d="M16 3h5v5" /><path d="M8 21H3v-5" /><path d="M16 21h5v-5" /></>,
  screen: <><rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20M17 2v20M2 12h20" /></>,
  camera: <><path d="M23 7l-7 5 7 5z" /><rect x="1" y="5" width="15" height="14" rx="2" /></>,
  music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  sound: <><path d="M11 5L6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></>,
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  flag: <><path d="M4 22V4" /><path d="M4 4h13l-2 4 2 4H4" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  grip: <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>,
  close: <><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>,
  check: <path d="M20 6L9 17l-5-5" />,
};

export const SHADOW = '0 18px 44px rgba(0,0,0,0.55)';

/** The frames' raised secondary button with an icon. */
export function Btn({ icon, children, onClick, disabled, active, danger }: {
  icon?: ReactNode; children: ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean; danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ height: 30, padding: '0 12px', borderRadius: 8, background: C.raised, color: danger ? '#FCA5A5' : C.text, border: `1px solid ${active ? C.accentText : C.line}`,
        fontFamily: 'inherit', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap', boxSizing: 'border-box', opacity: disabled ? 0.5 : 1 }}>
      {icon && <Icon>{icon}</Icon>}<span>{children}</span>
    </button>
  );
}

/** Segmented control (None / Cross-fade / Zoom). */
export function Seg<T extends string>({ options, value, onChange, label, disabled }: { options: readonly { value: T; label: string }[]; value: T | undefined; onChange: (v: T) => void; label?: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 8, background: C.ground, border: `1px solid ${C.line}` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={disabled} onClick={() => onChange(o.value)}
          style={{ flex: 1, height: 22, border: 0, borderRadius: 6, fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
            background: o.value === value ? C.tabOn : 'transparent', color: o.value === value ? C.text : C.secondary }}>{o.label}</button>
      ))}
    </div>
  );
}

/** The frames' slider look (style.css `kk-range`): the orange fill runs to `value`. */
export const rangeFill = (value: number, min: number, max: number) =>
  ({ '--fill': `${max > min ? ((value - min) / (max - min)) * 100 : 0}%` }) as CSSProperties;

/** A labelled slider with its value in mono on the right; `onCommit` runs once when the drag ends (one Undo step). */
export function Slider({ label, min, max, step, value, text, onInput, onCommit, disabled }: {
  label?: string; min: number; max: number; step: number; value: number; text: string; onInput?: (v: number) => void; onCommit: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {label && <span style={{ fontSize: 12, color: C.secondary, width: 74, flexShrink: 0 }}>{label}</span>}
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onInput?.(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="kk-range" style={{ flexGrow: 1, minWidth: 0, ...rangeFill(value, min, max) }} />
      <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.text, width: 40, textAlign: 'right' }}>{text}</span>
    </div>
  );
}

/** The frames' switch row: label, optional sub-line, switch on the right. */
export function Switch({ label, sub, on, onChange, disabled }: { label: string; sub?: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <span style={{ flexGrow: 1, fontSize: 13 }}>{label}{sub && <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{sub}</span>}</span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
      <span aria-hidden="true" style={{ width: 34, height: 20, borderRadius: 10, flexShrink: 0, position: 'relative', background: on ? C.accent : C.line }}>
        <span style={{ position: 'absolute', top: 2, [on ? 'right' : 'left']: 2, width: 16, height: 16, borderRadius: '50%', background: '#FFFFFF' }} />
      </span>
    </label>
  );
}

export const Heading = ({ children, aside }: { children: ReactNode; aside?: ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 600, color: C.secondary }}>
    <span>{children}</span>{aside}
  </div>
);

export const Help = ({ children }: { children: ReactNode }) => <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: C.muted }}>{children}</p>;

/** Closes on Escape. */
export function useEscape(onClose: () => void, on = true) {
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose, on]);
}

/** Closes when a press lands outside `inside`. */
export function useOutside(inside: () => HTMLElement | null, onClose: () => void, on = true) {
  useEffect(() => {
    if (!on) return;
    const down = (e: PointerEvent) => {
      const el = inside();
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [inside, onClose, on]);
}

/** The frames' centred modal: dimmed page, 14 px card, title, Close (Esc), body and a footer with Done. */
export function Modal({ label, width, onClose, children, footer }: { label: string; width: number; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,7,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={label} style={{ width, maxHeight: 600, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`, boxShadow: '0 24px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 16px 0 20px' }}>
          <div style={{ flexGrow: 1 }}><h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{label}</h2></div>
          <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose} style={iconButton()}><Icon>{TL_ICONS.close}</Icon></button>
        </div>
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>{children}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderTop: `1px solid ${C.line}` }}>
          {footer ?? <span style={{ flexGrow: 1 }} />}
          <button type="button" onClick={onClose} style={{ height: 32, padding: '0 12px', borderRadius: 8, background: C.text, color: C.ground, border: 0, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  );
}

/** A floating card (menus, popovers). */
export const floating: CSSProperties = { borderRadius: 12, background: C.panel, border: `1px solid ${C.line}`, boxShadow: SHADOW, color: C.text, zIndex: 15 };
