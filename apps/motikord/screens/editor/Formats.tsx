import { useEffect, useMemo, useRef } from 'react';
import { check } from '../../lib/checker';
import { drawFrame } from '../../lib/render/drawFrame';
import type { Aspect } from '../../lib/types';
import Editor, { useEditor } from './Editor';

// Formats frame (All sizes): the three sizes side by side with their status, and "This size only".

const SIZES: { aspect: Aspect; px: string; use: string; w: number; h: number }[] = [
  { aspect: '9:16', px: '1080 × 1920', use: 'Stories, Reels, Shorts, TikTok', w: 236, h: 420 },
  { aspect: '1:1', px: '1080 × 1080', use: 'Feeds and posts', w: 340, h: 340 },
  { aspect: '16:9', px: '1920 × 1080', use: 'YouTube, slides, websites', w: 448, h: 252 },
];

export const toCheckLabel = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'} to check`;

function SizePreview({ aspect, w, h }: { aspect: Aspect; w: number; h: number }) {
  const { state, cache } = useEditor();
  const ref = useRef<HTMLCanvasElement>(null);
  const r = state.clip.recipe;
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    // One still frame per size; nothing redraws until the clip or the time changes.
    const id = requestAnimationFrame(() => drawFrame(ctx, r, aspect, state.timeMs, cache));
    return () => cancelAnimationFrame(id);
  }, [r, aspect, w, h, state.timeMs, cache]);
  return <canvas ref={ref} aria-label={aspect} style={{ width: w, height: h, display: 'block', boxShadow: '0 6px 20px rgba(16,16,20,0.12)', background: 'var(--surface)' }} />;
}

export function FormatsPanel({ onClose }: { onClose: () => void }) {
  const { state, sizeOnly, setSizeOnly, go } = useEditor();
  const r = state.clip.recipe;
  const issues = useMemo(() => check(r), [r]);
  return (
    <div role="dialog" aria-label={`${r.name} · All sizes`} style={{ position: 'fixed', inset: 0, zIndex: 30, display: 'flex', flexDirection: 'column', background: 'var(--stage)', color: 'var(--ink)' }}>
      <header style={{ height: 52, flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px' }}>
        <button type="button" aria-label="Back to the editor" onClick={onClose} style={{ width: 36, height: 36, border: 0, borderRadius: 9, background: 'transparent', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{`${r.name} · All sizes`}</h1>
        <div style={{ flexGrow: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Changes apply to every size unless you choose “This size only”.</span>
        <button type="button" onClick={onClose} style={{ height: 36, padding: '0 16px', border: 0, borderRadius: 9, background: 'var(--ink)', color: '#fff', font: '600 13px/1 var(--font)', cursor: 'pointer' }}>Back to the editor</button>
      </header>
      <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 48, padding: 24, overflow: 'auto' }}>
        {SIZES.map((s) => {
          const n = issues.filter((i) => i.aspect === s.aspect).length;
          return (
            <section key={s.aspect} style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              <SizePreview aspect={s.aspect} w={s.w} h={s.h} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500 }}>{`${s.aspect} · ${s.px}`}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s.use}</span>
              {n === 0
                ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success-ink)' }}>Looks good</span>
                : <button type="button" onClick={() => go('Checker')} style={{ padding: 0, border: 0, background: 'transparent', font: '600 12px/1.2 var(--font)', color: 'var(--warning-ink)', cursor: 'pointer' }}>{toCheckLabel(n)}</button>}
            </section>
          );
        })}
      </div>
      <div style={{ height: 64, flexShrink: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>The layout moves for each size. It is never just cropped.</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid var(--line-strong)', fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" role="switch" checked={sizeOnly} aria-checked={sizeOnly} onChange={(e) => setSizeOnly(e.target.checked)} style={{ accentColor: 'var(--accent)', margin: 0 }} />
          {`This size only (${r.aspect})`}
        </label>
      </div>
    </div>
  );
}

/** Route screen (dev `?screen=Formats`): the editor with All sizes open. */
export default function Formats() {
  return <Editor open="formats" />;
}
