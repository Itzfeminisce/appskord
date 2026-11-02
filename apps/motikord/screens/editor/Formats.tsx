import { useEffect, useMemo, useRef, useState } from 'react';
import { restTime, sceneIndex, sceneTitle } from '../../lib/editor/store';
import { templateOf } from '../../lib/editor/v2';
import { safeBox } from '../../lib/render/reflow';
import { getPack, SAFE_AREA } from '../../lib/templates/scenes';
import { check } from '../../lib/checker';
import { drawFrame } from '../../lib/render/drawFrame';
import { useFontTick } from './fontTick';
import type { Aspect, Box } from '../../lib/types';
import Editor, { useEditor } from './Editor';

// Formats frame (All sizes): the three sizes side by side with their status, and "This size only".

const SIZES: { aspect: Aspect; px: string; use: string; useV2: string; w: number; h: number }[] = [
  { aspect: '9:16', px: '1080 × 1920', use: 'Stories, Reels, Shorts, TikTok', useV2: 'Reels, Shorts, TikTok', w: 236, h: 420 },
  { aspect: '1:1', px: '1080 × 1080', use: 'Feeds and posts', useV2: 'Feed posts', w: 340, h: 340 },
  { aspect: '16:9', px: '1920 × 1080', use: 'YouTube, slides, websites', useV2: 'YouTube, slides, web', w: 448, h: 252 },
];

export const toCheckLabel = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'} to check`;

function SizePreview({ aspect, w, h, timeMs, safe }: { aspect: Aspect; w: number; h: number; timeMs?: number; safe?: Box }) {
  const { state, cache } = useEditor();
  const ref = useRef<HTMLCanvasElement>(null);
  const fonts = useFontTick();
  const r = state.clip.recipe;
  // Setting width or height clears the canvas, so it only happens when the size changes.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }, [w, h]);
  // One still frame per size; nothing redraws until the clip or the time changes.
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) drawFrame(ctx, r, aspect, timeMs ?? state.timeMs, cache);
  }, [r, aspect, w, h, timeMs, state.timeMs, cache, fonts]);
  const canvas = <canvas ref={ref} aria-label={aspect} style={{ width: w, height: h, display: 'block', boxShadow: '0 6px 20px rgba(16,16,20,0.12)', background: 'var(--surface)' }} />;
  if (!safe) return canvas;
  return (
    <div style={{ position: 'relative' }}>
      {canvas}
      <span aria-hidden="true" style={{ position: 'absolute', left: safe.x * w, top: safe.y * h, width: safe.w * w, height: safe.h * h, border: '1px dashed rgba(250,204,21,0.5)', pointerEvents: 'none' }} />
    </div>
  );
}

export function FormatsPanel({ onClose }: { onClose: () => void }) {
  const { state, brand, sizeOnly, setSizeOnly, go } = useEditor();
  const r = state.clip.recipe;
  const issues = useMemo(() => check(r, { brand }), [r, brand]);
  const v2 = r.scenes.some((x) => x.template);
  const [si, setSi] = useState(() => Math.max(0, sceneIndex(r, state.sceneId)));
  const n = Math.min(si, r.scenes.length - 1);
  const scene = r.scenes[n];
  const t = templateOf(scene);
  const pack = r.style ? getPack(r.style) : undefined;
  const step = (d: number) => setSi(Math.max(0, Math.min(r.scenes.length - 1, n + d)));
  const arrow = (d: number, label: string, path: string) => (
    <button type="button" aria-label={label} disabled={d < 0 ? n === 0 : n === r.scenes.length - 1} onClick={() => step(d)}
      style={(d < 0 ? n === 0 : n === r.scenes.length - 1)
        ? { width: 32, height: 32, padding: 0, border: '1px solid #DCDCE0', borderRadius: 8, background: '#F6F6F7', color: '#A1A1AA', display: 'grid', placeItems: 'center', cursor: 'not-allowed' }
        : { width: 32, height: 32, padding: 0, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
    </button>
  );
  return (
    <div role="dialog" aria-label={`${r.name} · All sizes`} style={{ position: 'fixed', inset: 0, zIndex: 30, display: 'flex', flexDirection: 'column', background: 'var(--stage)', color: 'var(--ink)' }}>
      <header style={{ height: 52, flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px' }}>
        <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--ink)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round"><path d="M3 8.5h5M2 12h6M3 15.5h5" /><circle cx="15.5" cy="12" r="4.5" fill="var(--accent)" stroke="none" /></svg>
        </span>
        <button type="button" aria-label="Back to the editor" onClick={onClose} style={{ width: 36, height: 36, border: 0, borderRadius: 9, background: 'transparent', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{`${r.name} · All sizes`}</h1>
        <div style={{ flexGrow: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Changes apply to every size unless you choose “This size only”.</span>
        <button type="button" onClick={onClose} style={{ height: 36, padding: '0 16px', border: 0, borderRadius: 9, background: 'var(--ink)', color: '#fff', font: '600 13px/1 var(--font)', cursor: 'pointer' }}>Back to the editor</button>
      </header>
      {v2 && scene && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 16 }}>
          {arrow(-1, 'Previous scene', 'M15 18l-6-6 6-6')}
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{`Scene ${n + 1} of ${r.scenes.length} · ${sceneTitle(scene)}`}</span>
            {t && <span style={{ color: 'var(--muted)' }}>{t.name}</span>}
            {pack && <span style={{ height: 22, padding: '0 8px', borderRadius: 6, background: pack.palette.bg, color: pack.palette.accent, border: '1px solid rgba(16,16,20,0.08)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{pack.name}</span>}
          </span>
          {arrow(1, 'Next scene', 'M9 18l6-6-6-6')}
        </div>
      )}
      <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 48, padding: 24, overflow: 'auto' }}>
        {SIZES.map((s) => {
          const count = issues.filter((i) => i.aspect === s.aspect && (!v2 || i.sceneId === scene?.id)).length;
          return (
            <section key={s.aspect} style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              <SizePreview aspect={s.aspect} w={s.w} h={s.h} timeMs={v2 ? restTime(r, n) : undefined} safe={v2 ? (scene?.template ? SAFE_AREA[s.aspect] : safeBox(s.aspect)) : undefined} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500 }}>{`${s.aspect} · ${s.px}`}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{v2 ? s.useV2 : s.use}</span>
              {count === 0
                ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success-ink)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>Looks good
                  </span>
                )
                : (
                  <button type="button" onClick={() => { onClose(); go('Checker'); }} style={{ height: 26, padding: '0 10px', borderRadius: 13, background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', font: '600 12px/1 var(--font)', color: 'var(--warning-ink)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    {toCheckLabel(count)}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                )}
            </section>
          );
        })}
      </div>
      <div style={{ height: 64, flexShrink: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{v2 ? 'Each template has its own layout per size, so nothing is just cropped. Dashed line: safe area.' : 'The layout moves for each size. It is never just cropped.'}</span>
        <button type="button" role="switch" aria-checked={sizeOnly} onClick={() => setSizeOnly(!sizeOnly)} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 38, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', font: '13px/1 var(--font)', cursor: 'pointer' }}>
          <span aria-hidden="true" style={{ position: 'relative', width: 36, height: 20, borderRadius: 999, background: sizeOnly ? 'var(--accent)' : '#DCDCE0', transition: 'background 150ms', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: 2, left: sizeOnly ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(16,16,20,0.2)', transition: 'left 150ms' }} />
          </span>
          {`This size only (${r.aspect})`}
        </button>
      </div>
    </div>
  );
}

/** Route screen (dev `#/dev/Formats`): the editor with All sizes open. */
export default function Formats() {
  return <Editor open="formats" />;
}
