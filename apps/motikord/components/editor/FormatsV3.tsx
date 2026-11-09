import { useEffect, useMemo, useRef, useState } from 'react';
import { fontUrl } from '@appskord/motion/assets';
import { CAMERA_LABELS } from '@appskord/motion/camera';
import { V3Renderer } from '@appskord/motion/renderer';
import type { SceneV3 } from '@appskord/motion/types';
import { check } from '../../lib/checker';
import { boxFor } from '../../lib/render/reflow';
import { SAFE_AREA } from '../../lib/templates/scenes';
import type { Aspect, Box, Issue } from '../../lib/types';
import { toCheckLabel } from '../../screens/editor/Formats';
import { useEditorV3 } from './context';
import type { ChromeGo } from './EditorV3';
import { clipMs, clockTenths, layerContent, sceneStarts, sceneTitle, templateName } from './model';
import { setSizeV3 } from './prompt';
import { previewSize, useGl } from './Stage';
import { C } from './ui';

// FormatsV3 (All sizes for v3 clips): each size draws the v3 scene live with packages/motion's V3Renderer.

export const SIZES_V3: readonly { aspect: Aspect; px: string; use: string; w: number; h: number }[] = [
  { aspect: '9:16', px: '1080 × 1920', use: 'Reels, Shorts, TikTok', w: 209, h: 372 },
  { aspect: '1:1', px: '1080 × 1080', use: 'Feed posts', w: 372, h: 372 },
  { aspect: '16:9', px: '1920 × 1080', use: 'YouTube, slides, web', w: 661, h: 372 },
];
export const FORMATS_NOTE = 'Each template has its own layout per size, so nothing is just cropped. Motion, camera and depth are set for each size too. Dashed line: safe area.';

/** "Push in · 3 depth layers". */
export const depthLine = (s: SceneV3) => `${CAMERA_LABELS[s.camera.move]} · ${new Set(s.layers.map((l) => l.depth)).size} depth layers`;

/** The longest a frame may advance the Play-all clock: a hidden tab does not jump it. */
export const MAX_TICK_MS = 100;

/** A still inside the scene where its layers have come in, as v2's All sizes shows. */
const restMs = (s: SceneV3) => Math.min(1800, Math.floor(s.ms / 2));

function SizeView({ aspect, w, h, sceneIndex, t, faults }: { aspect: Aspect; w: number; h: number; sceneIndex: number; t: number; faults: Box[] }) {
  const ed = useEditorV3();
  const { state, look } = ed;
  const v3 = state.clip.v3;
  const scene = v3.scenes[sceneIndex]!;
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const gl = useGl(canvas);
  const view = useRef<V3Renderer | undefined>(undefined);
  const shownT = useRef(t);
  // A rebuild on a scene boundary draws at the current t, not the one the last render left.
  shownT.current = t;
  const size = useMemo(() => previewSize(aspect), [aspect]);
  const contentKey = JSON.stringify(scene.layers.map((l) => [l.id, layerContent(state.clip, sceneIndex, l) ?? null]));
  const contents = useMemo(() => new Map(JSON.parse(contentKey) as [string, ReturnType<typeof layerContent> | null][]), [contentKey]);
  useEffect(() => {
    if (!gl) return;
    let next: V3Renderer | undefined;
    let current = true;
    try {
      next = new V3Renderer(scene, { ...size, quality: 'reduced', fps: v3.fps, fontUrl, finish: v3.finish, effects: v3.effects ?? [], look, content: (l) => contents.get(l.id) ?? undefined });
      next.attach(gl);
      next.render(shownT.current);
      const drawn = next;
      void drawn.ready().then(() => { if (current) drawn.render(shownT.current); });
    } catch (error) {
      console.error('Motikord: could not draw the scene', error);
    }
    view.current = next;
    return () => {
      current = false;
      next?.dispose();
    };
  }, [gl, scene, contents, size, v3.fps, v3.finish, v3.effects, look]);
  useEffect(() => {
    shownT.current = t;
    try {
      view.current?.render(t);
    } catch (error) {
      console.error('Motikord: could not draw the scene', error);
    }
  }, [t]);
  const safe = SAFE_AREA[aspect];
  return (
    <div style={{ position: 'relative', width: w, height: h, flexShrink: 0, borderRadius: 4, boxShadow: '0 14px 36px rgba(16,16,20,0.22), 0 1px 3px rgba(16,16,20,0.1)', overflow: 'hidden', background: look.palette[0] ?? '#0B0B10' }}>
      <canvas ref={setCanvas} role="img" aria-label={aspect} style={{ width: '100%', height: '100%', display: 'block' }} />
      <span aria-hidden="true" style={{ position: 'absolute', left: safe.x * w, top: safe.y * h, width: safe.w * w, height: safe.h * h, boxSizing: 'border-box', border: '1px dashed rgba(139,156,255,0.32)', pointerEvents: 'none' }} />
      {faults.map((b, i) => (
        <span key={i} data-fault aria-hidden="true" style={{ position: 'absolute', left: b.x * w, top: b.y * h, width: b.w * w, height: b.h * h, borderRadius: 16, outline: '1.5px dashed #F59E0B', pointerEvents: 'none' }} />
      ))}
    </div>
  );
}

export function FormatsV3({ go }: { go?: (to: ChromeGo) => void }) {
  const ed = useEditorV3();
  const { state, pack } = ed;
  const r = state.clip.recipe;
  const v3 = state.clip.v3;
  const starts = useMemo(() => sceneStarts(v3), [v3]);
  const total = clipMs(v3);
  const [n, setN] = useState(() => Math.min(state.scene, v3.scenes.length - 1));
  const scene = v3.scenes[Math.min(n, v3.scenes.length - 1)]!;
  const si = Math.min(n, v3.scenes.length - 1);
  const [playing, setPlaying] = useState(false);
  const [playAt, setPlayAt] = useState(0);
  const at = playing ? playAt : (starts[si] ?? 0) + restMs(scene);
  const issues = useMemo(() => check(r), [r]);

  // Play all three: one clock for the three sizes, through the clip; the stepper follows the scene playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let now = 0;
    const tick = (time: number) => {
      now = Math.min(total, now + Math.min(MAX_TICK_MS, time - last));
      last = time;
      let i = 0;
      while (i + 1 < starts.length && starts[i + 1]! <= now) i++;
      setN(i);
      setPlayAt(now);
      if (now >= total) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, starts, total]);

  const step = (d: number) => { setPlaying(false); setN(Math.max(0, Math.min(v3.scenes.length - 1, si + d))); };
  const arrow = (d: number, label: string, path: string) => {
    const off = d < 0 ? si === 0 : si === v3.scenes.length - 1;
    return (
      <button type="button" aria-label={label} disabled={off} onClick={() => step(d)}
        style={{ width: 30, height: 30, padding: 0, border: '1px solid #E0E0E4', borderRadius: 8, background: off ? '#F6F6F7' : C.surface, color: off ? '#A1A1AA' : C.ink, display: 'grid', placeItems: 'center', cursor: off ? 'not-allowed' : 'pointer' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
      </button>
    );
  };
  const v2 = r.scenes[si];
  const faultsFor = (aspect: Aspect, found: Issue[]): Box[] =>
    found.flatMap((i) => {
      const l = v2?.layers.find((x) => x.id === i.layerId);
      return l && v2 ? [boxFor(l, aspect, r.aspect, v2.layout)] : [];
    });
  return (
    <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', padding: '18px 24px 16px', gap: 14, background: '#EDEDF0', minHeight: 0, boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>{`${r.name} · All sizes`}</h1>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Changes apply to every size unless you choose “This size only”.</p>
        </div>
        <button type="button" onClick={() => ed.setOverlay(undefined)} style={{ height: 36, padding: '0 14px', border: 0, borderRadius: 9, background: '#111114', color: '#FFFFFF', font: `600 13px/1 ${C.font}`, cursor: 'pointer', whiteSpace: 'nowrap' }}>Back to the editor</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {arrow(-1, 'Previous scene', 'M15 18l-6-6 6-6')}
        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{`Scene ${si + 1} of ${v3.scenes.length} · ${sceneTitle(state.clip, si)}`}</span>
        {arrow(1, 'Next scene', 'M9 18l6-6-6-6')}
        {templateName(scene) && <span style={{ height: 24, padding: '0 8px', borderRadius: 6, background: '#FDF2F8', color: '#9D174D', fontSize: 12, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{templateName(scene)}</span>}
        <span style={{ height: 24, padding: '0 8px', borderRadius: 6, background: C.surface, border: '1px solid #E0E0E4', color: C.ink, fontSize: 12, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', boxSizing: 'border-box' }}>{ed.look.name || pack.name}</span>
        <span style={{ flexGrow: 1 }} />
        <button type="button" aria-pressed={playing} onClick={() => { if (!playing) { setPlayAt(0); setN(0); } setPlaying(!playing); }}
          style={{ height: 34, padding: '0 14px 0 10px', border: 0, borderRadius: 999, background: '#111114', color: '#FFFFFF', font: `600 12px/1 ${C.font}`, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4.5v15l13-7.5z" />}</svg>Play all three
        </button>
        <span style={{ fontFamily: C.mono, fontSize: 12 }}>{`${clockTenths(at)} / ${clockTenths(total)}`}</span>
      </div>
      <div style={{ flexGrow: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 24, paddingTop: 6 }}>
        {SIZES_V3.map((s) => {
          const found = issues.filter((i) => i.aspect === s.aspect && i.sceneId === scene.id);
          const on = r.aspect === s.aspect;
          return (
            <figure key={s.aspect} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10, width: s.w }}>
              <div role="button" tabIndex={0} aria-pressed={on} aria-label={s.aspect} onClick={() => ed.update((st) => setSizeV3(st, s.aspect))}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ed.update((st) => setSizeV3(st, s.aspect)); } }}
                style={{ borderRadius: 4, outline: on ? '2px solid #BE185D' : 'none', outlineOffset: 6, cursor: 'pointer' }}>
                <SizeView aspect={s.aspect} w={s.w} h={s.h} sceneIndex={si} t={at - (starts[si] ?? 0)} faults={faultsFor(s.aspect, found)} />
              </div>
              <figcaption style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>{`${s.aspect} · ${s.px}`}</span>
                <span style={{ fontSize: 12, color: C.muted }}>{s.use}</span>
                <span style={{ fontFamily: C.mono, fontSize: 11, color: '#6E7079' }}>{depthLine(scene)}</span>
                <span style={{ marginTop: 4 }}>
                  {found.length === 0
                    ? <span style={{ height: 24, padding: '0 9px', borderRadius: 999, background: '#F0FDF4', color: '#15803D', fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>Looks good</span>
                    : (
                      <button type="button" onClick={() => go?.('check')} style={{ height: 24, padding: '0 9px', border: 0, borderRadius: 999, background: '#FFFBEB', color: '#92400E', font: `500 12px/1 ${C.font}`, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                        {toCheckLabel(found.length)}
                      </button>
                    )}
                </span>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 12, borderTop: '1px solid #DCDCE0' }}>
        <span style={{ fontSize: 12, color: C.muted }}>{FORMATS_NOTE}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer' }}>
          <input type="checkbox" role="switch" checked={ed.sizeOnly} onChange={(e) => ed.setSizeOnly(e.currentTarget.checked)} style={{ width: 34, height: 20, margin: 0, accentColor: '#BE185D' }} />
          {`This size only (${r.aspect})`}
        </label>
      </div>
    </main>
  );
}
