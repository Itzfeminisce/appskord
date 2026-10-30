import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { clipDuration } from '../../lib/render/drawFrame';
import { getPreset } from '../../lib/render/presets';
import { clockShort, restTime, sceneStart, sceneTitle } from '../../lib/editor/store';
import { dragSpan, layerTiming, sceneLength, sceneTargets, sceneTiming, ticks, tracks, type DragMode, type Span } from '../../lib/editor/timeline';
import type { Credit, LicenceId, Recipe } from '../../lib/types';
import { useEditor } from './Editor';

// Editor frame, bottom: the ruler, scenes, one track per layer and the music track. Drag a bar to move it; drag an edge to trim it.

const LABEL_W = 120;
const EDGE_PX = 6;
const SNAP_PX = 6;
const SCENE_BG = ['var(--tint-strong)', 'var(--warning-bg)', 'var(--stage)'];
const LICENCE: Partial<Record<LicenceId, string>> = { cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA', 'cc-by-nc': 'CC BY-NC' };
const SOURCE: Partial<Record<Credit['source'], string>> = { bundled: 'Bundled', openverse: 'Openverse', pexels: 'Pexels' };

interface Drag {
  kind: 'layer' | 'scene'; si: number; li: number; mode: DragMode; x0: number; moved: boolean;
  span: Span; sceneMs: number; targets: number[]; next?: Span | number;
}
type Draft = { kind: 'layer'; si: number; li: number; span: Span } | { kind: 'scene'; si: number; ms: number };

const presetLabel = (id?: string) => (id ? getPreset(id)?.label ?? id : '');

/** "Sunny morning · Bundled · CC0 · 70%". */
function musicLabel(r: Recipe): string {
  const m = r.music;
  const a = m && r.assets[m.assetId];
  if (!m || !a) return '';
  const c = a.credit;
  return [a.name, c && SOURCE[c.source], c && LICENCE[c.licence], `${Math.round(m.volume * 100)}%`].filter(Boolean).join(' · ');
}

export function Timeline() {
  const { state, edit, select, setTime, playhead, go } = useEditor();
  const r = state.clip.recipe;
  const lane = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLSpanElement>(null);
  const [laneW, setLaneW] = useState(0);
  const [draft, setDraft] = useState<Draft>();
  const drag = useRef<Drag>(undefined);
  const raf = useRef(0);

  useLayoutEffect(() => {
    const el = lane.current;
    if (!el) return;
    const fit = () => setLaneW(el.clientWidth);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A draft scene length shows on the bars at once; the clip only changes when the drag ends.
  const sceneMs = (si: number) => (draft?.kind === 'scene' && draft.si === si ? draft.ms : r.scenes[si]!.durationMs);
  const starts: number[] = [];
  let acc = 0;
  r.scenes.forEach((_s, i) => { starts.push(acc); acc += sceneMs(i); });
  const total = Math.max(acc, clipDuration(r), 1);
  const k = laneW / total;

  // The playhead follows playback on its own frame loop, so the timeline never re-renders per frame.
  const kRef = useRef(k);
  kRef.current = k;
  useEffect(() => {
    let id = 0;
    let last = -1;
    const loop = () => {
      id = requestAnimationFrame(loop);
      const x = Math.round(playhead.current * kRef.current);
      if (x !== last && head.current) { head.current.style.transform = `translateX(${x}px)`; last = x; }
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [playhead]);

  const flush = () => {
    raf.current = 0;
    const d = drag.current;
    if (!d || d.next === undefined) return;
    setDraft(d.kind === 'layer' ? { kind: 'layer', si: d.si, li: d.li, span: d.next as Span } : { kind: 'scene', si: d.si, ms: d.next as number });
  };

  const down = (e: ReactPointerEvent<HTMLElement>, kind: Drag['kind'], si: number, li: number) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fromLeft = e.clientX - rect.left;
    const fromRight = rect.right - e.clientX;
    const scene = r.scenes[si]!;
    const layer = scene.layers[li];
    let mode: DragMode = 'move';
    if (kind === 'scene') mode = fromRight <= EDGE_PX ? 'end' : 'move';
    else if (fromLeft <= EDGE_PX) mode = 'start';
    else if (fromRight <= EDGE_PX) mode = 'end';
    if (kind === 'scene' && mode === 'move') { selectScene(si); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    const local = playhead.current - sceneStart(r, si);
    drag.current = {
      kind, si, li, mode, x0: e.clientX, moved: false, sceneMs: scene.durationMs,
      span: layer ? { startMs: layer.startMs, endMs: layer.endMs } : { startMs: 0, endMs: scene.durationMs },
      targets: [...sceneTargets(r, si, layer?.id), local],
    };
  };

  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || k <= 0) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    const deltaMs = dx / k;
    d.next = d.kind === 'layer'
      ? dragSpan(d.span, d.mode, deltaMs, d.sceneMs, d.targets, SNAP_PX / k)
      : sceneLength(r, d.si, d.sceneMs + deltaMs);
    // One state update per frame at most, however fast the pointer moves.
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };

  const up = () => {
    const d = drag.current;
    drag.current = undefined;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    setDraft(undefined);
    if (!d) return;
    const scene = r.scenes[d.si]!;
    if (!d.moved) {
      if (d.kind === 'layer') selectLayer(d.si, d.li);
      return;
    }
    if (d.kind === 'scene') {
      const e = typeof d.next === 'number' ? sceneTiming(r, d.si, d.next) : undefined;
      if (e) { edit(e); select(scene.id, undefined, restTime(r, d.si)); }
      return;
    }
    const span = d.next && typeof d.next !== 'number' ? d.next : undefined;
    const e = span && layerTiming(r, d.si, d.li, span);
    if (!span || !e) return;
    edit(e);
    // Select the dragged layer at a moment it shows, so the canvas follows the drag.
    select(scene.id, scene.layers[d.li]!.id, showAt(d.si, span));
  };

  const cancel = () => { drag.current = undefined; cancelAnimationFrame(raf.current); raf.current = 0; setDraft(undefined); };

  const selectScene = (si: number) => {
    const scene = r.scenes[si]!;
    select(scene.id, undefined, restTime(r, si));
  };
  /** A time inside the span, as near the scene's resting moment as it allows. */
  const showAt = (si: number, span: Span) => sceneStart(r, si) + Math.max(span.startMs, Math.min(restTime(r, si) - sceneStart(r, si), span.endMs - 1));
  const selectLayer = (si: number, li: number) => {
    const scene = r.scenes[si]!;
    const l = scene.layers[li]!;
    select(scene.id, l.id, showAt(si, l));
  };

  const seek = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || k <= 0) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setTime(Math.max(0, Math.min(x / k, total)));
  };

  const handlers = { onPointerMove: move, onPointerUp: up, onPointerCancel: cancel };
  const music = musicLabel(r);
  const rows = tracks(r);

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '8px 12px 10px', gap: 6, position: 'relative', userSelect: 'none' }}>
      <div style={{ flexShrink: 0, overflow: 'hidden', scrollbarGutter: 'stable', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', paddingLeft: LABEL_W + 8, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--faint)', height: 12 }}>
        <div style={{ position: 'relative', flex: 1 }} onPointerDown={seek}>
          {ticks(total).map((t) => <span key={t} style={{ position: 'absolute', left: t * k, pointerEvents: 'none' }}>{clockShort(t)}</span>)}
        </div>
      </div>
      <Row label="Scenes">
        <div ref={lane} style={{ position: 'relative', flex: 1, height: 30 }} onPointerDown={seek}>
          {r.scenes.map((s, si) => {
            const on = s.id === state.sceneId;
            return (
              <span key={s.id} role="button" tabIndex={0} aria-label={`${si + 1} · ${sceneTitle(s)}`} {...handlers}
                onPointerDown={(e) => down(e, 'scene', si, -1)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectScene(si); } }}
                style={{ position: 'absolute', left: starts[si]! * k + 1, width: Math.max(4, sceneMs(si) * k - 2), height: 30, borderRadius: 6, background: SCENE_BG[si % 3], outline: on ? '1.5px solid var(--accent)' : undefined, outlineOffset: -1.5, fontSize: 12, fontWeight: on ? 600 : 400, display: 'flex', alignItems: 'center', padding: '0 10px 0 8px', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{`${si + 1} · ${sceneTitle(s)}`}</span>
                <span aria-hidden="true" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: EDGE_PX, cursor: 'ew-resize' }} />
              </span>
            );
          })}
        </div>
      </Row>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((t) => {
          const mine = t.bars.some((b) => b.layer.id === state.layerId && r.scenes[b.si]!.id === state.sceneId);
          return (
            <Row key={t.name} label={t.name} strong={mine}>
              <div style={{ position: 'relative', flex: 1, height: 24 }} onPointerDown={seek}>
                {t.bars.map(({ si, li, layer }) => {
                  const span = draft?.kind === 'layer' && draft.si === si && draft.li === li ? draft.span : { startMs: layer.startMs, endMs: Math.min(layer.endMs, sceneMs(si)) };
                  const on = layer.id === state.layerId && r.scenes[si]!.id === state.sceneId;
                  const media = layer.type === 'image' || layer.type === 'video';
                  const text = on ? undefined : media ? [r.assets[layer.assetId]?.name ?? layer.name, presetLabel(layer.during?.preset)].filter(Boolean).join(' · ') : undefined;
                  const bg = on ? 'var(--accent)' : media ? 'var(--warning-line)' : mine ? 'var(--tint-strong)' : layer.type === 'text' ? 'var(--line)' : 'var(--line-strong)';
                  const style: CSSProperties = {
                    position: 'absolute', left: (starts[si]! + span.startMs) * k, width: Math.max(6, (span.endMs - span.startMs) * k), height: 24, borderRadius: 6,
                    background: bg, color: on ? '#fff' : 'var(--ink)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 8px', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', cursor: layer.locked ? 'default' : 'grab', touchAction: 'none',
                  };
                  return (
                    <span key={layer.id} role="button" tabIndex={0} aria-label={`${layer.name}, scene ${si + 1}`} aria-pressed={on} style={style} {...handlers}
                      onPointerDown={(e) => (layer.locked ? selectLayer(si, li) : down(e, 'layer', si, li))}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLayer(si, li); } }}>
                      <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: EDGE_PX, cursor: 'ew-resize' }} />
                      {on ? <><span>{presetLabel(layer.in?.preset)}</span><span>{presetLabel(layer.out?.preset)}</span></> : text && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{text}</span>}
                      <span aria-hidden="true" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: EDGE_PX, cursor: 'ew-resize' }} />
                    </span>
                  );
                })}
              </div>
            </Row>
          );
        })}
        <Row label="Music">
          <button type="button" onClick={() => go('Music')}
            style={{ flex: 1, height: 24, border: 0, borderRadius: 6, background: 'var(--stage)', color: 'var(--ink)', font: '11px/1 var(--font)', textAlign: 'left', padding: '0 8px', cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {music}
          </button>
        </Row>
      </div>
      <span ref={head} aria-hidden="true" style={{ position: 'absolute', left: 12 + LABEL_W + 8 - 1, top: 8, bottom: 8, width: 2, background: 'var(--ink)', pointerEvents: 'none', willChange: 'transform' }} />
    </div>
  );
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <span style={{ width: LABEL_W, flexShrink: 0, fontSize: 12, fontWeight: strong ? 600 : 400, color: strong ? 'var(--ink)' : 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {children}
    </div>
  );
}
