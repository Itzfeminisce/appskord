import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fontUrl } from '@appskord/motion/assets';
import { createCanvasRenderer, V3Renderer, type LayerContent } from '@appskord/motion/renderer';
import { EFFECTS_NOTE, effectEntry } from '@appskord/motion/effects';
import type { LayerV3 } from '@appskord/motion/types';
import type { Aspect } from '../../lib/types';
import { useEditorV3 } from './context';
import { motionLine, similarLayers, readMotion, writeMotion } from './edits';
import { clipMs, clockTenths, editScenes, layerContent, posterMs, sceneStarts } from './model';
import { C, quietButton } from './ui';

// The stage: the scene drawn by packages/motion at reduced quality, the selected layer's line and the transport.

export const PREVIEW = { width: 1080, height: 1920 } as const;
/** The preview canvas for the clip's size, at the same long side as 9:16. */
export function previewSize(aspect: Aspect): { width: number; height: number } {
  if (aspect === '1:1') return { width: PREVIEW.width, height: PREVIEW.width };
  if (aspect === '16:9') return { width: PREVIEW.height, height: PREVIEW.width };
  return PREVIEW;
}
export const SHOW_DEPTH = 'Show depth';
export const SHOW_DEPTH_LINE = 'Pulls the layers apart so you can see what moves. Turn off to see the camera’s view.';
export const LOWER_3D = 'Your computer previews 3D at lower quality. Export is always full quality.';

/** One WebGL renderer per canvas; undefined where WebGL is missing (tests, a blocked GPU). */
type Gl = ReturnType<typeof createCanvasRenderer>;
export function useGl(canvas: HTMLCanvasElement | null): Gl | undefined {
  const [gl, setGl] = useState<Gl>();
  useEffect(() => {
    if (!canvas) return;
    let r: Gl | undefined;
    try {
      r = createCanvasRenderer(canvas);
      setGl(r);
    } catch (error) {
      console.error('Motikord: could not start the preview', error);
    }
    return () => {
      // Hand the GPU context back now rather than when the canvas is collected.
      r?.forceContextLoss();
      r?.dispose();
    };
  }, [canvas]);
  return gl;
}

const toolButton = (dark: boolean) => ({ height: 34, padding: '0 12px', border: dark ? 0 : '1px solid #E0E0E4', borderRadius: 9, background: dark ? '#111114' : C.surface, color: dark ? '#FFFFFF' : C.ink, font: `${dark ? 600 : 500} 12px/1 ${C.font}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' as const, flexShrink: 0 });

/** `toast` takes the play row's place while it shows (EditPromptV3). */
export function Stage({ preview, prompt, toast }: { preview?: { effect: string }; prompt?: ReactNode; toast?: ReactNode }) {
  const ed = useEditorV3();
  const { state, scene, layer, look, t, setT, playing, setPlaying, spread } = ed;
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const gl = useGl(canvas);
  const view = useRef<V3Renderer | undefined>(undefined);
  const v3 = state.clip.v3;
  const starts = useMemo(() => sceneStarts(v3), [v3]);
  const total = clipMs(v3);
  const aspect = state.clip.recipe.aspect;
  const size = useMemo(() => previewSize(aspect), [aspect]);
  const previewUses = useMemo(
    () => (preview && layer ? [{ effect: preview.effect as never, amount: effectEntry(preview.effect as never).amount, scope: 'layer' as const, sceneId: scene.id, layerId: layer.id }] : []),
    [preview, layer, scene.id],
  );

  // What each layer draws comes from the v2 layers (text, fill, size); a string key rebuilds only when it changes.
  const contentKey = JSON.stringify(scene.layers.map((l) => [l.id, layerContent(state.clip, state.scene, l) ?? null]));
  const contents = useMemo(() => new Map(JSON.parse(contentKey) as [string, LayerContent | null][]), [contentKey]);
  // Paused at a scene's start nothing has come in yet, so the stage shows the scene's key frame instead of an empty frame.
  const drawT = !playing && t === 0 ? posterMs(scene, (l) => contents.get(l.id)?.text) : t;
  const shownT = useRef(drawT);

  useEffect(() => {
    if (!gl) return;
    let next: V3Renderer | undefined;
    let current = true;
    try {
      next = new V3Renderer(scene, {
        ...size,
        quality: 'reduced',
        fps: v3.fps,
        fontUrl,
        finish: v3.finish,
        effects: [...(v3.effects ?? []), ...previewUses],
        look,
        spread,
        content: (l) => contents.get(l.id) ?? undefined,
      });
      next.attach(gl);
      next.render(shownT.current);
      // Text typesets asynchronously; draw again once it has, at whatever t is showing by then.
      const drawn = next;
      void drawn.ready().then(() => {
        if (current) drawn.render(shownT.current);
      });
    } catch (error) {
      console.error('Motikord: could not draw the scene', error);
    }
    view.current = next;
    return () => {
      current = false;
      next?.dispose();
    };
    // t is drawn by the effect below; rebuilding is only for recipe, content and look changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, contents, v3.finish, v3.effects, v3.fps, look, spread, previewUses, size]);

  useEffect(() => {
    shownT.current = drawT;
    try {
      const v = view.current;
      v?.render(drawT);
      // A count re-typesets its number as t moves: draw again once it has, if t is still showing.
      void v?.ready().then(() => {
        if (view.current === v && shownT.current === drawT) v.render(drawT);
      });
    } catch (error) {
      console.error('Motikord: could not draw the scene', error);
    }
  }, [drawT]);

  // Playback: the clip runs through its scenes; "Play scene N" stops at the scene's end.
  const [sceneOnly, setSceneOnly] = useState(false);
  // The loop reads the newest timing and editor, not the ones from when Play was pressed.
  const live = useRef({ starts, total, ed });
  useEffect(() => { live.current = { starts, total, ed }; });
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let shown = state.scene;
    const from = live.current.starts[shown] ?? 0;
    const sceneEnd = from + scene.ms;
    let at = from + t;
    const tick = (now: number) => {
      const { starts, total, ed } = live.current;
      at += now - last;
      last = now;
      const end = sceneOnly ? sceneEnd : total;
      const done = at >= end;
      if (done) at = end;
      let i = 0;
      // At the very end, stay on the scene that just finished.
      while (i + 1 < starts.length && (done ? starts[i + 1]! < at : starts[i + 1]! <= at)) i++;
      if (i !== shown) {
        shown = i;
        ed.select(i);
      }
      setT(at - (starts[i] ?? 0));
      if (done) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, sceneOnly]);

  const similar = layer ? similarLayers(v3.scenes, state.scene, layer) : [];
  const copyMotion = () => {
    if (!layer) return;
    const spec = readMotion(scene, layer);
    ed.update((st) =>
      editScenes(
        st,
        (scenes) => {
          for (const { scene: si, id } of similar) {
            const s = scenes[si]!;
            const j = s.layers.findIndex((l) => l.id === id);
            s.layers[j] = writeMotion(s, s.layers[j]!, { ...spec, out: spec.out === 'carry' ? 'none' : spec.out });
          }
        },
        { summary: `${ed.name(layer)}: Copy motion to similar layers` },
      ),
    );
  };
  const has3d = scene.layers.some((l: LayerV3) => l.tracks.extrude?.some((k) => k.v > 0));
  const at = (starts[state.scene] ?? 0) + t;
  const changedLayer = ed.changed?.scene === state.scene ? scene.layers.find((l) => l.id === ed.changed!.layerId) : undefined;

  return (
    <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '12px 20px 10px', background: C.stage, minWidth: 0, gap: 10, position: 'relative' }}>
      {layer && (
        <div style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ height: 34, padding: '0 10px', boxSizing: 'border-box', borderRadius: 9, background: C.surface, border: '1px solid #E0E0E4', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden' }}>
            <i aria-hidden="true" style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 2, background: '#BE185D' }} />
            <span style={{ fontWeight: 600 }}>{ed.name(layer)}</span>
            <span style={{ fontFamily: C.mono, fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis' }}>{motionLine(scene, layer)}</span>
          </span>
          <span style={{ flexGrow: 1 }} />
          <button type="button" style={toolButton(true)} onClick={() => ed.setOverlay('animate')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F9A8D4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>Animate this layer
          </button>
          {similar.length > 0 && (
            <button type="button" style={toolButton(false)} onClick={copyMotion}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
              Copy motion to similar layers <span style={{ minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 9, background: '#F1F1F3', fontFamily: C.mono, fontSize: 10, color: C.muted, display: 'grid', placeItems: 'center' }}>{similar.length}</span>
            </button>
          )}
        </div>
      )}
      {state.tab === 'scene' && (
        <label style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <input type="checkbox" aria-label={SHOW_DEPTH} checked={spread} onChange={(e) => ed.setSpread(e.currentTarget.checked)} />
          <span style={{ fontWeight: 600 }}>{SHOW_DEPTH}</span>
          <span style={{ color: C.muted }}>{SHOW_DEPTH_LINE}</span>
        </label>
      )}
      {has3d && <div role="status" style={{ fontSize: 12, color: C.muted }}>{LOWER_3D}</div>}
      {preview && (
        <div style={{ fontSize: 12, color: C.muted }}>
          {`Previewing ${effectEntry(preview.effect as never).name}`}
        </div>
      )}
      {/* The stage fits inside the space left, at the clip's own shape: never stretched to fill it. */}
      <div style={{ flex: 1, minHeight: 0, alignSelf: 'stretch', containerType: 'size', display: 'grid', placeItems: 'center' }}>
      <div style={{ position: 'relative', width: `min(100cqw, 100cqh * ${size.width} / ${size.height})`, aspectRatio: `${size.width} / ${size.height}`, borderRadius: 4, overflow: 'hidden', background: look.palette[0] ?? '#0B0B10', boxShadow: '0 14px 36px rgba(16,16,20,0.22), 0 1px 3px rgba(16,16,20,0.1)' }}>
        <canvas ref={setCanvas} role="img" aria-label={`Scene ${state.scene + 1} of ${state.clip.recipe.name}`} style={{ width: '100%', height: '100%', display: 'block' }} />
        {changedLayer && (
          <span style={{ position: 'absolute', left: 8, top: 8, height: 18, padding: '0 6px', borderRadius: 4, background: '#BE185D', color: '#FFFFFF', fontFamily: C.mono, fontSize: 10, display: 'flex', alignItems: 'center' }}>
            {`${ed.name(changedLayer)} · changed`}
          </span>
        )}
        {preview && layer && (
          <span style={{ position: 'absolute', left: 8, bottom: 8, fontSize: 11, padding: '3px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.9)', color: C.ink }}>
            {`${effectEntry(preview.effect as never).name} · preview · not added yet`}
          </span>
        )}
      </div>
      </div>
      {preview && <div style={{ fontSize: 11, color: C.muted }}>{EFFECTS_NOTE}</div>}
      {toast}
      <div style={{ display: toast ? 'none' : 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => {
          setSceneOnly(false);
          if (!playing && at >= total) {
            // Play at the end starts the clip over.
            ed.select(0);
            setT(0);
          }
          setPlaying(!playing);
        }}
          style={{ width: 34, height: 34, borderRadius: '50%', border: 0, background: C.ink, color: '#FFFFFF', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4v16l13-8z" />}</svg>
        </button>
        <button type="button" title={`Play scene ${state.scene + 1}`} style={{ ...quietButton, height: 34, padding: '0 12px', border: '1px solid #E0E0E4', borderRadius: 999, fontWeight: 400 }} onClick={() => { setT(0); setSceneOnly(true); setPlaying(true); }}>
          {`Play scene ${state.scene + 1}`}
        </button>
        <span style={{ fontFamily: C.mono, fontSize: 12, color: C.ink }}>{`${clockTenths(at)} / ${clockTenths(total)}`}</span>
        {layer && <span style={{ fontSize: 12, color: C.muted }}>Pink diamonds: this layer’s keyframes</span>}
      </div>
      {prompt}
    </main>
  );
}
