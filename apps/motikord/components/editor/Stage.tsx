import { useEffect, useMemo, useRef, useState } from 'react';
import { fontUrl } from '@appskord/motion/assets';
import { createCanvasRenderer, V3Renderer } from '@appskord/motion/renderer';
import { EFFECTS_NOTE, effectEntry } from '@appskord/motion/effects';
import type { LayerV3 } from '@appskord/motion/types';
import { useEditorV3 } from './context';
import { motionLine, similarLayers, readMotion, writeMotion } from './edits';
import { clipMs, clockTenths, editScenes, sceneStarts } from './model';
import { C, quietButton } from './ui';

// The stage: the scene drawn by packages/motion at reduced quality, the selected layer's line and the transport.

export const PREVIEW = { width: 1080, height: 1920 } as const;
export const SHOW_DEPTH = 'Show depth';
export const SHOW_DEPTH_LINE = 'Pulls the layers apart so you can see what moves. Turn off to see the camera’s view.';
export const LOWER_3D = 'Your computer previews 3D at lower quality. Export is always full quality.';

/** One WebGL renderer per canvas; undefined where WebGL is missing (tests, a blocked GPU). */
type Gl = ReturnType<typeof createCanvasRenderer>;
function useGl(canvas: HTMLCanvasElement | null): Gl | undefined {
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
    return () => r?.dispose();
  }, [canvas]);
  return gl;
}

export function Stage({ preview }: { preview?: { effect: string } }) {
  const ed = useEditorV3();
  const { state, scene, layer, look, t, setT, playing, setPlaying, spread } = ed;
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const gl = useGl(canvas);
  const view = useRef<V3Renderer | undefined>(undefined);
  const v3 = state.clip.v3;
  const starts = useMemo(() => sceneStarts(v3), [v3]);
  const total = clipMs(v3);
  const previewUses = useMemo(
    () => (preview && layer ? [{ effect: preview.effect as never, amount: effectEntry(preview.effect as never).amount, scope: 'layer' as const, sceneId: scene.id, layerId: layer.id }] : []),
    [preview, layer, scene.id],
  );

  useEffect(() => {
    if (!gl) return;
    let next: V3Renderer | undefined;
    try {
      next = new V3Renderer(scene, {
        ...PREVIEW,
        quality: 'reduced',
        fps: v3.fps,
        fontUrl,
        finish: v3.finish,
        effects: [...(v3.effects ?? []), ...previewUses],
        look,
        spread,
        content: (l) => (l.kind === 'text' ? { text: ed.text(l) ?? '' } : undefined),
      });
      next.attach(gl);
      next.render(t);
    } catch (error) {
      console.error('Motikord: could not draw the scene', error);
    }
    view.current = next;
    return () => next?.dispose();
    // t is drawn by the effect below; rebuilding is only for recipe and look changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, v3.finish, v3.effects, v3.fps, look, spread, previewUses]);

  useEffect(() => {
    try {
      view.current?.render(t);
    } catch (error) {
      console.error('Motikord: could not draw the scene', error);
    }
  }, [t]);

  // Playback: the clip runs through its scenes; "Play scene N" stops at the scene's end.
  const [sceneOnly, setSceneOnly] = useState(false);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let at = (starts[state.scene] ?? 0) + t;
    const tick = (now: number) => {
      at += now - last;
      last = now;
      const end = sceneOnly ? (starts[state.scene] ?? 0) + scene.ms : total;
      if (at >= end) {
        setPlaying(false);
        return;
      }
      let i = 0;
      while (i + 1 < starts.length && starts[i + 1]! <= at) i++;
      if (i !== state.scene) ed.select(i);
      setT(at - (starts[i] ?? 0));
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

  return (
    <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '12px 20px 10px', background: C.stage, minWidth: 0, gap: 10, position: 'relative' }}>
      {layer && (
        <div style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{ed.name(layer)}</span>
            <span style={{ fontSize: 12, color: C.muted }}>{motionLine(scene, layer)}</span>
          </span>
          <button type="button" style={quietButton} onClick={() => ed.setOverlay('animate')}>Animate this layer</button>
          {similar.length > 0 && (
            <button type="button" style={quietButton} onClick={copyMotion}>
              Copy motion to similar layers <span style={{ marginLeft: 4, fontWeight: 600, color: C.accent }}>{similar.length}</span>
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
      <div style={{ position: 'relative', flex: 1, minHeight: 0, aspectRatio: '9 / 16', maxWidth: '100%', borderRadius: 10, overflow: 'hidden', background: look.palette[0] ?? '#0B0B10', boxShadow: '0 1px 3px rgba(16,16,20,0.12)' }}>
        <canvas ref={setCanvas} role="img" aria-label={`Scene ${state.scene + 1} of ${state.clip.recipe.name}`} style={{ width: '100%', height: '100%', display: 'block' }} />
        {preview && layer && (
          <span style={{ position: 'absolute', left: 8, bottom: 8, fontSize: 11, padding: '3px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.9)', color: C.ink }}>
            {`${effectEntry(preview.effect as never).name} · preview · not added yet`}
          </span>
        )}
      </div>
      {preview && <div style={{ fontSize: 11, color: C.muted }}>{EFFECTS_NOTE}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { setSceneOnly(false); setPlaying(!playing); }}
          style={{ width: 32, height: 32, borderRadius: 16, border: 0, background: C.ink, color: '#FFFFFF', cursor: 'pointer' }}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" title={`Play scene ${state.scene + 1}`} style={quietButton} onClick={() => { setT(0); setSceneOnly(true); setPlaying(true); }}>
          {`Play scene ${state.scene + 1}`}
        </button>
        <span style={{ fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{`${clockTenths(at)} / ${clockTenths(total)}`}</span>
      </div>
    </main>
  );
}
