import { clipDuration } from '../../lib/render/drawFrame';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from 'react';
import { createAutosave, type Autosave, type SaveStatus } from '../../lib/editor/autosave';
import { splitSummary, stepsBack } from '../../lib/editor/changes';
import { canRedo, canUndo, takeBack } from '../../lib/editor/history';
import { mergeClip, sameVersion } from '../../lib/editor/merge';
import { switchesSize, toSizeOnly } from '../../lib/editor/sizeOnly';
import { devSampleRecipe, findLayer, initState, reducer, removeLayer, sceneIndex, type Action, type EditorState, type Edit } from '../../lib/editor/store';
import { getBrandKit, getClip, putClip, updateClip } from '../../lib/db';
import { getMedia } from '../../lib/media';
import { brandEdit, loadKit, registerBrandFonts } from '../../lib/brand';
import { onMessage, send } from '../../lib/messages';
import { applyPatch, PatchError } from '../../lib/patch';
import { goInSidePanel, useWindowId } from '../../lib/sidepanelGo';
import { MediaCache } from '../../lib/render/cache';
import { devTools, type RouteParams } from '../../lib/router';
import { getSettings, onSettingsChanged } from '../../lib/settings';
import type { AiMode, Asset, Author, BrandKit, Clip, PresetSlot, Provider, Recipe } from '../../lib/types';
import { regenerateScene } from '../../lib/ai/writeRecipe';
import { toAiError } from '../../lib/ai/errors';
import { HOSTS, requestHost, type HostAccess } from '../../lib/hostAccess';
import { isV1Clip, remakeEdit } from '../../lib/editor/v2';
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
import { NewLookDialog } from './NewLook';
import { SceneTab } from './SceneTab';
import { SwapTemplatePopover } from './SwapTemplate';
import { TransitionPickerPopover } from './TransitionPicker';
import { Remade, Remaking, Spinner, RestyleDone, RestyleFailed, SceneRemakeFailed, SwapNoFit, TextShortened, V1Clip } from './StatesV2';

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
  /** `label` names a template preview ("{template} · not applied yet"). */
  setPreview: (r: Recipe | undefined, label?: string) => void;
  /** Right panel tab: Scene (v2), Layer or Changes. */
  tab: EditorTab;
  setTab: (t: EditorTab) => void;
  /** The v2 state card shown over the stage (StatesMakeV2). */
  notice?: Notice;
  setNotice: (n: Notice | undefined) => void;
  /** The slot layer being typed past its word limit on the stage, so its timeline bar reads "{slot} · too long". */
  overSlot?: string;
  setOverSlot: (layerId: string | undefined) => void;
  /** SwapTemplate, NewLook and TransitionPicker. */
  openPanel: (p: V2Panel) => void;
  /** The scene being remade (SceneRemaking), if any. */
  remaking?: string;
  remake: (sceneId: string, request?: string, done?: () => void) => void;
  /** Remakes these scenes one after another, each as its own Change; it stops at the first that fails or is stopped. `done` runs once its scene is remade. */
  remakeEach: (jobs: { sceneId: string; request?: string; done?: () => void }[]) => void;
  /** The clip's recipe right now, for work that finishes after a render (retries, AI replies). */
  current: () => Recipe;
}

export type EditorTab = 'scene' | 'layer' | 'changes';
export type Notice =
  | { kind: 'text-shortened'; original?: string; changeId?: string }
  | { kind: 'scene-remade'; sceneId: string; changeId?: string }
  | { kind: 'scene-remake-failed'; sceneId: string; request?: string }
  | { kind: 'swap-no-fit'; sceneId: string }
  | { kind: 'restyle-done'; style: string; changeId?: string }
  | { kind: 'restyle-failed'; style: string; retry: () => void };
export type V2Panel = { kind: 'swap'; sceneId: string } | { kind: 'look' } | { kind: 'transition'; sceneId: string };

/** What the editor opens on: a route screen for Presets, Formats or EditorPrompt. */
export type EditorOpenOn = 'presets' | 'formats' | 'changes';
type Panel = { kind: 'presets'; sceneId: string; layerId: string; slot: PresetSlot } | { kind: 'formats' } | V2Panel;

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
  const [tab, setTab] = useState<EditorTab>(open === 'changes' ? 'changes' : loaded.clip.recipe.scenes.some((s) => s.template) ? 'scene' : 'layer');
  const [notice, setNotice] = useState<Notice>();
  const [overSlot, setOverSlot] = useState<string>();
  const [remaking, setRemaking] = useState<string>();
  const [keepV1, setKeepV1] = useState(false);
  const remakeStop = useRef<AbortController>(undefined);
  const aiMode = useRef<{ ai: AiMode; provider: Provider }>({ ai: 'cloud', provider: 'groq' });
  const [panel, setPanel] = useState<Panel | undefined>(() => {
    if (open === 'formats') return { kind: 'formats' };
    if (open === 'presets' && state.layerId) return { kind: 'presets', sceneId: state.sceneId, layerId: state.layerId, slot: 'in' };
    return undefined;
  });
  const [sizeOnly, setSizeOnly] = useState(false);
  const [preview, setPreviewRecipe] = useState<Recipe>();
  const [previewLabel, setPreviewLabel] = useState<string>();
  const setPreview = useCallback((r: Recipe | undefined, label?: string) => { setPreviewRecipe(r); setPreviewLabel(r ? label : undefined); }, []);
  const playhead = useRef(state.timeMs);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Edits and undos also land on the ref at once, so a run of them in one handler each sees the one before.
  const act = useCallback((a: Action) => { stateRef.current = reducer(stateRef.current, a); dispatch(a); }, []);

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
    act({ type: 'merge', clip: m.clip });
  }, [act]);

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
    void getSettings().then((s) => { setSmooth(s.smoothPreview); aiMode.current = { ai: s.ai, provider: s.provider }; }).catch(() => undefined);
    const off = onSettingsChanged((s) => { setSmooth(s.smoothPreview); aiMode.current = { ai: s.ai, provider: s.provider }; });
    void browser.storage.local.get(FIRST_RUN_KEY).then((v) => setFirstRun(!v[FIRST_RUN_KEY])).catch(() => undefined);
    return off;
  }, []);

  // Done and shortened cards step aside after a while; failures stay until acted on.
  useEffect(() => {
    if (!notice || notice.kind === 'scene-remake-failed' || notice.kind === 'restyle-failed' || notice.kind === 'swap-no-fit') return;
    const id = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(id);
  }, [notice]);

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
      act({ type: 'edit', edit: e, by: o.by, at: Date.now(), id: newId(), select: o.select });
      // "This size only" names one size, so a size switch turns it off.
      if (switched) setSizeOnly(false);
      if (o.toast) toast(e.summary);
      return true;
    },
    undo: () => { act({ type: 'undo', at: Date.now() }); setToastText(undefined); },
    redo: () => act({ type: 'redo', at: Date.now() }),
    select: (sceneId, layerId, timeMs) => act({ type: 'select', sceneId, layerId, timeMs }),
    setTime: (ms) => { playhead.current = ms; act({ type: 'time', ms }); },
    play: (on) => {
      // Pressing play at the end starts again from 0:00.
      const cur = stateRef.current;
      if (on && cur.timeMs >= clipDuration(cur.clip.recipe) - 1) { playhead.current = 0; act({ type: 'time', ms: 0 }); }
      act({ type: 'play', playing: on });
    },
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
      for (let i = 0; i < n; i++) act({ type: 'undo', at: Date.now() });
      if (n) setToastText(undefined);
    },
    sizeOnly, setSizeOnly, setPreview,
    tab, setTab, notice, setNotice: (n) => setNotice(n && undoable(n) && !n.changeId ? { ...n, changeId: stateRef.current.clip.history.at(-1)?.id } : n), overSlot, setOverSlot, remaking,
    openPanel: (p) => setPanel(p),
    current: () => stateRef.current.clip.recipe,
    remake: (sceneId, request, done) => apiRef.current.remakeEach([{ sceneId, request, done }]),
    remakeEach: (jobs) => {
      if (remakeStop.current || !jobs.length) return;
      const { ai, provider } = aiMode.current;
      // Asked inside the click, before any await, so Chrome shows its prompt.
      const access: Promise<HostAccess> = ai === 'cloud' ? requestHost(HOSTS[provider]) : Promise.resolve('granted');
      const ac = new AbortController();
      remakeStop.current = ac;
      setNotice(undefined);
      void (async () => {
        for (const { sceneId, request, done } of jobs) {
          if (ac.signal.aborted) break;
          setRemaking(sceneId);
          try {
            if ((await access) === 'denied') throw new Error('host access denied');
            const from = stateRef.current.clip.recipe;
            const si = sceneIndex(from, sceneId);
            if (si < 0) continue;
            const after = await regenerateScene(from, si, request?.trim() || undefined, { signal: ac.signal, brand: loaded.brand });
            if (ac.signal.aborted) break;
            // Hand edits made meanwhile stay: only this scene is replaced, in the clip as it is now.
            const ok = apiRef.current.edit(remakeEdit(stateRef.current.clip.recipe, sceneId, after), { by: ai === 'cloud' ? provider : 'builtin' });
            setNotice(ok ? { kind: 'scene-remade', sceneId, changeId: stateRef.current.clip.history.at(-1)?.id } : { kind: 'scene-remake-failed', sceneId, request });
            if (!ok) break;
            done?.();
          } catch (error) {
            const e = toAiError(error, 'make');
            if (e.code === 'cancelled' || ac.signal.aborted) break;
            console.error('Motikord: could not remake the scene', error);
            setNotice({ kind: 'scene-remake-failed', sceneId, request });
            break;
          }
        }
        if (remakeStop.current === ac) { remakeStop.current = undefined; setRemaking(undefined); }
      })();
    },
  }), [state, loaded.brand, cache, save, smoothPreview, light, toast, router, sizeOnly, tab, notice, overSlot, remaking, act]);
  const stopRemake = () => { remakeStop.current?.abort(); remakeStop.current = undefined; setRemaking(undefined); };
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
      if (e.key === 'Home' && !e.repeat) { e.preventDefault(); api.play(false); api.setTime(0); }
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
            {previewLabel && (
              <div role="status" style={{ position: 'absolute', top: 16, left: 20, display: 'flex', gap: 8, alignItems: 'center', zIndex: 4 }}>
                <span style={{ padding: '3px 8px', borderRadius: 6, background: 'var(--accent)', color: '#fff', font: '600 11px/1.2 var(--font)' }}>Preview</span>
                <span style={{ padding: '3px 8px', borderRadius: 6, background: 'var(--ink)', color: '#fff', font: '500 12px/1.2 var(--font)' }}>{`${previewLabel} · not applied yet`}</span>
              </div>
            )}
            {remaking && <span role="status" style={{ position: 'absolute', top: 16, right: 20, zIndex: 4, display: 'flex', gap: 6, alignItems: 'center', padding: '4px 10px', borderRadius: 8, background: 'var(--ink)', color: '#fff', font: '600 12px/1.2 var(--font)' }}><Spinner colour="#fff" size={12} />{`Remaking scene ${sceneIndex(state.clip.recipe, remaking) + 1}…`}</span>}
            <Transport />
            {light && <div style={{ maxWidth: 520 }}><PreviewLight /></div>}
            <PromptBox />
            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 'min(440px, calc(100% - 40px))', display: 'flex', flexDirection: 'column', gap: 8, zIndex: 5 }}>
              {save === 'failed' && <SaveFailed onRetry={() => void autosave.current?.flush()} />}
              {isV1Clip(state.clip.recipe) && !keepV1 && <V1Clip onNewLook={() => setPanel({ kind: 'look' })} onKeep={() => setKeepV1(true)} />}
              {notice && <NoticeCard notice={notice} api={api} />}
              {missing && <MediaMissing file={missing.file} scene={missing.scene} onReplace={() => { setMissing(undefined); api.go('YourMedia', { sceneId: state.clip.recipe.scenes[missing.scene - 1]?.id }); }} />}
            </div>
            {router.route.screen === 'Checker' && <CheckerPanel />}
            {firstRun && <div style={{ position: 'absolute', top: 12, left: 12, width: 260, zIndex: 6 }}><FirstRun onDone={dismissFirstRun} /></div>}
            {remaking && (
              <div style={{ position: 'absolute', bottom: 96, left: '50%', transform: 'translateX(-50%)', width: 360, zIndex: 7 }}>
                <Remaking n={sceneIndex(state.clip.recipe, remaking) + 1} others={state.clip.recipe.scenes.length - 1} onStop={stopRemake} />
              </div>
            )}
            {!remaking && notice?.kind === 'scene-remade' && (
              <div style={{ position: 'absolute', bottom: 96, left: '50%', transform: 'translateX(-50%)', width: 360, zIndex: 7 }}>
                <Remade n={sceneIndex(state.clip.recipe, notice.sceneId) + 1} onUndo={() => undoNotice(api, notice.changeId)} onKeep={() => setNotice(undefined)} />
              </div>
            )}
            {toastText && !remaking && notice?.kind !== 'scene-remade' && <div style={{ position: 'absolute', bottom: 96, left: '50%', transform: 'translateX(-50%)', width: 320, zIndex: 6 }}><UndoToast text={toastText} onUndo={api.undo} /></div>}
          </main>
          <aside style={{ width: 300, flexShrink: 0, background: 'var(--surface)', borderLeft: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', alignContent: 'start', padding: '14px 16px', gap: 12, overflowY: 'auto' }}>
            {tab === 'changes'
              ? <ChangesTab onLayer={() => setTab('layer')} />
              : tab === 'scene'
                ? <SceneTab key={`${state.sceneId}/${si}`} />
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
        {panel?.kind === 'swap' && <SwapTemplatePopover sceneId={panel.sceneId} onClose={() => { setPreview(undefined); setPanel(undefined); }} />}
        {panel?.kind === 'look' && <NewLookDialog onClose={() => setPanel(undefined)} />}
        {panel?.kind === 'transition' && <TransitionPickerPopover sceneId={panel.sceneId} onClose={() => setPanel(undefined)} />}
        {panel?.kind === 'formats' && <FormatsPanel onClose={() => { setSizeOnly(false); setPanel(undefined); }} />}
      </div>
    </Ctx.Provider>
  );
}

const undoable = (n: Notice): n is Extract<Notice, { changeId?: string }> => n.kind === 'text-shortened' || n.kind === 'scene-remade' || n.kind === 'restyle-done';

/** A card's Undo takes back its own change: in place while it is the newest, otherwise as a new change, so later edits stay. */
function undoNotice(api: EditorApi, changeId: string | undefined) {
  const past = api.state.clip.history;
  const c = changeId ? past.find((x) => x.id === changeId) : past.at(-1);
  const back = c && takeBack(past, c.id, `${splitSummary(c.summary).title} undone`);
  if (back === 'undo') api.undo();
  else if (back) api.edit(back);
  api.setNotice(undefined);
}

/** The StatesMakeV2 card for the newest v2 action (scene-remade shows as the SceneRemaking toast instead). */
function NoticeCard({ notice, api }: { notice: Notice; api: EditorApi }) {
  const r = api.state.clip.recipe;
  const close = () => api.setNotice(undefined);
  const undo = () => undoNotice(api, 'changeId' in notice ? notice.changeId : undefined);
  switch (notice.kind) {
    case 'text-shortened': return <TextShortened original={notice.original} onUndo={undo} />;
    case 'scene-remade': return null;
    case 'scene-remake-failed': return <SceneRemakeFailed n={sceneIndex(r, notice.sceneId) + 1} onRetry={() => api.remake(notice.sceneId, notice.request)} />;
    case 'swap-no-fit': return <SwapNoFit onRemake={() => api.remake(notice.sceneId)} />;
    case 'restyle-done': return <RestyleDone style={notice.style} onUndo={undo} />;
    case 'restyle-failed': return <RestyleFailed style={notice.style} onRetry={() => { close(); notice.retry(); }} />;
  }
}
