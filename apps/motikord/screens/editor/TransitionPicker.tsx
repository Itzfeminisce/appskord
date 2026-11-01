import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { sceneIndex } from '../../lib/editor/store';
import {
  defaultMs, packOf, setTransition, templateOf, transitionGroups, transitionOf, TRANSITION_MAX_MS, TRANSITION_MIN_MS, TRANSITION_NAMES,
} from '../../lib/editor/v2';
import type { TransitionKind } from '../../lib/types';
import { useEditor } from './Editor';
import { CloseButton, Note, Tick, Toggle } from './dialogIcons';

// TransitionPicker popover, anchored above its timeline diamond: sets scene.transition, one Change per pick. Cut lives in "Comes in from".

const W = 30;
const H = 46;
/** One mini scene: dark with yellow lines (A) or yellow with dark lines (B). */
function Mini({ b, style }: { b?: boolean; style?: CSSProperties }) {
  const line = b ? '#0A0A0A' : '#FACC15';
  return (
    <span style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, background: b ? '#FACC15' : '#27272A', overflow: 'hidden', ...style }}>
      <span style={{ position: 'absolute', left: 5, top: 18, width: 18, height: 3, background: line }} />
      <span style={{ position: 'absolute', left: 5, top: 24, width: 12, height: 3, background: line }} />
    </span>
  );
}
const Half = ({ children }: { children: ReactNode }) => <span style={{ position: 'absolute', left: 15, top: 0, width: 15, height: H, overflow: 'hidden' }}>{children}</span>;
const Seam = () => <span style={{ position: 'absolute', left: 14, top: 0, width: 2, height: H, background: '#FFFFFF' }} />;
const Dot = ({ left, colour }: { left: number; colour: string }) => <span style={{ position: 'absolute', left, top: 9, width: 12, height: 12, borderRadius: '50%', background: colour }} />;

/** The middle frame: how scene A gives way to scene B. */
function Between({ kind }: { kind: TransitionKind }) {
  switch (kind) {
    case 'push': return <><Mini style={{ left: -16 }} /><Mini b style={{ left: 14 }} /></>;
    case 'wipe': return <><Mini /><Half><Mini b style={{ left: -15 }} /></Half><Seam /></>;
    case 'zoom': return <><Mini /><Mini b style={{ left: 7, top: 11, width: 16, height: 24, borderRadius: 2 }} /></>;
    case 'crossfade': return <><Mini /><Mini b style={{ opacity: 0.5 }} /></>;
    case 'slide': return <><Mini /><Mini b style={{ left: 14, boxShadow: '-2px 0 4px rgba(0,0,0,0.35)' }} /></>;
    case 'match': return <><Mini /><Dot left={9} colour="#FACC15" /><Seam /><Half><Mini b style={{ left: -15 }} /><Dot left={-6} colour="#0A0A0A" /></Half></>;
    default: return <Mini b />;
  }
}
const frame = { position: 'relative', width: W, height: H, borderRadius: 3, overflow: 'hidden', flexShrink: 0, background: '#27272A' } as const;
/** The tile's mini two-scene strip: before, during, after. */
function Strip({ kind, muted }: { kind: TransitionKind; muted: boolean }) {
  return (
    <span aria-hidden="true" style={{ display: 'flex', gap: 3, opacity: muted ? 0.78 : 1 }}>
      <span style={frame}><Mini /></span>
      <span style={frame}><Between kind={kind} /></span>
      <span style={frame}><Mini b /></span>
    </span>
  );
}

const GAP = 22;
const mono = { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' } as const;

/** The diamond's centre and the timeline's top edge, so the popover sits above the timeline pointing at it. */
function useDiamond(si: number): { x: number; top: number } | undefined {
  const [at, setAt] = useState<{ x: number; top: number }>();
  useLayoutEffect(() => {
    const read = () => {
      const d = document.querySelector(`button[aria-label^="Transition into scene ${si + 1}:"]`);
      if (!d) { setAt(undefined); return; }
      const rect = d.getBoundingClientRect();
      // The first ancestor that reaches above the scene lane holds the ruler: the popover clears it.
      let top = rect.top;
      for (let e = d.parentElement; e; e = e.parentElement) { const t = e.getBoundingClientRect().top; if (t < rect.top - 20) { top = t; break; } }
      setAt({ x: rect.left + rect.width / 2, top });
    };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [si]);
  return at;
}
const WIDTH = 520;

export function TransitionPickerPopover({ sceneId, onClose }: { sceneId: string; onClose: () => void }) {
  const { state, edit } = useEditor();
  const r = state.clip.recipe;
  const si = sceneIndex(r, sceneId);
  const [every, setEvery] = useState(false);
  const anchor = useDiamond(si);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (si < 1) return null;
  const cur = transitionOf(r, si);
  const g = transitionGroups(packOf(r));
  const ms = cur.kind === 'cut' ? defaultMs(r, si) : cur.ms;
  const set = (kind: TransitionKind, len = ms, all = every) => edit(setTransition(r, si, { kind, ms: len }, all));
  const name = (i: number) => `${i + 1} · ${templateOf(r.scenes[i])?.name ?? 'Free layers'}`;

  const tile = (k: TransitionKind, muted: boolean) => {
    const on = cur.kind === k;
    return (
      <button key={k} type="button" role="radio" aria-checked={on} onClick={() => set(k)}
        style={{ position: 'relative', padding: 10, borderRadius: 12, border: on ? '1.5px solid var(--accent)' : '1px solid #E0E0E4', background: on ? 'var(--tint)' : muted ? '#FAFAFB' : 'var(--surface)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
        <Strip kind={k} muted={muted && !on} />
        <span style={{ fontSize: 13, fontWeight: 600, color: muted && !on ? 'var(--muted)' : 'var(--ink)' }}>{TRANSITION_NAMES[k]}</span>
        {on && <span aria-hidden="true" style={{ position: 'absolute', right: 8, top: 8, width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)', display: 'grid', placeItems: 'center' }}><Tick /></span>}
      </button>
    );
  };
  const groupHead = (title: string, note: string) => (
    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span>{title}</span><span style={{ fontWeight: 400, color: 'var(--faint)' }}>{note}</span></span>
  );
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 } as const;
  // Above the timeline, the caret on the diamond; without one (opened from "Comes in from") it sits over the timeline's middle.
  const vw = window.innerWidth;
  const cx = anchor ? anchor.x : vw / 2;
  const left = Math.max(8, Math.min(cx - WIDTH / 2, vw - WIDTH - 8));
  const bottom = anchor ? window.innerHeight - anchor.top + GAP : 212;
  const pack = g.pack.filter((k) => k !== 'cut');
  const other = g.other.filter((k) => k !== 'cut');

  return (
    <div role="dialog" aria-label={`Transition into scene ${si + 1}`} style={{ position: 'fixed', left, bottom, width: WIDTH, boxSizing: 'border-box', zIndex: 20, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: '0 18px 48px rgba(16,16,20,0.22), 0 2px 6px rgba(16,16,20,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{`Transition into scene ${si + 1}`}</h2>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{`From ${name(si - 1)} to ${name(si)}`}</span>
        </span>
        <CloseButton onClick={onClose} />
      </div>
      {groupHead(`${packOf(r).name} pack`, 'Made for this look')}
      <div role="radiogroup" aria-label={`${packOf(r).name} pack`} style={grid}>{pack.map((k) => tile(k, false))}</div>
      {groupHead('Other transitions', 'Work with any look')}
      <div role="radiogroup" aria-label="Other transitions" style={grid}>{other.map((k) => tile(k, true))}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 2 }}>
        <label htmlFor="tp-len" style={{ fontSize: 13, fontWeight: 500, width: 52 }}>Length</label>
        <span style={mono}>0.2 s</span>
        <input id="tp-len" type="range" min={TRANSITION_MIN_MS} max={TRANSITION_MAX_MS} step={50} value={ms} disabled={cur.kind === 'cut'}
          onChange={(e) => set(cur.kind, Number(e.target.value))} style={{ flexGrow: 1, margin: 0, accentColor: 'var(--accent)' }} />
        <span style={mono}>1.0 s</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, minWidth: 46, height: 28, border: '1px solid #E0E0E4', borderRadius: 7, display: 'grid', placeItems: 'center' }}>{`${(ms / 1000).toFixed(1)} s`}</span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer' }}>
        Use for every cut in this clip
        <Toggle on={every} onChange={(on) => { setEvery(on); if (on) set(cur.kind, ms, true); }} />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 10, borderTop: '1px solid #F1F1F3' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>{r.beatSync && <><Note />Beat sync is on: the cut lands on the nearest beat.</>}</span>
        <button type="button" className="btn btn-primary" onClick={onClose} style={{ height: 40, padding: '0 22px', borderRadius: 10, fontWeight: 600 }}>Done</button>
      </div>
      <span aria-hidden="true" style={{ position: 'absolute', left: Math.max(16, Math.min(cx - left - 7, WIDTH - 30)), bottom: -8, width: 14, height: 14, background: 'var(--surface)', borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)', transform: 'rotate(45deg)', visibility: anchor ? 'visible' : 'hidden' }} />
    </div>
  );
}
