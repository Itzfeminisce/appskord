import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from 'react';
import { Placeholder } from '../../components/ui';
import { createAutosave, type Autosave, type SaveStatus } from '../../lib/editor/autosave';
import { canRedo, canUndo } from '../../lib/editor/history';
import { devSampleRecipe, findLayer, initState, reducer, removeLayer, sceneIndex, type EditorState, type Edit } from '../../lib/editor/store';
import { getBrandKit, getClip, putClip, updateClip } from '../../lib/db';
import { getMedia } from '../../lib/media';
import { send } from '../../lib/messages';
import { MediaCache } from '../../lib/render/cache';
import { devTools, type RouteParams } from '../../lib/router';
import { getSettings, onSettingsChanged } from '../../lib/settings';
import type { Asset, Author, BrandKit, Clip } from '../../lib/types';
import { useRouter, type EditorScreen } from '../../entrypoints/editor/router';
import { AddToScene } from './AddToScene';
import { Canvas } from './Canvas';
import { LayerTab } from './LayerTab';
import { ScenesList } from './ScenesList';
import { EditorLoading, FirstRun, MediaMissing, PreviewLight, SaveFailed, UndoToast } from './StatesEditor';
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
  edit: (e: Edit | undefined, o?: { by?: Author; select?: { sceneId: string; layerId?: string }; toast?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  select: (sceneId: string, layerId?: string, timeMs?: number) => void;
  setTime: (ms: number) => void;
  play: (on: boolean) => void;
  /** undo-toast: T9 passes "Fixed N things"; hand edits pass their summary. */
  toast: (text: string) => void;
  go: (screen: EditorScreen, params?: RouteParams) => void;
}

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

/** Decoders for the page: files come from OPFS; a video element serves preview frames. */
function pageCache(): MediaCache {
  return new MediaCache({
    read: (a: Asset) => getMedia(a.opfsPath),
    video: async (_a, blob) => {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = URL.createObjectURL(blob);
      return {
        frameAt(ms) {
          const t = ms / 1000;
          if (Math.abs(v.currentTime - t) > 0.15 && !v.seeking) v.currentTime = t;
          return v.readyState >= 2 ? v : undefined;
        },
        close() { URL.revokeObjectURL(v.src); },
      };
    },
  });
}

interface Loaded { clip: Clip; brand?: BrandKit; missing?: { file: string; scene: number } }

async function openClip(clipId: string | undefined, cache: MediaCache): Promise<Loaded | undefined> {
  let clip = clipId ? await getClip(clipId) : undefined;
  if (!clip && devTools) {
    // Dev only: open on a sample clip so the editor can be tried before Make a clip (T5) exists.
    const id = clipId ?? 'dev-sample';
    const now = Date.now();
    clip = (await getClip(id)) ?? { id, recipe: devSampleRecipe(id), history: [], createdAt: now, updatedAt: now };
    await putClip(clip);
  }
  if (!clip) return undefined;
  const r = clip.recipe;
  const [brand] = await Promise.all([getBrandKit().catch(() => undefined), cache.load(r), document.fonts.ready]);
  let missing: Loaded['missing'];
  r.scenes.forEach((s, i) => s.layers.forEach((l) => {
    if ((l.type !== 'image' && l.type !== 'video') || cache.has(l.assetId)) return;
    cache.setImage(l.assetId, greyBox());
    if (l.type === 'video') cache.setVideo(l.assetId, { frameAt: () => greyBox() });
    missing ??= { file: r.assets[l.assetId]?.name ?? l.name, scene: i + 1 };
  }));
  return { clip, brand, missing };
}

export default function Editor() {
  const { route } = useRouter();
  const [cache] = useState(pageCache);
  const [loaded, setLoaded] = useState<Loaded>();
  const [name, setName] = useState('');
  useEffect(() => {
    let live = true;
    const id = route.params.clipId ?? new URLSearchParams(location.search).get('clip') ?? undefined;
    if (id) void getClip(id).then((c) => live && c && setName(c.recipe.name)).catch(() => undefined);
    openClip(id, cache).then((l) => { if (live && l) { setName(l.clip.recipe.name); setLoaded(l); } })
      .catch((error: unknown) => console.error('Motikord: could not open the clip', error));
    return () => { live = false; };
  }, [route.params.clipId, cache]);

  if (!loaded) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', background: 'var(--stage)' }}>
        <div style={{ width: 360 }}><EditorLoading name={name} /></div>
      </div>
    );
  }
  return <EditorOpen loaded={loaded} cache={cache} />;
}

function EditorOpen({ loaded, cache }: { loaded: Loaded; cache: MediaCache }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, loaded.clip, initState);
  const [save, setSave] = useState<SaveStatus>('saved');
  const [smoothPreview, setSmooth] = useState(true);
  const [light, setLight] = useState(false);
  const [toastText, setToastText] = useState<string>();
  const [firstRun, setFirstRun] = useState(false);
  const [missing, setMissing] = useState(loaded.missing);
  const playhead = useRef(state.timeMs);
  const stateRef = useRef(state);
  stateRef.current = state;

  const autosave = useRef<Autosave>(undefined);
  const lastSaved = useRef(state.clip);
  useEffect(() => {
    // Made in the effect so StrictMode's trial unmount cannot leave a disposed saver behind.
    const a = createAutosave({
      write: async (clip) => {
        const out = await updateClip(clip.id, () => ({ recipe: clip.recipe, history: clip.history, updatedAt: clip.updatedAt }));
        if (!out) await putClip(clip);
        void send({ type: 'clip/saved', clipId: clip.id });
      },
      onStatus: (s, error) => {
        setSave(s);
        if (error) console.error('Motikord: could not save the clip', error);
      },
    });
    autosave.current = a;
    const hide = () => { if (document.visibilityState === 'hidden') void a.flush(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); void a.flush().then(() => a.dispose()); };
  }, []);

  useEffect(() => {
    if (lastSaved.current === state.clip) return;
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
      if (!e) return;
      dispatch({ type: 'edit', edit: e, by: o.by, at: Date.now(), id: newId(), select: o.select });
      if (o.toast) toast(e.summary);
    },
    undo: () => { dispatch({ type: 'undo', at: Date.now() }); setToastText(undefined); },
    redo: () => dispatch({ type: 'redo', at: Date.now() }),
    select: (sceneId, layerId, timeMs) => dispatch({ type: 'select', sceneId, layerId, timeMs }),
    setTime: (ms) => { playhead.current = ms; dispatch({ type: 'time', ms }); },
    play: (on) => dispatch({ type: 'play', playing: on }),
    toast,
    go: (screen, params) => router.navigate(screen, { clipId: state.clip.id, ...params }),
  }), [state, loaded.brand, cache, save, smoothPreview, light, toast, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        // One history for canvas and fields, so Ctrl+Z in a field undoes the clip change too.
        e.preventDefault();
        if (e.shiftKey) { if (canRedo({ past: s.clip.history, future: s.future })) api.redo(); }
        else if (canUndo({ past: s.clip.history, future: s.future })) api.undo();
        return;
      }
      if (typing) return;
      if (e.key === ' ') { e.preventDefault(); api.play(!s.playing); }
      if (e.key === 'Escape' && s.layerId) api.select(s.sceneId);
      const f = (e.key === 'Delete' || e.key === 'Backspace') && findLayer(s.clip.recipe, s.sceneId, s.layerId);
      if (f) { e.preventDefault(); api.edit(removeLayer(f), { toast: true }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api]);

  const dismissFirstRun = () => {
    setFirstRun(false);
    void browser.storage.local.set({ [FIRST_RUN_KEY]: true }).catch(() => undefined);
  };
  const si = sceneIndex(state.clip.recipe, state.sceneId);

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
            <Canvas />
            <Transport />
            {light && <div style={{ maxWidth: 520 }}><PreviewLight /></div>}
            {/* T8: the prompt box "Tell Motikord what to change" and its chips go here. */}
            <div data-slot="prompt" style={{ width: '100%', maxWidth: 620, height: 78, flexShrink: 0, display: 'flex' }}><Placeholder name="EditorPrompt" /></div>
            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 'min(440px, calc(100% - 40px))', display: 'flex', flexDirection: 'column', gap: 8, zIndex: 5 }}>
              {save === 'failed' && <SaveFailed onRetry={() => void autosave.current?.flush()} />}
              {missing && <MediaMissing file={missing.file} scene={missing.scene} onReplace={() => { setMissing(undefined); api.go('YourMedia', { sceneId: state.clip.recipe.scenes[missing.scene - 1]?.id }); }} />}
            </div>
            {firstRun && <div style={{ position: 'absolute', left: 20, bottom: 96, width: 300, zIndex: 6 }}><FirstRun onDone={dismissFirstRun} /></div>}
            {toastText && <div style={{ position: 'absolute', bottom: 96, left: '50%', transform: 'translateX(-50%)', width: 320, zIndex: 6 }}><UndoToast text={toastText} onUndo={api.undo} /></div>}
          </main>
          <aside style={{ width: 300, flexShrink: 0, background: 'var(--surface)', borderLeft: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', alignContent: 'start', padding: '14px 16px', gap: 12, overflowY: 'auto' }}>
            <LayerTab key={`${state.sceneId}/${state.layerId ?? ''}/${si}`} />
          </aside>
        </div>
        {/* T8: the timeline (scenes, a track per layer, music) fills this section. */}
        <section aria-label="Timeline" data-slot="timeline" style={{ height: 196, flexShrink: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex' }}>
          <Placeholder name="Timeline" />
        </section>
      </div>
    </Ctx.Provider>
  );
}
