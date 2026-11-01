import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { restTime, sceneIndex } from '../../lib/editor/store';
import { swapGroups, swappedScene, swapTemplate, withScene } from '../../lib/editor/v2';
import { getSceneTemplate } from '../../lib/templates/scenes';
import type { Aspect, TemplateId } from '../../lib/types';
import { Caret, CloseButton, Tick } from './dialogIcons';
import { useEditor } from './Editor';
import { SceneThumb } from './SceneThumb';
import { SwapNoFit } from './StatesV2';

// SwapTemplate popover: same words in another template, previewed on the stage before it is applied.

const head = { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' } as const;
const TOP = 64;
/** Portrait tiles in six columns; square and wide clips get tiles of their own shape. */
const tileOf = (a: Aspect) => (a === '16:9' ? { w: 96, h: 54, cols: 4 } : a === '1:1' ? { w: 60, h: 60, cols: 6 } : { w: 56, h: 100, cols: 6 });

/** Where an element sits on screen, read again when the window resizes. */
function useRect(find: () => Element | null | undefined): DOMRect | undefined {
  const [rect, setRect] = useState<DOMRect>();
  useLayoutEffect(() => {
    const read = () => setRect(find()?.getBoundingClientRect());
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return rect;
}
const swapButton = () => [...document.querySelectorAll('aside button')].find((b) => b.textContent?.trim() === 'Swap template');
const stageCanvas = () => [...document.querySelectorAll('main canvas')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];

export function SwapTemplatePopover({ sceneId, onClose }: { sceneId: string; onClose: () => void }) {
  const { state, brand, edit, setPreview, setNotice, setTime, remake } = useEditor();
  const r = state.clip.recipe;
  const si = sceneIndex(r, sceneId);
  const scene = r.scenes[si];
  const groups = useMemo(() => (scene ? swapGroups(scene) : { fits: [], others: [] }), [scene]);
  // One preview recipe per template, made once per clip change rather than on every pointer move.
  const previews = useMemo(() => {
    const out = new Map<TemplateId, ReturnType<typeof withScene>>();
    if (!scene) return out;
    for (const id of [...groups.fits, ...groups.others]) {
      const sw = id === scene.template ? { scene } : swappedScene(r, si, id, brand);
      if (sw) out.set(id, withScene(r, si, sw.scene));
    }
    return out;
  }, [r, si, scene, groups, brand]);
  const [picked, setPicked] = useState<TemplateId | undefined>(undefined);
  const [pointed, setPointed] = useState<TemplateId>();
  const shown = pointed ?? picked;
  const btn = useRect(swapButton);
  const stage = useRect(stageCanvas);

  // Previews draw on the stage only; nothing is recorded until "Use".
  useEffect(() => {
    if (!scene || !shown || shown === scene.template) { setPreview(undefined); return; }
    setPreview(previews.get(shown));
  }, [shown, scene, previews, setPreview]);
  useEffect(() => () => setPreview(undefined), [setPreview]);
  useEffect(() => { if (si >= 0) setTime(restTime(r, si)); }, [si]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!scene) return null;
  const use = () => {
    if (!picked) return;
    const out = swapTemplate(r, si, picked, brand);
    setPreview(undefined);
    if (out && edit(out.edit)) {
      const full = Object.values(scene.original ?? scene.slots ?? {}).filter((v) => typeof v === 'string').join(' · ');
      setNotice(out.shortened ? { kind: 'text-shortened', original: full } : undefined);
    }
    onClose();
  };
  const ts = tileOf(r.aspect);
  const tile = (id: TemplateId, muted: boolean) => {
    const t = getSceneTemplate(id)!;
    const current = id === scene.template;
    const on = id === picked;
    const preview = previews.get(id);
    return (
      <button key={id} type="button" aria-label={t.name} aria-pressed={on} title={t.line} onClick={() => setPicked(current ? undefined : id)}
        onPointerEnter={() => setPointed(id)} onPointerLeave={() => setPointed(undefined)} onFocus={() => setPointed(id)} onBlur={() => setPointed(undefined)}
        style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 0, border: 0, background: 'transparent', font: 'inherit', textAlign: 'left', cursor: 'pointer', opacity: muted && !on ? 0.62 : 1 }}>
        <span style={{ position: 'relative', width: ts.w, height: ts.h, borderRadius: 6, overflow: 'hidden', background: '#0A0A0A', display: 'flex', outline: on ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }}>
          {preview && <SceneThumb recipe={preview} aspect={r.aspect} timeMs={restTime(r, si)} w={ts.w} h={ts.h} />}
          {current && <span style={{ position: 'absolute', top: 4, left: 4, height: 16, padding: '0 5px', borderRadius: 4, background: '#FFFFFF', color: 'var(--ink)', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center' }}>Current</span>}
          {on && <span style={{ position: 'absolute', bottom: 4, right: 4, width: 16, height: 16, borderRadius: '50%', background: 'var(--accent)', display: 'grid', placeItems: 'center' }}><Tick size={10} /></span>}
        </span>
        <span style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.25, color: on ? 'var(--accent-hover)' : 'var(--ink)', width: ts.w + 4 }}>{t.name}</span>
      </button>
    );
  };
  const grid = { display: 'grid', gridTemplateColumns: `repeat(${ts.cols}, ${ts.w + 4}px)`, justifyContent: 'space-between', rowGap: 10 } as const;
  const name = picked ? getSceneTemplate(picked)?.name : undefined;
  const caretTop = btn ? Math.max(16, Math.min(btn.top + btn.height / 2 - TOP - 6, 400)) : 174;
  const shownName = shown && shown !== scene.template ? getSceneTemplate(shown)?.name : undefined;
  return (
    <>
      {shownName && stage && (
        <div role="status" style={{ position: 'fixed', left: stage.left, top: stage.top, width: stage.width, height: stage.height, zIndex: 15, pointerEvents: 'none' }}>
          <span style={{ position: 'absolute', top: 8, left: 8, height: 24, padding: '0 10px', borderRadius: 999, background: 'var(--ink)', color: '#FFFFFF', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>Preview
          </span>
          <span aria-hidden="true" style={{ position: 'absolute', inset: 0, outline: '2px solid var(--accent)', outlineOffset: -2 }} />
          <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26, background: 'rgba(17,17,20,0.82)', color: '#FFFFFF', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{`${shownName} · not applied yet`}</span>
        </div>
      )}
      <div role="dialog" aria-label="Swap template" style={{ position: 'fixed', top: TOP, right: 308, width: 474, maxHeight: `calc(100vh - ${TOP + 8}px)`, boxSizing: 'border-box', zIndex: 20, padding: '18px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: '0 18px 48px rgba(16,16,20,0.18), 0 2px 6px rgba(16,16,20,0.06)' }}>
        <Caret side="right" style={{ top: caretTop, right: -7 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Swap template</h2>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Your words move into the new slots. Text that doesn't fit is shortened, and you can undo it.</p>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', minHeight: 0, margin: '0 -4px', padding: '4px' }}>
          {groups.fits.length <= 1 && <SwapNoFit onRemake={() => { onClose(); remake(sceneId); }} />}
          <span style={head}>Fits these words</span>
          <div style={grid}>{groups.fits.map((id) => tile(id, false))}</div>
          <span style={{ height: 1, flexShrink: 0, background: '#F1F1F3' }} />
          <span style={head}>Other templates</span>
          <div style={grid}>{groups.others.map((id) => tile(id, true))}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', flexGrow: 1, lineHeight: 1.4 }}>Point at one to preview it on the stage.</span>
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ height: 40, padding: '0 14px', borderRadius: 10, fontSize: 13, borderColor: '#E0E0E4', flexShrink: 0 }}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!picked} onClick={use} style={{ height: 40, padding: '0 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{name ? `Use ${name}` : 'Use'}</button>
        </div>
      </div>
    </>
  );
}
