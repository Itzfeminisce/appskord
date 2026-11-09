import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cameraLabel } from '@appskord/motion/camera';
import { layerStarts } from '@appskord/motion/choreo';
import { TRANSITION_LABELS, type TransitionId } from '../../lib/look/packs';
import { useEditorV3 } from './context';
import { keyTimes, moveKey, readMotion } from './edits';
import { clipMs, editLayer, sceneStarts, seconds, templateName } from './model';
import { C } from './ui';

// The timeline: the whole clip with its cuts (diamonds open the transition), then the selected scene zoomed in:
// the camera row and one row per layer with its keyframes. Drag a diamond, or use the arrow keys, to move a key.

const ROW = 18;
const NAME_W = 96;
/** Arrow keys move a key this far; Shift moves it ten times as far. */
export const NUDGE_MS = 50;

export function Timeline() {
  const ed = useEditorV3();
  const { state, scene, t, setT } = ed;
  const v3 = state.clip.v3;
  const total = clipMs(v3);
  const starts = sceneStarts(v3);
  const layerAt = layerStarts(scene.layers);
  const lane = useRef<HTMLDivElement>(null);
  const toMs = (clientX: number) => {
    const r = lane.current?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return Math.max(0, Math.min(scene.ms, ((clientX - r.left) / r.width) * scene.ms));
  };
  const pct = (ms: number) => `${(Math.max(0, Math.min(scene.ms, ms)) / scene.ms) * 100}%`;
  const ticks = Array.from({ length: Math.floor(scene.ms / 500) + 1 }, (_, k) => k * 500);
  const move = (layerId: string, from: number, to: number) => {
    const l = scene.layers.find((x) => x.id === layerId);
    if (!l || Math.round(to) === from) return;
    ed.update((st) => editLayer(st, layerId, (x, s) => moveKey(x, from, to, s.ms), { summary: `${ed.name(l)}: ${seconds(from)} → ${seconds(Math.round(to))}` }));
  };
  const drag = (layerId: string, start: number, at: number) => (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const el = e.currentTarget;
    const up = (u: globalThis.PointerEvent) => {
      el.removeEventListener('pointerup', up);
      move(layerId, at, toMs(u.clientX) - start);
    };
    el.addEventListener('pointerup', up);
  };
  const nudge = (layerId: string, at: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = (e.shiftKey ? 10 : 1) * NUDGE_MS;
    if (e.key === 'ArrowLeft') move(layerId, at, at - step);
    else if (e.key === 'ArrowRight') move(layerId, at, at + step);
    else return;
    e.preventDefault();
  };
  return (
    <section aria-label="Timeline" style={{ height: 160, flexShrink: 0, background: C.surface, borderTop: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', padding: '8px 12px', boxSizing: 'border-box', gap: 6, position: 'relative', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: NAME_W, flexShrink: 0, fontSize: 11, color: C.muted }}>{`Whole clip · ${Math.round(total / 1000)} s`}</span>
        <div aria-label={`Scenes: scene ${state.scene + 1} selected. Diamonds: transitions`} style={{ flex: 1, position: 'relative', height: 20, display: 'flex' }}>
          {v3.scenes.map((s, i) => (
            <button key={s.id} type="button" aria-pressed={i === state.scene} onClick={() => ed.select(i)} title={`${i + 1} · ${templateName(s)}`}
              style={{ width: `${(s.ms / total) * 100}%`, height: 20, border: 0, borderRight: '2px solid #FFFFFF', borderRadius: 4, background: i === state.scene ? 'var(--tint-strong, #FCE7F3)' : C.stage, color: C.ink, font: '500 10px/1 inherit', textAlign: 'left', padding: '0 4px', overflow: 'hidden', whiteSpace: 'nowrap', cursor: 'pointer' }}>
              {`${i + 1} · ${templateName(s)}`}
            </button>
          ))}
          {v3.scenes.slice(0, -1).map((s, i) => (
            <button key={`cut-${s.id}`} type="button" aria-label={`Transition into scene ${i + 2}: ${TRANSITION_LABELS[s.transition.kind as TransitionId] ?? s.transition.kind}`}
              onClick={() => ed.setOverlay({ transition: i })}
              style={{ position: 'absolute', left: `calc(${((starts[i + 1] ?? 0) / total) * 100}% - 6px)`, top: 4, width: 12, height: 12, transform: 'rotate(45deg)', border: 0, borderRadius: 2, background: s.transition.kind === 'carry' ? C.accent : '#A1A1AA', cursor: 'pointer' }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: NAME_W, flexShrink: 0, fontSize: 11, fontWeight: 600 }}>{`Scene ${state.scene + 1} · zoomed in`}</span>
        <div ref={lane} onClick={(e) => setT(toMs(e.clientX))} style={{ flex: 1, position: 'relative', height: 14, cursor: 'pointer' }}>
          {ticks.map((ms) => <span key={ms} style={{ position: 'absolute', left: pct(ms), fontSize: 10, color: C.muted, transform: 'translateX(-50%)' }}>{seconds(ms)}</span>)}
          <span aria-hidden="true" style={{ position: 'absolute', left: pct(t), top: 0, width: 2, height: 140, background: C.accent, pointerEvents: 'none' }} />
        </div>
      </div>
      <Row name="Camera">
        <span style={{ position: 'absolute', left: 0, right: 0, top: 3, height: 12, borderRadius: 6, background: '#F4F4F5', fontSize: 10, padding: '0 6px', lineHeight: '12px', color: C.muted }}>
          {cameraLabel(scene.camera.move, scene.camera.amount, ed.look.feel)}
        </span>
      </Row>
      {scene.layers.map((l, i) => {
        const at = layerAt[i] ?? 0;
        const on = l.id === state.layerId;
        const m = readMotion(scene, l);
        const hold = m.hold === 'drift' ? 'Drift · 2 px' : undefined;
        return (
          <Row key={l.id} name={ed.name(l)} on={on} onClick={() => ed.select(state.scene, l.id)}>
            <span style={{ position: 'absolute', left: pct(at), right: 0, top: 4, height: 10, borderRadius: 5, background: on ? 'var(--tint-strong, #FCE7F3)' : '#F4F4F5', fontSize: 9, lineHeight: '10px', padding: '0 14px', color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {[hold, l.carry && state.scene + 1 < v3.scenes.length ? `Carry into scene ${state.scene + 2}` : undefined].filter(Boolean).join(' · ')}
            </span>
            {keyTimes(l).map((k) => (
              <button key={k} type="button" aria-label={`${ed.name(l)} key at ${seconds(k)}`} onPointerDown={drag(l.id, at, k)} onKeyDown={nudge(l.id, k)} onClick={(e) => { e.stopPropagation(); ed.select(state.scene, l.id); }}
                style={{ position: 'absolute', left: `calc(${pct(at + k)} - 5px)`, top: 4, width: 10, height: 10, padding: 0, transform: 'rotate(45deg)', border: 0, borderRadius: 2, background: on ? C.accent : '#A1A1AA', cursor: 'ew-resize', touchAction: 'none' }} />
            ))}
          </Row>
        );
      })}
      <span style={{ fontSize: 10, color: C.muted }}>Pink diamonds: this layer’s keyframes</span>
    </section>
  );
}

function Row({ name, on, onClick, children }: { name: string; on?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: ROW, flexShrink: 0 }}>
      <button type="button" onClick={onClick} disabled={!onClick} style={{ width: NAME_W, flexShrink: 0, textAlign: 'left', border: 0, background: 'transparent', padding: 0, fontSize: 11, fontWeight: on ? 600 : 400, color: on ? C.ink : C.muted, cursor: onClick ? 'pointer' : 'default', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{name}</button>
      <div style={{ flex: 1, position: 'relative', height: ROW }}>{children}</div>
    </div>
  );
}
