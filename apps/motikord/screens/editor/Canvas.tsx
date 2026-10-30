import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { dragBox, handleAt, hitLayer, ROTATE_KNOB, sameBox, type Handle, type Pt } from '../../lib/editor/hit';
import { findLayer, setBox, setField, type Found } from '../../lib/editor/store';
import { applyPatch } from '../../lib/patch';
import { activeLayers, clipDuration, drawFrame, fontFor, sceneAt } from '../../lib/render/drawFrame';
import { boxFor, safeBox } from '../../lib/render/reflow';
import type { Box, Layer, Recipe, Scene, TextLayer } from '../../lib/types';
import { frameReady, useEditor } from './Editor';

const RATIO = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9 } as const;
const CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', move: 'move', rotate: 'grab' };
// Below about 27 fps on average, the preview switches to half resolution (preview-light).
const SLOW_FRAME_MS = 1000 / 27;
const HANDLE: CSSProperties = { position: 'absolute', width: 7, height: 7, background: 'var(--surface)', border: '1.5px solid var(--accent)', pointerEvents: 'none' };

interface Drag { handle: Handle; from: Pt; start: Box; found: Found }

const boxOf = (r: Recipe, scene: Scene) => (l: Layer) => boxFor(l, r.aspect, r.aspect, scene.layout);

export function Canvas() {
  const { state, cache, smoothPreview, light, setLight, playhead, edit, select, setTime, play } = useEditor();
  const r = state.clip.recipe;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ W: 0, H: 0 });
  const [draft, setDraftState] = useState<{ layerId: string; box: Box }>();
  // up() reads the newest draft, not the one its render closed over.
  const draftRef = useRef(draft);
  const setDraft = (d: typeof draft) => { draftRef.current = d; setDraftState(d); };
  const [editing, setEditing] = useState<string>();
  const [cursor, setCursor] = useState('default');
  const drag = useRef<Drag>(undefined);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const k = RATIO[r.aspect];
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const W = Math.floor(Math.min(cw, ch * k));
      setSize({ W, H: Math.floor(W / k) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [r.aspect]);

  const at = sceneAt(r, state.timeMs);
  const sel = at && at.scene.id === state.sceneId ? findLayer(r, state.sceneId, state.layerId) : undefined;

  // What is drawn: the recipe, with the box being dragged and without the text being typed over.
  const view = useMemo(() => {
    let v = r;
    const ops = [];
    if (draft) {
      const f = findLayer(r, state.sceneId, draft.layerId);
      if (f) ops.push(...setBox(r, f, draft.box, 'moved').ops);
    }
    const e = editing ? findLayer(r, state.sceneId, editing) : undefined;
    if (e) ops.push({ op: 'replace' as const, path: `${e.path}/opacity`, value: 0 });
    if (ops.length) v = applyPatch(v, ops).doc;
    return v;
  }, [r, draft, editing, state.sceneId]);

  const live = useRef({ view, timeMs: state.timeMs, playing: state.playing, scale: 1, dirty: true, api: { setTime, play, setLight } });
  const scale = (smoothPreview ? 1 : Math.min(2, globalThis.devicePixelRatio || 1)) * (light ? 0.5 : 1);
  live.current = { ...live.current, view, timeMs: state.timeMs, playing: state.playing, scale, dirty: true, api: { setTime, play, setLight } };

  useEffect(() => {
    let raf = 0;
    let base: { at: number; from: number } | undefined;
    let lastNow = 0;
    let frames = 0;
    let slow = 0;
    let ended = false;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const L = live.current;
      const c = canvas.current;
      if (!c) return;
      let t = L.timeMs;
      if (L.playing && ended) return;
      if (L.playing) {
        if (!base) { base = { at: now, from: L.timeMs }; lastNow = now; frames = 0; slow = 0; }
        const total = clipDuration(L.view);
        t = Math.min(total, base.from + (now - base.at));
        playhead.current = t;
        if (frames++ > 0 && now - lastNow > SLOW_FRAME_MS) slow++;
        lastNow = now;
        if (frames >= 45) {
          if (slow > frames / 3) L.api.setLight(true);
          frames = 1;
          slow = 0;
        }
        if (t >= total) { base = undefined; ended = true; L.api.play(false); L.api.setTime(total); }
      } else {
        ended = false;
        if (base) { base = undefined; L.api.setTime(playhead.current); }
        if (!L.dirty) return;
        playhead.current = t;
      }
      L.dirty = false;
      const w = Math.max(1, Math.round(c.clientWidth * L.scale));
      const h = Math.max(1, Math.round(c.clientHeight * L.scale));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const ctx = c.getContext('2d');
      if (ctx) drawFrame(ctx, L.view, L.view.aspect, t, cache);
    };
    raf = requestAnimationFrame(loop);
    // A paused preview waits on a video seek; draw again once the frame is there.
    const redraw = () => { live.current.dirty = true; };
    frameReady.addEventListener('frame', redraw);
    return () => { cancelAnimationFrame(raf); frameReady.removeEventListener('frame', redraw); };
  }, [cache, playhead]);

  const { W, H } = size;
  const point = (e: { clientX: number; clientY: number }): Pt => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onScreen = (sceneLayers: Layer[], id?: string) => !!id && sceneLayers.some((l) => l.id === id);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !at) return;
    if (editing) { if ((e.target as HTMLElement).tagName === 'TEXTAREA') return; setEditing(undefined); }
    if (state.playing) play(false);
    const p = point(e);
    const layers = activeLayers(at.scene, at.localMs);
    const of = boxOf(r, at.scene);
    let found = sel && onScreen(layers, sel.layer.id) && !sel.layer.locked ? sel : undefined;
    let handle = found ? handleAt(of(found.layer), p, W, H) : null;
    if (!handle || handle === 'move') {
      const hit = hitLayer(layers, of, p, W, H);
      if (!hit) { select(at.scene.id); return; }
      if (hit.id !== state.layerId || at.scene.id !== state.sceneId) select(at.scene.id, hit.id);
      found = findLayer(r, at.scene.id, hit.id);
      handle = 'move';
    }
    if (!found) return;
    drag.current = { handle, from: p, start: of(found.layer), found };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const p = point(e);
    if (d) {
      if (Math.hypot(p.x - d.from.x, p.y - d.from.y) < 2 && !draftRef.current) return;
      setDraft({ layerId: d.found.layer.id, box: dragBox(d.start, d.handle, d.from, p, W, H, { keepRatio: e.shiftKey, snap: e.shiftKey }) });
      return;
    }
    const layers = at ? activeLayers(at.scene, at.localMs) : [];
    const h = sel && at && onScreen(layers, sel.layer.id) ? handleAt(boxOf(r, at.scene)(sel.layer), p, W, H) : null;
    const next = h ? CURSOR[h] : 'default';
    if (next !== cursor) setCursor(next);
  };

  const up = () => {
    const d = drag.current;
    const draft = draftRef.current;
    drag.current = undefined;
    if (!d || !draft) return;
    if (!sameBox(draft.box, d.start)) {
      const how = d.handle === 'move' ? 'moved' : d.handle === 'rotate' ? 'rotated' : 'resized';
      edit(setBox(r, d.found, draft.box, how));
    }
    setDraft(undefined);
  };

  const dbl = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!at) return;
    const hit = hitLayer(activeLayers(at.scene, at.localMs), boxOf(r, at.scene), point(e), W, H);
    if (hit?.type === 'text') { select(at.scene.id, hit.id); setEditing(hit.id); }
  };

  const showSel = !state.playing && at && sel && onScreen(activeLayers(at.scene, at.localMs), sel.layer.id);
  const selBox = showSel ? (draft?.layerId === sel.layer.id ? draft.box : boxOf(r, at.scene)(sel.layer)) : undefined;
  const typing = editing && sel?.layer.id === editing && sel.layer.type === 'text' ? sel : undefined;
  const safe = safeBox(r.aspect);

  return (
    <div ref={wrap} style={{ flex: 1, minHeight: 0, width: '100%', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <div style={{ position: 'relative', width: W, height: H, boxShadow: '0 6px 20px rgba(16,16,20,0.12)', background: 'var(--surface)' }}>
        <canvas ref={canvas} aria-label={r.name} style={{ display: 'block', width: W, height: H }} />
        <div
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = undefined; setDraft(undefined); }}
          onDoubleClick={dbl}
          style={{ position: 'absolute', inset: 0, overflow: 'hidden', cursor, touchAction: 'none' }}
        >
          <span aria-hidden="true" style={{ position: 'absolute', left: safe.x * W, top: safe.y * H, width: safe.w * W, height: safe.h * H, border: '1px dashed color-mix(in srgb, var(--accent) 35%, transparent)', pointerEvents: 'none' }} />
          {selBox && !typing && <Selection box={selBox} W={W} H={H} />}
          {typing && selBox && <TextEditor found={typing as Found & { layer: TextLayer }} box={selBox} W={W} H={H} onDone={() => setEditing(undefined)}
            onText={(text) => edit(setField(typing, 'text', text, 'Text changed'))} />}
        </div>
      </div>
    </div>
  );
}

function place(b: Box, W: number, H: number): CSSProperties {
  return { position: 'absolute', left: b.x * W, top: b.y * H, width: b.w * W, height: b.h * H, transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined };
}

function Selection({ box, W, H }: { box: Box; W: number; H: number }) {
  return (
    <div aria-hidden="true" style={{ ...place(box, W, H), outline: '1.5px solid var(--accent)', outlineOffset: 3, pointerEvents: 'none' }}>
      <span style={{ ...HANDLE, left: -7, top: -7 }} />
      <span style={{ ...HANDLE, right: -7, top: -7 }} />
      <span style={{ ...HANDLE, left: -7, bottom: -7 }} />
      <span style={{ ...HANDLE, right: -7, bottom: -7 }} />
      <span style={{ position: 'absolute', left: 'calc(50% - 0.75px)', top: -3 - 14, width: 1.5, height: 14, background: 'var(--accent)' }} />
      <button type="button" aria-label="Rotate" tabIndex={-1}
        style={{ position: 'absolute', left: 'calc(50% - 8px)', top: -3 - (ROTATE_KNOB.above - 3) - 8, width: 16, height: 16, padding: 0, border: '1.5px solid var(--accent)', borderRadius: '50%', background: 'var(--surface)', color: 'var(--accent)', display: 'grid', placeItems: 'center', cursor: 'grab' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.5-5.8" /><path d="M20 4v5h-5" /></svg>
      </button>
    </div>
  );
}

/** In-place text editing: a textarea laid over the layer in its own font, size and colour. */
function TextEditor({ found, box, W, H, onText, onDone }: { found: Found & { layer: TextLayer }; box: Box; W: number; H: number; onText: (t: string) => void; onDone: () => void }) {
  const l = found.layer;
  const unit = Math.min(W, H) / 1080;
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.select(); } }, []);
  return (
    <textarea
      ref={ref} aria-label={l.name} value={l.text} spellCheck
      onChange={(e) => onText(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onDone(); } }}
      style={{
        ...place(box, W, H), margin: 0, padding: l.background ? 16 * unit : 0, border: 0, resize: 'none', overflow: 'hidden',
        background: l.background ?? 'transparent', color: l.colour, font: fontFor(l, l.sizePx * unit), lineHeight: l.lineHeight,
        textAlign: l.align, outline: '1.5px solid var(--accent)', outlineOffset: 3, borderRadius: l.background ? 12 * unit : 0,
      }}
    />
  );
}
