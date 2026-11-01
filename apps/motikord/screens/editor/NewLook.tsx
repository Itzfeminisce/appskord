import { useEffect, useMemo, useState } from 'react';
import { clipDuration } from '../../lib/render/drawFrame';
import { restTime, sceneIndex } from '../../lib/editor/store';
import { CHANGES_LINE, looked, newLook, packLine, packOf, staysLine } from '../../lib/editor/v2';
import { STYLE_PACKS, getPack } from '../../lib/templates/scenes';
import type { Pace, Recipe, StyleId } from '../../lib/types';
import { useEditor } from './Editor';
import { SceneThumb, thumbSize } from './SceneThumb';

// NewLook dialog: same words, another style pack and pace. Apply is one Change; restyle-done offers Undo.

const PACES: [Pace, string][] = [['calm', 'Calm'], ['normal', 'Normal'], ['fast', 'Fast']];
const head = { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' } as const;

export function NewLookDialog({ onClose }: { onClose: () => void }) {
  const { state, brand, edit, setNotice, current } = useEditor();
  const r = state.clip.recipe;
  const now = r.style ? packOf(r).id : undefined;
  const [style, setStyle] = useState<StyleId>(() => STYLE_PACKS.find((p) => p.id !== now)?.id ?? packOf(r).id);
  const [pace, setPace] = useState<Pace>(r.pace ?? 'normal');
  const si = Math.max(0, sceneIndex(r, state.sceneId));
  const at = restTime(r, si);

  // Each pack's look of the open scene; a pack that cannot apply shows no picture.
  const looks = useMemo(() => {
    const out = new Map<StyleId, Recipe>();
    for (const p of STYLE_PACKS) {
      try { out.set(p.id, looked(r, p.id, pace, brand)); } catch (error) { console.error('Motikord: could not preview a look', error); }
    }
    return out;
  }, [r, pace, brand]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = getPack(style)?.name ?? style;
  // Retry reads the clip as it is then, not as it was when the dialog opened.
  const apply = (s: StyleId, p: Pace) => {
    const n = getPack(s)?.name ?? s;
    let ok = false;
    try { ok = edit(newLook(current(), s, p, brand)); } catch (error) { console.error('Motikord: could not apply the look', error); }
    setNotice(ok ? { kind: 'restyle-done', style: n } : { kind: 'restyle-failed', style: n, retry: () => apply(s, p) });
    onClose();
  };

  const card = thumbSize(r.aspect, 92);
  const big = thumbSize(r.aspect, 150);
  const before = r;
  const after = looks.get(style);
  return (
    <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(16,16,20,0.35)', display: 'grid', placeItems: 'center' }}>
      <div role="dialog" aria-label="New look, same words" onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', padding: 20, borderRadius: 16, background: 'var(--surface)', boxShadow: '0 20px 48px rgba(16,16,20,0.22)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>New look, same words</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Pick a style. Your script, media and timing stay; colours, fonts, backgrounds, motion and transitions change.</p>
        <div role="radiogroup" aria-label="Style" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
          {STYLE_PACKS.map((p) => {
            const on = p.id === style;
            const look = looks.get(p.id);
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setStyle(p.id)}
                style={{ padding: 8, borderRadius: 12, border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line)'}`, background: on ? 'var(--tint)' : 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', cursor: 'pointer', font: 'inherit', color: 'var(--ink)', position: 'relative' }}>
                {p.id === now && <span style={{ position: 'absolute', top: 6, right: 6, padding: '2px 6px', borderRadius: 6, background: 'var(--ink)', color: '#fff', font: '600 10px/1.2 var(--font)', zIndex: 1 }}>Now</span>}
                {look && <SceneThumb recipe={look} aspect={r.aspect} timeMs={at} w={card.w} h={card.h} />}
                <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>{packLine(p)}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            <SceneThumb recipe={before} aspect={r.aspect} timeMs={at} w={big.w} h={big.h} />
            <figcaption style={head}>{`Before · ${r.style ? packOf(r).name : 'Free layers'}`}</figcaption>
          </figure>
          <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            {after && <SceneThumb recipe={after} aspect={r.aspect} timeMs={at} w={big.w} h={big.h} />}
            <figcaption style={head}>{`After · ${name}`}</figcaption>
          </figure>
        </div>
        {getPack(style)?.description && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>{getPack(style)!.description}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Pace</span>
          <div role="radiogroup" aria-label="Pace" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: 'var(--stage)' }}>
            {PACES.map(([id, text]) => (
              <button key={id} type="button" role="radio" aria-checked={pace === id} onClick={() => setPace(id)}
                style={{ height: 28, padding: '0 12px', border: 0, borderRadius: 6, background: pace === id ? 'var(--surface)' : 'transparent', boxShadow: pace === id ? '0 1px 2px rgba(16,16,20,0.08)' : 'none', font: '500 12px/1 var(--font)', color: pace === id ? 'var(--ink)' : 'var(--muted)', cursor: 'pointer' }}>{text}</button>
            ))}
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{staysLine(r, clipDuration(r))}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{CHANGES_LINE}</span>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>Your brand kit still overrides colours, fonts and logo.</span>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => apply(style, pace)}>{`Apply ${name}`}</button>
        </div>
      </div>
    </div>
  );
}
