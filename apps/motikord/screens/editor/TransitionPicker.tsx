import { useEffect, useState } from 'react';
import { sceneIndex } from '../../lib/editor/store';
import {
  defaultMs, packOf, setTransition, templateOf, transitionGroups, transitionOf, TRANSITION_MAX_MS, TRANSITION_MIN_MS, TRANSITION_NAMES,
} from '../../lib/editor/v2';
import type { TransitionKind } from '../../lib/types';
import { useEditor } from './Editor';

// TransitionPicker popover (from a timeline diamond or "Comes in from"): sets scene.transition, one Change per pick.

const head = { fontSize: 12, fontWeight: 600 } as const;
const sub = { fontSize: 11, color: 'var(--faint)' } as const;

/** The tile's mini strip: two frames and how one gives way to the other. */
function Strip({ kind }: { kind: TransitionKind }) {
  const a = 'var(--line-strong)';
  const b = 'var(--accent)';
  const shape: Record<TransitionKind, [number, number]> = { cut: [50, 50], crossfade: [35, 65], slide: [55, 45], push: [50, 50], wipe: [40, 60], zoom: [45, 55], match: [50, 50] };
  const [l] = shape[kind];
  return (
    <span aria-hidden="true" style={{ display: 'flex', width: '100%', height: 22, borderRadius: 5, overflow: 'hidden' }}>
      <span style={{ width: `${l}%`, background: a }} />
      {kind === 'crossfade' && <span style={{ width: '30%', background: `linear-gradient(90deg, ${a}, ${b})` }} />}
      <span style={{ flexGrow: 1, background: b, transform: kind === 'zoom' ? 'scale(0.86)' : undefined, borderRadius: kind === 'zoom' ? 3 : 0 }} />
    </span>
  );
}

export function TransitionPickerPopover({ sceneId, onClose }: { sceneId: string; onClose: () => void }) {
  const { state, edit } = useEditor();
  const r = state.clip.recipe;
  const si = sceneIndex(r, sceneId);
  const [every, setEvery] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (si < 1) return null;
  const pack = packOf(r);
  const cur = transitionOf(r, si);
  const g = transitionGroups(pack);
  const ms = cur.kind === 'cut' ? defaultMs(r, si) : cur.ms;
  const set = (kind: TransitionKind, len = ms, all = every) => edit(setTransition(r, si, { kind, ms: len }, all));
  const name = (i: number) => `${i + 1} · ${templateOf(r.scenes[i])?.name ?? 'Free layers'}`;

  const tile = (k: TransitionKind, muted: boolean) => {
    const on = cur.kind === k;
    return (
      <button key={k} type="button" role="radio" aria-checked={on} onClick={() => set(k)}
        style={{ position: 'relative', padding: 8, borderRadius: 10, border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--tint)' : 'var(--surface)', opacity: muted && !on ? 0.65 : 1, display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', font: '500 12px/1 var(--font)', color: 'var(--ink)' }}>
        <Strip kind={k} />
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {TRANSITION_NAMES[k]}
          {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
        </span>
      </button>
    );
  };

  return (
    <div role="dialog" aria-label={`Transition into scene ${si + 1}`} style={{ position: 'fixed', bottom: 212, left: '50%', transform: 'translateX(-50%)', width: 360, zIndex: 20, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 12px 32px rgba(16,16,20,0.14)' }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{`Transition into scene ${si + 1}`}</h2>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{`From ${name(si - 1)} to ${name(si)}`}</span>
      <span style={{ display: 'flex', justifyContent: 'space-between' }}><span style={head}>{`${pack.name} pack`}</span><span style={sub}>Made for this look</span></span>
      <div role="radiogroup" aria-label={`${pack.name} pack`} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>{g.pack.map((k) => tile(k, false))}</div>
      <span style={{ display: 'flex', justifyContent: 'space-between' }}><span style={head}>Other transitions</span><span style={sub}>Work with any look</span></span>
      <div role="radiogroup" aria-label="Other transitions" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>{g.other.map((k) => tile(k, true))}</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'var(--muted)' }}>Length</span><span style={{ fontFamily: 'var(--mono)' }}>{`${(ms / 1000).toFixed(1)} s`}</span></span>
        <input type="range" min={TRANSITION_MIN_MS} max={TRANSITION_MAX_MS} step={50} value={ms} disabled={cur.kind === 'cut'}
          onChange={(e) => set(cur.kind, Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
        <span style={{ display: 'flex', justifyContent: 'space-between', ...sub, fontFamily: 'var(--mono)' }}><span>0.2 s</span><span>1.0 s</span></span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" role="switch" checked={every} aria-checked={every} onChange={(e) => { setEvery(e.target.checked); if (e.target.checked) set(cur.kind, ms, true); }} style={{ accentColor: 'var(--accent)', margin: 0 }} />
        Use for every cut in this clip
      </label>
      {r.beatSync && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Beat sync is on: the cut lands on the nearest beat.</span>}
      <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
    </div>
  );
}
