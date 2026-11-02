import type { CSSProperties, ReactNode } from 'react';
import { actionButton, C, Icon, type Tone } from '../ui';

export interface Action { label: string; tone: Tone; onClick: () => void; icon?: ReactNode }

/** The StatesOpen card: a title, one line or two, and its buttons. Compact is the banner size, for the inspector. */
export function StateCard({ state, title, body, actions = [], style, role, compact = false }: {
  state: string; title: string; body: ReactNode; actions?: Action[]; style?: CSSProperties; role?: 'alert' | 'status' | 'dialog'; compact?: boolean;
}) {
  return (
    <div data-state={state} role={role} aria-label={role === 'dialog' ? title : undefined} style={{
      borderRadius: compact ? 10 : 12, background: compact ? C.raised : C.panel, border: `1px solid ${C.line}`, padding: compact ? '10px 12px' : '14px 16px', display: 'flex',
      flexDirection: 'column', gap: compact ? 4 : 8, boxSizing: 'border-box', color: C.text, ...style,
    }}>
      <span style={{ fontSize: compact ? 13 : 14, fontWeight: 600 }}>{title}</span>
      <span style={{ fontSize: compact ? 12 : 12.5, color: C.secondary, lineHeight: compact ? 1.4 : 1.5 }}>{body}</span>
      {actions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: compact ? 2 : 4, flexWrap: 'wrap' }}>
          {actions.map((a) => (
            <button key={a.label} type="button" onClick={a.onClick} style={actionButton(a.tone)}>
              {a.icon && <Icon size={14}>{a.icon}</Icon>}<span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A dialog over the editor: one StatesOpen card on a dimmed page. */
export function Dialog({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,14,17,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
      <div style={{ width: 380 }}>{children}</div>
    </div>
  );
}

/** A state that replaces the whole editor (window-small, no-project). */
export function FullPage({ children }: { children: ReactNode }) {
  return (
    <main style={{ height: '100%', background: C.ground, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>
      <div style={{ width: 412, maxWidth: '100%' }}>{children}</div>
    </main>
  );
}
