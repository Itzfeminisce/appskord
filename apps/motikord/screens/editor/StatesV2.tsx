import { useState, type ReactNode } from 'react';

// StatesMakeV2, the editor's states: scene-remake-failed, scene-remade, swap-no-fit, text-shortened, restyle-done,
// restyle-failed, v1-clip, template-repeat. SceneRemaking's toasts sit here too.

const primary = {
  height: 32, padding: '0 12px', border: 0, borderRadius: 8, background: 'var(--ink)', color: '#fff',
  font: '600 12px/1 var(--font)', cursor: 'pointer',
} as const;
const quiet = { ...primary, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line-strong)', fontWeight: 500 } as const;
const link = { padding: '8px 0', border: 0, background: 'none', font: '600 13px/1 var(--font)', color: 'var(--accent)', cursor: 'pointer' } as const;
const toastBtn = { height: 30, padding: '0 12px', border: 0, borderRadius: 8, background: 'rgba(255,255,255,0.12)', color: '#fff', font: '600 12px/1 var(--font)', cursor: 'pointer' } as const;

type Tone = 'info' | 'warning' | 'error' | 'success';
const TONE: Record<Tone, { bg: string; line: string }> = {
  info: { bg: 'var(--surface)', line: 'var(--line)' },
  warning: { bg: 'var(--warning-bg)', line: 'var(--warning-line)' },
  error: { bg: 'var(--error-bg)', line: 'var(--error-line)' },
  success: { bg: 'var(--success-bg)', line: 'var(--success-line)' },
};

export function StateCard({ state, tone, title, body, children }: { state: string; tone: Tone; title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} data-state={state} style={{ padding: 14, borderRadius: 14, background: TONE[tone].bg, border: `1px solid ${TONE[tone].line}`, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 6px 20px rgba(16,16,20,0.08)' }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
      {body && <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{body}</span>}
      {children && <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  );
}

/** Dark toast with a title, a line and its buttons (SceneRemaking). */
export function SceneToast({ title, line, children, busy }: { title: string; line: string; children?: ReactNode; busy?: boolean }) {
  return (
    <div role="status" style={{ padding: '10px 10px 10px 14px', borderRadius: 12, background: 'var(--ink)', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 6px 20px rgba(16,16,20,0.18)' }}>
      {busy && <Spinner colour="#fff" />}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{line}</span>
      </span>
      {children}
    </div>
  );
}

export function Spinner({ colour = 'var(--accent)', size = 14 }: { colour?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colour} strokeWidth={2.6} strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0, animation: 'spin 0.8s linear infinite' }}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

export function Remaking({ n, others, onStop }: { n: number; others: number; onStop?: () => void }) {
  return (
    <SceneToast busy title={`Remaking scene ${n}…`} line={`The other ${others} scenes stay as they are.`}>
      <button type="button" onClick={onStop} style={toastBtn}>Stop</button>
    </SceneToast>
  );
}

export function Remade({ n, onUndo, onKeep }: { n: number; onUndo?: () => void; onKeep?: () => void }) {
  return (
    <SceneToast title={`Scene ${n} remade`} line="New layout and motion, same words.">
      <button type="button" onClick={onUndo} style={toastBtn}>Undo</button>
      <button type="button" onClick={onKeep} style={{ ...toastBtn, background: '#fff', color: 'var(--ink)' }}>Keep</button>
    </SceneToast>
  );
}

export function SceneRemade({ n, onUndo }: { n: number; onUndo?: () => void }) {
  return <StateCard state="scene-remade" tone="success" title={`Scene ${n} remade`}><button type="button" onClick={onUndo} style={quiet}>Undo</button></StateCard>;
}

export function SceneRemakeFailed({ n, onRetry }: { n: number; onRetry?: () => void }) {
  return <StateCard state="scene-remake-failed" tone="error" title={`Couldn't remake scene ${n}. It's as it was.`}><button type="button" onClick={onRetry} style={primary}>Try again</button></StateCard>;
}

export function SwapNoFit({ onRemake }: { onRemake?: () => void }) {
  return <StateCard state="swap-no-fit" tone="info" title="No other template fits these words. Remake the scene to change them."><button type="button" onClick={onRemake} style={primary}>Remake this scene</button></StateCard>;
}

export function TextShortened({ original, onUndo }: { original?: string; onUndo?: () => void }) {
  const [shown, setShown] = useState(false);
  return (
    <StateCard state="text-shortened" tone="warning" title="Shortened to fit this template" body={shown && original ? `“${original}”` : undefined}>
      {original && <button type="button" aria-expanded={shown} onClick={() => setShown(!shown)} style={link}>Show original</button>}
      <button type="button" onClick={onUndo} style={link}>Undo</button>
    </StateCard>
  );
}

export function RestyleDone({ style, onUndo }: { style: string; onUndo?: () => void }) {
  return <StateCard state="restyle-done" tone="success" title={`New look: ${style}. Same words.`}><button type="button" onClick={onUndo} style={quiet}>Undo</button></StateCard>;
}

export function RestyleFailed({ style, onRetry }: { style: string; onRetry?: () => void }) {
  return <StateCard state="restyle-failed" tone="error" title={`Couldn't apply ${style}. Nothing changed.`}><button type="button" onClick={onRetry} style={primary}>Try again</button></StateCard>;
}

export function V1Clip({ onNewLook, onKeep }: { onNewLook?: () => void; onKeep?: () => void }) {
  return (
    <StateCard state="v1-clip" tone="info" title="Made before styles" body="This clip uses free layers. Give it a new look to use templates and a style pack; your words stay.">
      <button type="button" onClick={onNewLook} style={primary}>Give it a new look</button>
      <button type="button" onClick={onKeep} style={quiet}>Keep as is</button>
    </StateCard>
  );
}

/** `scenes` count from 1; the last one is the scene the fix swaps. */
export function TemplateRepeat({ scenes, template, onSwap }: { scenes: number[]; template: string; onSwap?: () => void }) {
  const list = scenes.length > 1 ? `${scenes.slice(0, -1).join(', ')} and ${scenes[scenes.length - 1]}` : String(scenes[0] ?? '');
  return (
    <StateCard state="template-repeat" tone="warning" title={`Same template ${scenes.length} times in a row`} body={`Scenes ${list} all use ${template}.`}>
      <button type="button" onClick={onSwap} style={primary}>{`Swap scene ${scenes[scenes.length - 1] ?? ''}`}</button>
    </StateCard>
  );
}
