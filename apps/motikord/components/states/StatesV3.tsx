import type { CSSProperties, ReactNode } from 'react';
import { CHROME_3D_URL, STATE_IDS, stateView, THREE_D_OPENS, WHERE, type StateId, type StateParams } from './copy';

// Every v3 error, wait and notice, as the user sees it (StatesV3 frame).

const TONE: Record<'error' | 'notice' | 'done', CSSProperties> = {
  error: { background: 'var(--error-bg)', border: '1px solid var(--error-line)' },
  notice: { background: 'var(--warning-bg)', border: '1px solid var(--warning-line)' },
  done: { background: 'var(--success-bg)', border: '1px solid var(--success-line)' },
};

// How the frame draws each card: warnings amber, plain notices white, and which buttons are quiet.
type Look = 'error' | 'warning' | 'quiet' | 'done';
const QUIET = new Set<StateId>(['captions-no-voice', 'critic-fix-limit', 'preview-light', 'effect-heavy', 'lottie-credit']);
const WARNING = new Set<StateId>(['animate-layer-unclear', 'captions-no-key', 'voiceover-no-key', 'critic-not-available', 'three-d-unavailable', 'rig-photo', 'export-60-fallback']);
const QUIET_ACTION = new Set<StateId>(['captions-no-voice', 'export-60-fallback']);
const lookOf = (id: StateId, tone: 'error' | 'notice' | 'done'): Look => (QUIET.has(id) ? 'quiet' : WARNING.has(id) ? 'warning' : tone === 'done' ? 'done' : tone === 'notice' ? 'warning' : 'error');
const CARD: Record<Look, CSSProperties> = {
  error: TONE.error,
  warning: TONE.notice,
  quiet: { background: 'var(--surface)', border: '1px solid var(--line)' },
  done: { background: 'var(--surface)', border: '1px solid var(--success-line)' },
};
const TITLE: Record<Look, string> = { error: '#991B1B', warning: '#92400E', quiet: 'var(--ink)', done: '#14532D' };
const ICON: Record<Look, ReactNode> = {
  error: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B91C1C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>,
  warning: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4M12 17v.01" /></svg>,
  quiet: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5F6168" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.01" /></svg>,
  done: <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 10, background: '#15803D', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>,
};
const actionStyle = (primary: boolean): CSSProperties => ({ height: 44, padding: '0 16px', borderRadius: 10, whiteSpace: 'nowrap', font: '600 13px var(--font)', display: 'flex', alignItems: 'center', cursor: 'pointer', background: primary ? 'var(--accent)' : 'var(--surface)', color: primary ? '#FFFFFF' : 'var(--ink)', border: `1px solid ${primary ? 'var(--accent)' : 'var(--line-input)'}` });

export interface StateCardProps extends StateParams {
  id: StateId;
  /** The action button, when the state has one. */
  onAction?: () => void;
  /** The second button, when the state has one. */
  onAction2?: () => void;
  /** keyframes-waiting only: key frames drawn so far, how many in all, the clip's name and the scene being drawn. */
  progress?: { done: number; total: number; name: string; scene: number };
}

/** One state's card: its title, its line and its action. */
export function StateCard({ id, onAction, onAction2, progress, ...params }: StateCardProps) {
  const v = stateView(id, params);
  if (id === 'keyframes-waiting') {
    const p = progress ?? { done: 1, total: 4, name: 'Morning shift', scene: 1 };
    return (
      <div role="status" aria-label={`Drawing your key frames, ${p.done} of ${p.total} ready`} data-state={id} style={{ padding: 14, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 600, flexGrow: 1 }}>{v.title}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{`${p.done} of ${p.total}`}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
          <span style={{ fontWeight: 600 }}>{p.name}</span>
          <span style={{ color: 'var(--muted)' }}>{`Scene ${p.scene}`}</span>
        </div>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{v.line}</span>
      </div>
    );
  }
  const look = lookOf(id, v.tone);
  return (
    <div role={v.tone === 'error' ? 'alert' : 'status'} data-state={id} style={{ padding: 14, borderRadius: 14, display: 'flex', gap: 12, alignItems: 'flex-start', ...CARD[look] }}>
      {ICON[look]}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flexGrow: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, color: TITLE[look] }}>{v.title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: '#3F4148' }}>{v.line}</span>
        {v.action && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <button type="button" onClick={onAction} style={actionStyle(!QUIET_ACTION.has(id))}>{v.action}</button>
            {v.action2 && <button type="button" onClick={onAction2} style={actionStyle(false)}>{v.action2}</button>}
            {id === 'three-d-unavailable' && <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{THREE_D_OPENS} {CHROME_3D_URL}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

/** StatesV3: all the states with the frame's sample values. */
export default function StatesV3() {
  return (
    <main data-frame="StatesV3" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 18, padding: '16px 16px 28px' }}>
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>States: v3</h1>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Every v3 error, wait and notice, as the user sees it.</p>
      {STATE_IDS.map((id) => (
        <section key={id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="mono" style={{ margin: 0, padding: '0 4px', fontSize: 11, fontWeight: 500, color: 'var(--faint)' }}>{`${id} · ${WHERE[id]}`}</h2>
          <StateCard id={id} />
        </section>
      ))}
    </main>
  );
}
