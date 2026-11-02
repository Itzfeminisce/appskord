import { useEffect, useRef, useState } from 'react';
import { clock, sceneIndex, sceneStart } from '../../lib/editor/store';
import { clipDuration } from '../../lib/render/drawFrame';
import { useEditor } from './Editor';
import { PlayIcon } from './StatesEditor';

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

  // "Play scene {n}" plays the selected scene once and stops at its end.
  const r = state.clip.recipe;
  const si = Math.max(0, sceneIndex(r, state.sceneId ?? ''));
  const [until, setUntil] = useState<number>();
  const toggle = () => { setUntil(undefined); play(!state.playing); };
  const playScene = () => {
    const from = sceneStart(r, si);
    setTime(from);
    setUntil(from + (r.scenes[si]?.durationMs ?? 0));
    play(true);
  };
  useEffect(() => {
    if (until === undefined) return;
    if (!state.playing) { setUntil(undefined); return; }
    let raf = 0;
    const watch = () => {
      if (playhead.current >= until - 20) { play(false); setTime(Math.max(0, until - 1)); setUntil(undefined); return; }
      raf = requestAnimationFrame(watch);
    };
    raf = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(raf);
  }, [until, state.playing, playhead, play, setTime]);

  return (
    <div data-transport style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <button type="button" aria-label={state.playing ? 'Pause' : 'Play'} onClick={toggle} style={{ width: 34, height: 34, border: 0, borderRadius: '50%', background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
        <PlayIcon playing={state.playing} />
      </button>
      {r.scenes.length > 1 && (
        <button type="button" aria-label="Play this scene" title={`Play scene ${si + 1}`} onClick={playScene} style={{ height: 34, padding: '0 12px', border: '1px solid #E0E0E4', borderRadius: 999, background: 'var(--surface)', color: 'var(--ink)', font: '500 12px/1 var(--font)', cursor: 'pointer' }}>
          {`Play scene ${si + 1}`}
        </button>
      )}
      <span ref={label} style={{ fontFamily: 'var(--mono)', fontSize: 12, minWidth: 116 }}>{`${clock(state.timeMs)} / ${clock(total)}`}</span>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Dashed line: safe area</span>
    </div>
  );
}
