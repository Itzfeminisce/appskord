import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

// Small controls the v3 panels share, drawn as in the frames: segmented radios, pressed chips, switches, sliders.

export const C = {
  ink: 'var(--ink, #111114)',
  muted: 'var(--muted, #6E7079)',
  line: '#E8E8EB',
  accent: 'var(--accent, #BE185D)',
  accentHover: 'var(--accent-hover, #9D174D)',
  tint: 'var(--tint, #FDF2F8)',
  stage: 'var(--stage, #EDEDF0)',
  surface: 'var(--surface, #FFFFFF)',
  font: 'var(--font, Geist, system-ui, sans-serif)',
  mono: 'var(--mono, "Geist Mono", monospace)',
} as const;

export const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: C.ink };
export const hint: CSSProperties = { fontSize: 12, color: C.muted, lineHeight: 1.4 };
export const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' };

/** The "Changed" tag a panel section gets after a prompt edit (EditPromptV3). */
export const ChangedTag = () => (
  <span style={{ height: 18, padding: '0 6px', borderRadius: 4, background: '#FDF2F8', color: '#9D174D', fontFamily: C.mono, fontSize: 10, fontWeight: 400, display: 'inline-flex', alignItems: 'center' }}>Changed</span>
);

export function Section({ title, aside, changed, children }: { title: string; aside?: ReactNode; changed?: boolean; children: ReactNode }) {
  return (
    <section style={sectionStyle}>
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>{title}{changed && <ChangedTag />}</span>
        {aside && <span style={{ fontFamily: C.mono, fontSize: 10, color: '#6E7079' }}>{aside}</span>}
      </span>
      {children}
    </section>
  );
}

/** A segmented radiogroup ("Feel": Smooth, Snappy…). */
export function Segmented<T extends string>({ name, options, value, onChange, disabled, small }: { name: string; options: readonly (readonly [T, string])[]; value: T | undefined; onChange: (v: T) => void; disabled?: boolean; small?: boolean }) {
  return (
    <div role="radiogroup" aria-label={name} style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 8, background: '#F1F1F3' }}>
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={id === value} disabled={disabled} onClick={() => onChange(id)}
          style={{ flex: 1, minWidth: 0, height: small ? 18 : 26, border: 0, borderRadius: 6, background: id === value ? C.surface : 'transparent', boxShadow: id === value ? '0 1px 2px rgba(16,16,20,0.1)' : 'none', font: `${id === value ? 600 : 400} ${small ? 10 : 11.5}px/1 ${C.font}`, padding: small ? 0 : undefined, color: id === value ? C.accentHover : C.muted, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** A wrap of pressed chips; one on at a time unless `multi`. */
export function Chips<T extends string>({ options, value, onChange, disabled }: { options: readonly (readonly [T, string])[]; value: T | undefined; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(([id, text]) => (
        <Chip key={id} on={id === value} disabled={disabled} onClick={() => onChange(id)}>{text}</Chip>
      ))}
    </div>
  );
}

export function Chip({ on, onClick, children, disabled, title }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick} title={title}
      style={{ height: 28, padding: '0 9px', borderRadius: 8, border: `1px solid ${on ? C.accent : 'var(--line-input, #E0E0E4)'}`, background: on ? C.tint : C.surface, color: on ? C.accentHover : C.ink, font: `${on ? 600 : 400} 12px/1 ${C.font}`, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

export function Switch({ name, on, onChange, disabled }: { name: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-label={name} aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 36, height: 20, flexShrink: 0, borderRadius: 10, border: 0, padding: 2, background: on ? C.accent : '#D4D4D9', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start' }}>
      <span style={{ width: 16, height: 16, borderRadius: 8, background: '#FFFFFF' }} />
    </button>
  );
}

/** A row: title and line on the left, a switch on the right. */
export function SwitchRow({ title, line, on, onChange, disabled }: { title: string; line?: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {line && <span style={hint}>{line}</span>}
      </span>
      <Switch name={title} on={on} onChange={onChange} disabled={disabled} />
    </div>
  );
}

/** A labelled slider with its value on the right ("Amount 60%"). */
export function Slider({ name, value, min, max, step = 1, text, onChange, onDone, disabled }: { name: string; value: number; min: number; max: number; step?: number; text: string; onChange: (v: number) => void; onDone?: () => void; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: C.muted }}>{name}</span>
        <span style={{ fontWeight: 600 }}>{text}</span>
      </span>
      <input type="range" aria-label={name} min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.currentTarget.value))} onPointerUp={onDone} onKeyUp={onDone} style={{ accentColor: '#BE185D', width: '100%' }} />
    </label>
  );
}

/** A small text field that commits on Enter or blur ("0.15 s"). */
export function Field({ name, value, onCommit, disabled }: { name: string; value: string; onCommit?: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text !== value) onCommit?.(text); };
  return (
    <label style={{ flex: 1, minWidth: 0, height: 38, boxSizing: 'border-box', border: '1px solid var(--line-input, #E0E0E4)', borderRadius: 8, background: onCommit ? C.surface : C.stage, padding: '3px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <span style={{ fontSize: 10, color: C.muted }}>{name}</span>
      <input aria-label={name} value={text} readOnly={!onCommit || disabled} onChange={(e) => setText(e.currentTarget.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        style={{ minWidth: 0, width: '100%', border: 0, padding: 0, outline: 'none', font: `500 12px/1.3 ${C.mono}`, color: onCommit ? C.ink : C.muted, background: 'transparent' }} />
    </label>
  );
}

/** The heading at the top of a panel: icon, name and its line ("Headline", "Title text · scene 1"). */
export function PanelHead({ icon, name, line }: { icon: ReactNode; name: string; line: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0 4px', fontSize: 12, minWidth: 0 }}>
      <span aria-hidden="true" style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, background: '#111114', color: '#FFFFFF', display: 'grid', placeItems: 'center', font: `700 11px/1 ${C.font}`, letterSpacing: '-0.04em' }}>{icon}</span>
      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</span>
    </div>
  );
}

export const primaryButton: CSSProperties = { height: 36, padding: '0 14px', border: 0, borderRadius: 9, background: '#BE185D', color: '#FFFFFF', font: `600 13px/1 ${C.font}`, cursor: 'pointer' };
export const quietButton: CSSProperties = { height: 30, padding: '0 10px', border: `1px solid ${C.line}`, borderRadius: 8, background: C.surface, color: C.ink, font: `500 12px/1 ${C.font}`, cursor: 'pointer' };
