import { useEffect, useRef } from 'react';
import { clock } from '../../lib/editor/store';
import { clipDuration } from '../../lib/render/drawFrame';
import { useEditor } from './Editor';

export function Transport() {
  const { state, playhead, play, setTime } = useEditor();
  const total = clipDuration(state.clip.recipe);
  const label = useRef<HTMLSpanElement>(null);

  // While playing, the canvas moves the playhead; this only repaints the time text.
  useEffect(() => {
    if (!state.playing) return;
    let raf = 0;
    const tick = () => {
      if (label.current) label.current.textContent = `${clock(playhead.current)} / ${clock(total)}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.playing, playhead, total]);

  const toggle = () => {
    if (!state.playing && state.timeMs >= total - 1) setTime(0);
    play(!state.playing);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <button type="button" aria-label="Play" aria-pressed={state.playing} onClick={toggle} style={{ width: 34, height: 34, border: 0, borderRadius: '50%', background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
        {state.playing
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>}
      </button>
      <span ref={label} style={{ fontFamily: 'var(--mono)', fontSize: 12, minWidth: 116 }}>{`${clock(state.timeMs)} / ${clock(total)}`}</span>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Dashed line: safe area</span>
    </div>
  );
}
