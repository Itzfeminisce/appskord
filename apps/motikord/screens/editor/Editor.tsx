import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from 'react';
import { createAutosave, type Autosave, type SaveStatus } from '../../lib/editor/autosave';
import { stepsBack } from '../../lib/editor/changes';
import { canRedo, canUndo } from '../../lib/editor/history';
import { mergeClip, sameVersion } from '../../lib/editor/merge';
import { switchesSize, toSizeOnly } from '../../lib/editor/sizeOnly';
import { devSampleRecipe, findLayer, initState, reducer, removeLayer, sceneIndex, type EditorState, type Edit } from '../../lib/editor/store';
import { getBrandKit, getClip, putClip, updateClip } from '../../lib/db';
import { getMedia } from '../../lib/media';
import { brandEdit, loadKit, registerBrandFonts } from '../../lib/brand';
import { onMessage, send } from '../../lib/messages';
import { applyPatch, PatchError } from '../../lib/patch';
import { goInSidePanel, useWindowId } from '../../lib/sidepanelGo';
import { MediaCache } from '../../lib/render/cache';
import { devTools, type RouteParams } from '../../lib/router';
import { getSettings, onSettingsChanged } from '../../lib/settings';
import type { Asset, Author, BrandKit, Clip, PresetSlot, Recipe } from '../../lib/types';
import { useRouter, type EditorScreen } from '../../entrypoints/editor/router';
import { AddToScene } from './AddToScene';
import { Canvas } from './Canvas';
import { CheckerPanel } from '../Checker';
import { ChangesTab } from './ChangesTab';
import { PromptBox } from './EditorPrompt';
import { FormatsPanel } from './Formats';
import { LayerTab } from './LayerTab';
import { PresetsPopover } from './Presets';
import { ScenesList } from './ScenesList';
import { ClipNotFound, EditorLoading, FirstRun, MediaMissing, PreviewLight, SaveFailed, UndoToast } from './StatesEditor';
import { Timeline } from './Timeline';
import { TopBar } from './TopBar';
import { Transport } from './Transport';

/** What every editor part (and T8's timeline, presets and prompt box) reads and calls. */
export interface EditorApi {
  state: EditorState;
  brand?: BrandKit;
  cache: MediaCache;
  save: SaveStatus;
  /** Lower preview resolution: Settings smoothPreview caps it at 1x, slow frames halve it. */
  smoothPreview: boolean;
  light: boolean;
  setLight: (on: boolean) => void;
  /** The playhead while playing, without a React render per frame. */
  playhead: MutableRefObject<number>;
  /** Applies a PatchOp[] edit and records it as one Change (by 'hand' unless said). */
  edit: (e: Edit | undefined, o?: { by?: Author; select?: { sceneId: string; layerId?: string }; toast?: boolean }) => boolean;
  undo: () => void;
  redo: () => void;
  select: (sceneId: string, layerId?: string, timeMs?: number) => void;
  setTime: (ms: number) => void;
  play: (on: boolean) => void;
  /** undo-toast: T9 passes "Fixed N things"; hand edits pass their summary. */
  toast: (text: string) => void;
  /** Presets, Formats and EditorPrompt (the Changes tab) open inside the editor; other screens are routes. */
  go: (screen: EditorScreen, params?: RouteParams & { slot?: PresetSlot }) => void;
  /** "Go back here": undoes every change after this one. */
  goBack: (changeId: string) => void;
  /** "This size only": box edits write Layer.boxes for the size being edited. */
  sizeOnly: boolean;
  setSizeOnly: (on: boolean) => void;
  /** A recipe the canvas draws instead of the clip, without recording a change (preset preview). */
  setPreview: (r: Recipe | undefined) => void;
}

/** What the editor opens on: a route screen for Presets, Formats or EditorPrompt. */
export type EditorOpenOn = 'presets' | 'formats' | 'changes';
type Panel = { kind: 'presets'; sceneId: string; layerId: string; slot: PresetSlot } | { kind: 'formats' };

const Ctx = createContext<EditorApi | null>(null);
export function useEditor(): EditorApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useEditor must be used inside the Editor');
  return api;
}

const FIRST_RUN_KEY = 'editorFirstRunSeen';
const GREY = '#D4D4D9';
const newId = () => crypto.randomUUID();

/** Stands in for a file gone from OPFS, so the preview shows a grey box (media-missing). */
function greyBox(): CanvasImageSource {
  const c = new OffscreenCanvas(16, 16);
  const g = c.getContext('2d')!;
  g.fillStyle = GREY;
  g.fillRect(0, 0, 16, 16);
  return c;
}

/** Fires 'frame' when a video frame the paused preview waited for is ready, so the canvas draws again. */
export const frameReady = new EventTarget();
const announceFrame = () => frameReady.dispatchEvent(new Event('frame'));

/** Decoders for the page: files come from OPFS; a video element serves preview frames. */
function pageCache(): MediaCache {
  return new MediaCache({
    read: (a: Asset) => getMedia(a.opfsPath),
    video: async (_a, blob) => {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = URL.createObjectURL(blob);
      v.addEventListener('seeked', announceFrame);
      v.addEventListener('loadeddata', announceFrame);
      return {
        frameAt(ms) {
          const t = ms / 1000;
          if (Math.abs(v.currentTime - t) > 0.15 && !v.seeking) v.currentTime = t;
          return v.readyState >= 2 ? v : undefined;
        },
        close() { v.removeEventListener('seeked', announceFrame); v.removeEventListener('loadeddata', announceFrame); URL.revokeObjectURL(v.src); },
      };
    },
  });
}

interface Loaded { clip: Clip; brand?: BrandKit; missing?: { file: string; scene: number } }

async function openClip(clipId: string | undefined, cache: MediaCache): Promise<Loaded | undefined> {
  let clip = clipId ? await getClip(clipId) : undefined;
  if (!clip && devTools && (!clipId || clipId === 'dev-sample')) {
    // Dev only: with no clip named, open on a sample clip; a named clip that is gone shows clip-not-found.
    const id = clipId ?? 'dev-sample';
    const now = Date.now();
    clip = (await getClip(id)) ?? { id, recipe: devSampleRecipe(id), history: [], createdAt: now, updatedAt: now };
    await putClip(clip);
  }
  if (!clip) return undefined;
  const r = clip.recipe;
  const brand = await getBrandKit().catch(() => undefined);
  await Promise.all([registerBrandFonts(brand), cache.load(r)]);
  await document.fonts.ready;
  let missing: Loaded['missing'];
  r.scenes.forEach((s, i) => s.layers.forEach((l) => {
    if ((l.type !== 'image' && l.type !== 'video') || cache.has(l.assetId)) return;
    cache.setImage(l.assetId, greyBox());
    if (l.type === 'video') cache.setVideo(l.assetId, { frameAt: () => greyBox() });
    missing ??= { file: r.assets[l.assetId]?.name ?? l.name, scene: i + 1 };
  }));
  return { clip, brand, missing };
}

export default function Editor({ open }: { open?: EditorOpenOn } = {}) {
  const { route } = useRouter();
  const [cache] = useState(pageCache);
  const [loaded, setLoaded] = useState<Loaded>();
  const [gone, setGone] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    let live = true;
    const id = route.params.clipId ?? new URLSearchParams(location.search).get('clip') ?? undefined;
    if (id) void getClip(id).then((c) => live && c && setName(c.recipe.name)).catch(() => undefined);
    openClip(id, cache).then((l) => { if (!live) return; if (l) { setName(l.clip.recipe.name); setLoaded(l); } else setGone(true); })
      .catch((error: unknown) => console.error('Motikord: could not open the clip', error));
    return () => { live = false; };
  }, [route.params.clipId, cache]);

  if (gone) return <NotFound />;
  if (!loaded) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', background: 'var(--stage)' }}>
        <div style={{ width: 360 }}><EditorLoading name={name} /></div>
      </div>
    );
  }
  return <EditorOpen loaded={loaded} cache={cache} open={open} />;
}

/** clip-not-found: the whole tab, when the clip was deleted (before or while it is open). */
function NotFound() {
  const win = useWindowId();
  return (
    <div style={{ flex: 1, minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--stage)' }}>
      <div style={{ width: 400 }}><ClipNotFound onGo={() => goInSidePanel(win.current, 'Library')} /></div>
    </div>
  );
}

function EditorOpen({ loaded, cache, open }: { loaded: Loaded; cache: MediaCache; open?: EditorOpenOn }) {
  const router = useRouter();
  const [gone, setGone] = useState(false);
  const [state, dispatch] = useReducer(reducer, loaded.clip, initState);
  const [save, setSave] = useState<SaveStatus>('saved');
  const [smoothPreview, setSmooth] = useState(true);
  const [light, setLight] = useState(false);
  const [toastText, setToastText] = useState<string>();
  const [firstRun, setFirstRun] = useState(false);
  const [missing, setMissing] = useState(loaded.missing);
  const [tab, setTab] = useState<'layer' | 'changes'>(open === 'changes' ? 'changes' : 'layer');
  const [panel, setPanel] = useState<Panel | undefined>(() => {
    if (open === 'formats') return { kind: 'formats' };
    if (open === 'presets' && state.layerId) return { kind: 'presets', sceneId: state.sceneId, layerId: state.layerId, slot: 'in' };
    return undefined;
  });
  const [sizeOnly, setSizeOnly] = useState(false);
  const [preview, setPreview] = useState<Recipe>();
  const playhead = useRef(state.timeMs);
  const stateRef = useRef(state);
  stateRef.current = state;

  const autosave = useRef<Autosave>(undefined);
  const lastSaved = useRef(state.clip);
  // The stored clip as the editor last wrote or read it: what other surfaces' saves are merged against.
  const synced = useRef(loaded.clip);
  const goneRef = useRef(false);
  const markGone = useCallback(() => {
    goneRef.current = true;
    autosave.current?.dispose();
    setGone(true);
  }, []);

  /** Another surface saved this clip: take its version and keep every unsaved edit made here. */
  const takeStored = useCallback((stored: Clip) => {
    const base = synced.current;
    if (sameVersion(base, stored)) return;
    const s = stateRef.current;
    const m = mergeClip(s.clip, base, stored);
    synced.current = stored;
    if (m.clip === s.clip) return;
    // Nothing of ours is unsaved: the stored clip is already right, so there is nothing to write back.
    if (!m.dirty) lastSaved.current = m.clip;
    dispatch({ type: 'merge', clip: m.clip });
  }, []);

  useEffect(() => {
    // Made in the effect so StrictMode's trial unmount cannot leave a disposed saver behind.
    const a = createAutosave({
      write: async (clip) => {
        if (goneRef.current) return;
        // Re-read inside one transaction: a deleted clip is not re-created, and a rename or brand apply made elsewhere is kept.
        let theirs: Clip | undefined;
        let wrote: Clip | undefined;
        const out = await updateClip(clip.id, (stored) => {
          const base = synced.current;
          if (!sameVersion(base, stored)) theirs = stored;
          wrote = theirs ? mergeClip(clip, base, stored).clip : clip;
          return { recipe: wrote.recipe, history: wrote.history, updatedAt: wrote.updatedAt };
        });
        if (!out || !wrote) { markGone(); return; }
        if (theirs) takeStored(theirs);
        synced.current = out;
        void send({ type: 'clip/saved', clipId: clip.id });
      },
      onStatus: (s, error) => {
        setSave(s);
        if (error) console.error('Motikord: could not save the clip', error);
      },
    });
    autosave.current = a;
    const hide = () => { if (document.visibilityState === 'hidden') void a.flush(); };
    const leave = () => { void a.flush(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      void a.flush().then(() => a.dispose());
    };
  }, [markGone, takeStored]);

  // Saves from other surfaces: Making finishing, a Library rename or delete, Brand apply on the stored clip.
  useEffect(() => onMessage({
    'clip/saved': async ({ clipId }) => {
      if (clipId !== stateRef.current.clip.id || goneRef.current) return;
      const stored = await getClip(clipId);
      if (!stored) markGone();
      else takeStored(stored);
    },
  }), [markGone, takeStored]);

  useEffect(() => {
    if (lastSaved.current === state.clip || goneRef.current) return;
    lastSaved.current = state.clip;
    autosave.current?.schedule(state.clip);
  }, [state.clip]);

  useEffect(() => {
    void getSettings().then((s) => setSmooth(s.smoothPreview)).catch(() => undefined);
    const off = onSettingsChanged((s) => setSmooth(s.smoothPreview));
    void browser.storage.local.get(FIRST_RUN_KEY).then((v) => setFirstRun(!v[FIRST_RUN_KEY])).catch(() => undefined);
    return off;
  }, []);

  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((text: string) => {
    setToastText(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(undefined), 5000);
  }, []);

  const api = useMemo<EditorApi>(() => ({
    state, brand: loaded.brand, cache, save, smoothPreview, light, setLight, playhead,
    edit: (e, o = {}) => {
      if (!e) return false;
      const recipe = stateRef.current.clip.recipe;
      if (sizeOnly) e = toSizeOnly(recipe, e);
      const switched = switchesSize(e);
      try { applyPatch(recipe, e.ops); } catch (error) {
        // A failed edit changes nothing, so it gets no undo-toast either.
        if (!(error instanceof PatchError)) throw error;
        console.error('Motikord: could not apply an edit', error);
        return false;
      }
      dispatch({ type: 'edit', edit: e, by: o.by, at: Date.now(), id: newId(), select: o.select });
      // "This size only" names one size, so a size switch turns it off.
      if (switched) setSizeOnly(false);
      if (o.toast) toast(e.summary);
      return true;
    },
    undo: () => { dispatch({ type: 'undo', at: Date.now() }); setToastText(undefined); },
    redo: () => dispatch({ type: 'redo', at: Date.now() }),
    select: (sceneId, layerId, timeMs) => dispatch({ type: 'select', sceneId, layerId, timeMs }),
    setTime: (ms) => { playhead.current = ms; dispatch({ type: 'time', ms }); },
    play: (on) => dispatch({ type: 'play', playing: on }),
    toast,
    go: (screen, params = {}) => {
      if (screen === 'EditorPrompt') { setTab('changes'); return; }
      if (screen === 'Formats') { setPanel({ kind: 'formats' }); return; }
      if (screen === 'Presets') {
        const sceneId = params.sceneId ?? state.sceneId;
        const layerId = params.layerId ?? state.layerId;
        if (layerId) setPanel({ kind: 'presets', sceneId, layerId, slot: params.slot ?? 'in' });
        return;
      }
      const { slot: _slot, ...rest } = params;
      router.navigate(screen, { clipId: state.clip.id, ...rest });
    },
    goBack: (changeId) => {
      const n = stepsBack(stateRef.current.clip.history, changeId) ?? 0;
      for (let i = 0; i < n; i++) dispatch({ type: 'undo', at: Date.now() });
      if (n) setToastText(undefined);
    },
    sizeOnly, setSizeOnly, setPreview,
  }), [state, loaded.brand, cache, save, smoothPreview, light, toast, router, sizeOnly]);
  // The canvas alone sees the preview recipe; everything else keeps the clip.
  const canvasApi = useMemo<EditorApi>(() => (preview ? { ...api, state: { ...api.state, clip: { ...api.state.clip, recipe: preview } } } : api), [api, preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        // In the clip name or a Layer field, Ctrl+Z undoes the typing there, not the clip.
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) { if (canRedo({ past: s.clip.history, future: s.future })) api.redo(); }
        else if (canUndo({ past: s.clip.history, future: s.future })) api.undo();
        return;
      }
      if (typing) return;
      // A focused button keeps its own Space and Enter.
      const control = e.target instanceof HTMLElement && e.target.closest('button, a, [role="radio"], [role="button"]');
      if (e.key === ' ' && !control) { e.preventDefault(); if (!e.repeat) api.play(!s.playing); }
      if (e.key === 'Escape' && s.layerId) api.select(s.sceneId);
      const f = (e.key === 'Delete' || e.key === 'Backspace') && !e.repeat && findLayer(s.clip.recipe, s.sceneId, s.layerId);
      if (f && !f.layer.locked) { e.preventDefault(); api.edit(removeLayer(f), { toast: true }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api]);

  // "Apply to the open clip" in the Brand kit screen: the saved kit becomes one Change by hand, in this clip's tab only.
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => onMessage({
    'brand/apply': async ({ clipId }) => {
      if (!clipId || clipId !== stateRef.current.clip.id || goneRef.current) return { applied: false };
      const kit = await loadKit();
      await registerBrandFonts(kit);
      // Read after the awaits: edits made meanwhile must not be lost.
      apiRef.current.edit(brandEdit(stateRef.current.clip.recipe, kit), { toast: true });
      return { applied: true };
    },
  }), []);

  const dismissFirstRun = () => {
    setFirstRun(false);
    void browser.storage.local.set({ [FIRST_RUN_KEY]: true }).catch(() => undefined);
  };
  const si = sceneIndex(state.clip.recipe, state.sceneId);

  if (gone) return <NotFound />;
  return (
    <Ctx.Provider value={api}>
      <div style={{ flex: 'none', height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--ground)', color: 'var(--ink)', overflow: 'hidden' }}>
        <TopBar />
        <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
          <aside style={{ width: 220, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', alignContent: 'start', padding: '12px 10px', gap: 6, overflowY: 'auto' }}>
            <ScenesList />
            <AddToScene />
          </aside>
          <main style={{ position: 'relative', flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--stage)', minWidth: 0, padding: '12px 20px 10px', gap: 8 }}>
            <Ctx.Provider value={canvasApi}><Canvas /></Ctx.Provider>
            <Transport />
            {light && <div style={{ maxWidth: 520 }}><PreviewLight /></div>}
            <PromptBox />
            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 'min(440px, calc(100% - 40px))', display: 'flex', flexDirection: 'column', gap: 8, zIndex: 5 }}>
              {save === 'failed' && <SaveFailed onRetry={() => void autosave.current?.flush()} />}
              {missing && <MediaMissing file={missing.file} scene={missing.scene} onReplace={() => { setMissing(undefined); api.go('YourMedia', { sceneId: state.clip.recipe.scenes[missing.scene - 1]?.id }); }} />}
            </div>
            {router.route.screen === 'Checker' && <CheckerPanel />}
            {firstRun && <div style={{ position: 'absolute', left: 20, bottom: 96, width: 300, zIndex: 6 }}><FirstRun onDone={dismissFirstRun} /></div>}
            {toastText && <div style={{ position: 'absolute', bottom: 96, left: '50%', transform: 'translateX(-50%)', width: 320, zIndex: 6 }}><UndoToast text={toastText} onUndo={api.undo} /></div>}
          </main>
          <aside style={{ width: 300, flexShrink: 0, background: 'var(--surface)', borderLeft: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', alignContent: 'start', padding: '14px 16px', gap: 12, overflowY: 'auto' }}>
            {tab === 'changes'
              ? <ChangesTab onLayer={() => setTab('layer')} />
              : <LayerTab key={`${state.sceneId}/${state.layerId ?? ''}/${si}`} />}
          </aside>
        </div>
        <section aria-label="Timeline" style={{ height: 196, flexShrink: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex' }}>
          <Timeline />
        </section>
        {panel?.kind === 'presets' && (
          <div style={{ position: 'fixed', top: 60, right: 312, bottom: 12, zIndex: 20, display: 'flex', alignItems: 'flex-start' }}>
            <PresetsPopover key={`${panel.sceneId}/${panel.layerId}/${panel.slot}`} sceneId={panel.sceneId} layerId={panel.layerId} slot={panel.slot} onClose={() => setPanel(undefined)} />
          </div>
        )}
        {panel?.kind === 'formats' && <FormatsPanel onClose={() => { setSizeOnly(false); setPanel(undefined); }} />}
      </div>
    </Ctx.Provider>
  );
}
