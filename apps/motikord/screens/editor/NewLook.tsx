import { useEffect, useMemo, useState } from 'react';
import { clipDuration } from '../../lib/render/drawFrame';
import { restTime, sceneIndex } from '../../lib/editor/store';
import { CHANGES_LINE, looked, newLook, packLine, packOf, staysLine } from '../../lib/editor/v2';
import { STYLE_PACKS, getPack } from '../../lib/templates/scenes';
import type { Pace, Recipe, StyleId } from '../../lib/types';
import { useEditor } from './Editor';
import { ArrowRight, CloseButton, Swap, Tick } from './dialogIcons';
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

  const card = thumbSize(r.aspect, 96);
  const big = thumbSize(r.aspect, 213);
  const before = r;
  const after = looks.get(style);
  const brandDot = brand?.colours.find((c) => c.role === 'primary')?.hex ?? brand?.colours[0]?.hex;
  const pack = getPack(style);
  return (
    <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(17,17,20,0.5)', display: 'grid', placeItems: 'center' }}>
      <div role="dialog" aria-label="New look, same words" onClick={(e) => e.stopPropagation()} style={{ width: 'min(840px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', boxSizing: 'border-box', padding: '24px 28px', borderRadius: 20, background: 'var(--surface)', boxShadow: '0 24px 64px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600, lineHeight: 1.25 }}>New look, same words</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: 'var(--muted)', maxWidth: 640 }}>Pick a style. Your script, media and timing stay; colours, fonts, backgrounds, motion and transitions change.</p>
          </div>
          <CloseButton onClick={onClose} size={34} />
        </div>
        <div role="radiogroup" aria-label="Style" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
          {STYLE_PACKS.map((p) => {
            const on = p.id === style;
            const look = looks.get(p.id);
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setStyle(p.id)}
                style={{ padding: 10, borderRadius: 14, border: on ? '1.5px solid var(--accent)' : '1px solid var(--line)', background: on ? 'var(--tint)' : 'var(--surface)', display: 'flex', gap: 10, alignItems: 'stretch', cursor: 'pointer', font: 'inherit', color: 'var(--ink)', textAlign: 'left' }}>
                <span style={{ flexShrink: 0, width: card.w, height: card.h, borderRadius: 6, overflow: 'hidden', boxShadow: '0 1px 3px rgba(16,16,20,0.12)', display: 'flex' }}>
                  {look && <SceneThumb recipe={look} aspect={r.aspect} timeMs={at} w={card.w} h={card.h} />}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                    {on
                      ? <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: '50%', background: 'var(--accent)', display: 'grid', placeItems: 'center' }}><Tick /></span>
                      : <span style={{ width: 16, height: 16, flexShrink: 0, borderRadius: '50%', border: '1.5px solid var(--line-strong)' }} />}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.35 }}>{packLine(p)}</span>
                  {p.id === now && <span style={{ alignSelf: 'flex-start', height: 18, padding: '0 7px', borderRadius: 999, background: '#F1F1F3', color: 'var(--muted)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center' }}>Now</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'stretch', background: 'var(--ground)', borderRadius: 16, padding: '18px 22px', flexGrow: 1 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
            <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <span style={{ width: big.w, height: big.h, borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 14px rgba(16,16,20,0.14)', display: 'flex' }}>
                <SceneThumb recipe={before} aspect={r.aspect} timeMs={at} w={big.w} h={big.h} />
              </span>
              <figcaption style={head}>{`Before · ${r.style ? packOf(r).name : 'Free layers'}`}</figcaption>
            </figure>
            <span style={{ width: 32, height: 32, flexShrink: 0, borderRadius: '50%', background: 'var(--surface)', border: '1px solid #E0E0E4', display: 'grid', placeItems: 'center', marginBottom: 22, color: 'var(--ink)' }}><ArrowRight /></span>
            <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <span style={{ width: big.w, height: big.h, borderRadius: 8, overflow: 'hidden', outline: '2px solid var(--accent)', outlineOffset: 2, boxShadow: '0 4px 14px rgba(16,16,20,0.14)', display: 'flex' }}>
                {after && <SceneThumb recipe={after} aspect={r.aspect} timeMs={at} w={big.w} h={big.h} />}
              </span>
              <figcaption style={{ ...head, color: 'var(--accent-hover)' }}>{`After · ${name}`}</figcaption>
            </figure>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flexGrow: 1, justifyContent: 'center', minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{name}</span>
            {pack?.description && <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>{pack.description}</span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Pace</span>
              <div role="radiogroup" aria-label="Pace" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', width: 260 }}>
                {PACES.map(([id, text]) => (
                  <button key={id} type="button" role="radio" aria-checked={pace === id} onClick={() => setPace(id)}
                    style={{ flex: 1, height: 32, border: 0, borderRadius: 7, background: pace === id ? 'var(--ink)' : 'transparent', font: `${pace === id ? 600 : 400} 13px/1 var(--font)`, color: pace === id ? '#FFFFFF' : 'var(--muted)', cursor: 'pointer' }}>{text}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Tick size={13} colour="var(--success-ink)" width={2.6} />{staysLine(r, clipDuration(r))}</span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Swap colour="var(--accent)" />{CHANGES_LINE}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', flexGrow: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            {brandDot && <span style={{ width: 10, height: 10, flexShrink: 0, borderRadius: '50%', background: brandDot }} />}
            Your brand kit still overrides colours, fonts and logo.
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ height: 48, padding: '0 18px', borderRadius: 12, borderColor: '#E0E0E4' }}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => apply(style, pace)} style={{ height: 48, padding: '0 22px', borderRadius: 12, fontWeight: 600 }}>{`Apply ${name}`}</button>
        </div>
      </div>
    </div>
  );
}
