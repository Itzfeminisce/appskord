import type { CSSProperties, ReactNode } from 'react';

// Shared rows for the v3 settings, privacy and export screens (SettingsV3 frame).

export const rowStyle: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--line-soft)', color: 'var(--ink)', textDecoration: 'none' };
export const last: CSSProperties = { borderBottom: 0 };

export function Section({ title, children, first, id }: { title: string; children: ReactNode; first?: boolean; id?: string }) {
  return (
    <>
      <h2 id={id} style={{ margin: first ? '14px 24px 8px' : '22px 24px 8px', fontSize: 13, fontWeight: 600 }}>{title}</h2>
      <div style={{ margin: '0 16px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{children}</div>
    </>
  );
}

export const Text = ({ title, hint }: { title: string; hint?: ReactNode }) => (
  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, minWidth: 0 }}>
    <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
    {hint && <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{hint}</span>}
  </span>
);

/** A switch row: "On" or "Off" beside the toggle; the real checkbox stays for keyboards and screen readers. */
export function Switch({ label, hint, checked, onChange, style }: { label: string; hint: ReactNode; checked: boolean; onChange: (v: boolean) => void; style?: CSSProperties }) {
  return (
    <label style={{ ...rowStyle, ...style }}>
      <Text title={label} hint={hint} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minHeight: 40 }}>
        <b aria-hidden="true" style={{ fontSize: 12, fontWeight: checked ? 600 : 500, color: checked ? 'var(--accent-hover)' : 'var(--muted)', minWidth: 22, textAlign: 'right' }}>{checked ? 'On' : 'Off'}</b>
        <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }} />
        <span aria-hidden="true" style={{ position: 'relative', width: 34, height: 20, borderRadius: 999, background: checked ? 'var(--accent)' : '#DCDCE0', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 2, left: checked ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff' }} />
        </span>
      </span>
    </label>
  );
}

/** A radio in a column: dot, then the label. */
export function Radio({ checked, onSelect, children }: { checked: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onSelect}
      style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36, border: 0, background: 'none', padding: 0, font: `${checked ? 500 : 400} 13px var(--font)`, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
      <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', boxSizing: 'border-box', flexShrink: 0, border: checked ? '5px solid var(--accent)' : '1.5px solid #C4C4CA' }} />
      {children}
    </button>
  );
}

/** Radios side by side in a pill (Auto, Full, Light). */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: '#F1F1F3', flexShrink: 0 }}>
      {options.map(([id, name]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}
          style={{ height: 34, padding: '0 11px', border: 0, borderRadius: 6, fontSize: 12, fontFamily: 'var(--font)', cursor: 'pointer', background: value === id ? 'var(--surface)' : 'transparent', color: value === id ? 'var(--ink)' : 'var(--muted)', fontWeight: value === id ? 600 : 500 }}>
          {name}
        </button>
      ))}
    </div>
  );
}

export const backIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>;
export const chevron = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;
export const lockIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>;
