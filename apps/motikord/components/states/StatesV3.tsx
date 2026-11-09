import type { CSSProperties } from 'react';
import { CHROME_3D_URL, STATE_IDS, stateView, THREE_D_OPENS, WHERE, type StateId, type StateParams } from './copy';

// Every v3 error, wait and notice, as the user sees it (StatesV3 frame).

const TONE: Record<'error' | 'notice' | 'done', CSSProperties> = {
  error: { background: 'var(--error-bg)', border: '1px solid var(--error-line)' },
  notice: { background: 'var(--warning-bg)', border: '1px solid var(--warning-line)' },
  done: { background: 'var(--success-bg)', border: '1px solid var(--success-line)' },
};
const INK = { error: 'var(--error-ink)', notice: 'var(--warning-ink)', done: 'var(--success-ink)' } as const;

export interface StateCardProps extends StateParams {
  id: StateId;
  /** The action button, when the state has one. */
  onAction?: () => void;
  /** keyframes-waiting only: key frames drawn so far, how many in all, the clip's name and the scene being drawn. */
  progress?: { done: number; total: number; name: string; scene: number };
}

/** One state's card: its title, its line and its action. */
export function StateCard({ id, onAction, progress, ...params }: StateCardProps) {
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
  const ink = INK[v.tone];
  return (
    <div role={v.tone === 'error' ? 'alert' : 'status'} data-state={id} style={{ padding: 14, borderRadius: 14, display: 'flex', gap: 12, alignItems: 'flex-start', ...TONE[v.tone] }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: ink, marginTop: 6, flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flexGrow: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: ink }}>{v.title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--ink)' }}>{v.line}</span>
        {v.action && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={onAction} style={{ height: 34, padding: '0 14px', border: '1px solid var(--line-input)', borderRadius: 9, background: 'var(--surface)', font: '600 13px var(--font)', color: 'var(--ink)', cursor: 'pointer' }}>{v.action}</button>
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
