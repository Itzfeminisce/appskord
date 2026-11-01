import { useEffect, useMemo, useState } from 'react';
import { restTime, sceneIndex } from '../../lib/editor/store';
import { swapGroups, swappedScene, swapTemplate, withScene } from '../../lib/editor/v2';
import { getSceneTemplate } from '../../lib/templates/scenes';
import type { TemplateId } from '../../lib/types';
import { useEditor } from './Editor';
import { SceneThumb, thumbSize } from './SceneThumb';
import { SwapNoFit } from './StatesV2';

// SwapTemplate popover: same words in another template, previewed on the stage before it is applied.

const head = { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' } as const;

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

  // Previews draw on the stage only; nothing is recorded until "Use".
  useEffect(() => {
    if (!scene || !shown || shown === scene.template) { setPreview(undefined); return; }
    setPreview(previews.get(shown), getSceneTemplate(shown)?.name);
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
      const full = Object.values(r.scenes[si]!.slots ?? {}).filter((v) => typeof v === 'string').join(' · ');
      setNotice(out.shortened ? { kind: 'text-shortened', original: full } : undefined);
    }
    onClose();
  };
  const tile = (id: TemplateId, muted: boolean) => {
    const t = getSceneTemplate(id)!;
    const current = id === scene.template;
    const on = id === picked;
    const preview = previews.get(id);
    const size = thumbSize(r.aspect, 54);
    return (
      <button key={id} type="button" aria-pressed={on} onClick={() => setPicked(current ? undefined : id)}
        onPointerEnter={() => setPointed(id)} onPointerLeave={() => setPointed(undefined)} onFocus={() => setPointed(id)} onBlur={() => setPointed(undefined)}
        style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 8, borderRadius: 10, textAlign: 'left', font: 'inherit', color: 'var(--ink)', cursor: 'pointer', opacity: muted ? 0.6 : 1, background: on ? 'var(--tint)' : 'var(--surface)', border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}` }}>
        {preview && <SceneThumb recipe={preview} aspect={r.aspect} timeMs={restTime(r, si)} w={size.w} h={size.h} />}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
            {t.name}
            {current && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6, background: 'var(--stage)', color: 'var(--muted)' }}>Current</span>}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.35 }}>{t.line}</span>
        </span>
      </button>
    );
  };
  const name = picked ? getSceneTemplate(picked)?.name : undefined;
  return (
    <div role="dialog" aria-label="Swap template" style={{ position: 'fixed', top: 60, right: 312, bottom: 208, width: 340, zIndex: 20, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 12px 32px rgba(16,16,20,0.14)', overflowY: 'auto' }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Swap template</h2>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Your words move into the new slots. Text that doesn't fit is shortened, and you can undo it.</p>
      {groups.fits.length <= 1 && <SwapNoFit onRemake={() => { onClose(); remake(sceneId); }} />}
      <span style={head}>Fits these words</span>
      {groups.fits.map((id) => tile(id, false))}
      <span style={head}>Other templates</span>
      {groups.others.map((id) => tile(id, true))}
      <span style={{ fontSize: 12, color: 'var(--faint)' }}>Point at one to preview it on the stage.</span>
      <div style={{ display: 'flex', gap: 8, position: 'sticky', bottom: -14, background: 'var(--surface)', padding: '8px 0 0' }}>
        <button type="button" className="btn btn-primary" disabled={!picked} onClick={use} style={{ flexGrow: 1 }}>{name ? `Use ${name}` : 'Use'}</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
