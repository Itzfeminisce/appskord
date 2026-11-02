import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { captionLines } from '@/lib/project/captions';
import { currentCut } from '@/lib/project/history';
import { removeLayer } from '@/lib/project/ops';
import { flushProjects } from '@/lib/project/store';
import { cutLength, spans, toOut } from '@/lib/project/time';
import type { Cut, EventsTrack, Project, Source } from '@/lib/project/types';
import { units } from '@/lib/wordCuts';
import { Inspector, type InspectorProps } from './components/Inspector';
import { Preview } from './components/Preview';
import { PreviewFullscreen } from './components/PreviewFullscreen';
import { ShapeMenu } from './components/ShapeMenu';
import { TimelineOpening, TimelineSlot, TranscriptColumn, TranscriptOpening, transcriptState, type SlotProps, type TranscriptSlotProps } from './components/slots';
import { TopBar, type TopBarProps } from './components/TopBar';
import { Transport } from './components/Transport';
import { useDeps } from './deps';
import { useAudio } from './hooks/useAudio';
import { usePlayback } from './hooks/usePlayback';
import { useProject } from './hooks/useProject';
import { minutesAgo } from './format';
import { renderSources, type LoadedMedia } from './media';
import type { SessionState } from './session';
import { MediaMissing, NotSaved, OldRecording, PreviewSlow } from './states/banners';
import { OpenElsewhere, UnsavedRecovered } from './states/dialogs';
import { LONG_RECORDING_MS, LongRecording, OPENING_SLOW_MS, OpeningSlow, OpeningSteps, type StepTimes } from './states/opening';
import { FullPage } from './states/StateCard';
import { voiceoverBusy } from './voiceover/state';
import { isWindowSmall, NoProject, WindowSmall } from './states/pages';
import { C } from './ui';

/** What later tasks plug into the shell. Each slot shows its skeleton until its task fills it. */
export interface EditorSlots {
  transcript?: ComponentType<TranscriptSlotProps>;
  timeline?: ComponentType<SlotProps>;
  /** A tool panel (T6's Clean up) that covers the inspector while it is open; it renders null when closed. */
  aside?: ComponentType<SlotProps>;
  inspector?: (props: SlotProps) => Pick<InspectorProps, 'panels' | 'selection'>;
  topBar?: (props: SlotProps) => Partial<Pick<TopBarProps, 'onName' | 'onCuts' | 'onHistory' | 'onShortcuts' | 'onAskAI' | 'onExport' | 'status'>>;
  /** Drawn over the preview picture (T10's zoom focus ring); `preview` shows a cut live without an edit, null ends it. */
  stage?: ComponentType<StageProps>;
  /** Dialogs and cards over the whole editor (T9's export). */
  overlay?: ComponentType<SlotProps>;
  /** Slots whose inspector or top bar read their own state call `onChange` so the shell draws them again. */
  subscribe?: (onChange: () => void) => () => void;
}

export type StageProps = SlotProps & { events?: EventsTrack; preview(cut: Cut | null): void };

const PREVIEW_SLOW_SEEN = 'klipkord.previewSlowSeen';

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Sentence starts in output time, for previous and next sentence; clip starts when there is no transcript. */
function stops(project: Project, segments: { start: number }[]): number[] {
  const cut = currentCut(project);
  const times = segments.map((s) => toOut(cut, s.start)).filter((t): t is number => t !== null);
  return (times.length ? times : spans(cut).map((s) => s.start)).sort((a, b) => a - b);
}

/** The editor tab for one recording. */
export function Editor({ id, slots = {} }: { id: string; slots?: EditorSlots }) {
  const deps = useDeps();
  const size = useWindowSize();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => slots.subscribe?.(redraw), [slots]);
  const [session, setSession] = useState<SessionState>('checking');
  const sessionRef = useRef<ReturnType<typeof deps.joinSession> | null>(null);
  const api = useProject(id, session !== 'editing');
  const reload = api.reload;

  useEffect(() => {
    const s = deps.joinSession(id, flushProjects);
    sessionRef.current = s;
    setSession(s.state);
    let last = s.state;
    const off = s.subscribe((next) => {
      // Another tab let go (closed, or "Edit here"): read what it saved before editing.
      if (last === 'elsewhere' && next === 'editing') void reload();
      last = next;
      setSession(next);
    });
    return () => { off(); s.close(); };
  }, [id, deps, reload]);

  const [longOk, setLongOk] = useState(false);
  const started = useRef(performance.now());
  const [media, setMedia] = useState<LoadedMedia | null>(null);
  const [stageCut, setStageCut] = useState<Cut | null>(null);
  const [times, setTimes] = useState<StepTimes>([]);
  const [firstFrame, setFirstFrame] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [slowOpen, setSlowOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const [previewSlow, setPreviewSlow] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { project, recording } = api;
  const long = !!recording && recording.duration > LONG_RECORDING_MS && !longOk;
  const projectReady = api.phase === 'ready' && !!project;

  // Files open once per project; "Find the file" opens them again.
  const [mediaKey, setMediaKey] = useState(0);
  const sourcesKey = project?.sources;
  useEffect(() => {
    if (!projectReady || long || !project) return;
    let live = true;
    setMediaFailed(false);
    const elapsed = () => performance.now() - started.current;
    deps.loadMedia(project).then((m) => {
      if (!live) return;
      const read = elapsed();
      setMedia(m);
      setTimes([read, Math.max(read, elapsed()), Math.max(read, elapsed())]);
    }, (error: unknown) => {
      console.error('Klipkord: could not open the recording files', error);
      if (live) setMediaFailed(true);
    });
    return () => { live = false; };
  }, [projectReady, long, sourcesKey, mediaKey, deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (firstFrame || !projectReady || long) return;
    const timer = setTimeout(() => setSlowOpen(true), OPENING_SLOW_MS);
    return () => clearTimeout(timer);
  }, [firstFrame, projectReady, long, slowOpen]);

  const cut = project ? currentCut(project) : undefined;
  const length = cut ? cutLength(cut) : 0;
  const playback = usePlayback(length, firstFrame);
  const sources = useMemo(() => (project && media ? renderSources(project, media.blobs) : null), [sourcesKey, media]); // eslint-disable-line react-hooks/exhaustive-deps
  const captions = useMemo(() => (recording ? captionLines(units(recording.transcript), project?.wordFixes) : undefined), [recording, project?.wordFixes]);
  // A voiceover take plays the picture without the original sound.
  const spoken = useMemo(() => recording?.transcript.flatMap((s) => s.words ?? []) ?? [], [recording?.transcript]);
  useAudio(project, cut, spoken, media?.blobs, playback.out, playback.playing && !voiceoverBusy(), deps.mix);

  const sentenceStops = useMemo(() => (project ? stops(project, recording?.transcript ?? []) : []), [project, recording]);
  const prev = useCallback(() => {
    const before = sentenceStops.filter((t) => t < playback.out - 500);
    playback.seek(before.at(-1) ?? 0);
  }, [sentenceStops, playback]);
  const next = useCallback(() => {
    const after = sentenceStops.find((t) => t > playback.out + 10);
    if (after !== undefined) playback.seek(after);
  }, [sentenceStops, playback]);
  const previewRef = useRef<HTMLElement>(null);
  const [full, setFull] = useState(false);
  const [shapeOpen, setShapeOpen] = useState(false);
  useEffect(() => {
    const on = () => setFull(!!previewRef.current && document.fullscreenElement === previewRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const exitFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch((error: unknown) => console.error('Klipkord: could not leave full screen', error));
  }, []);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) exitFull();
    else previewRef.current?.requestFullscreen?.().catch((error: unknown) => console.error('Klipkord: could not go full screen', error));
  }, [exitFull]);

  const keys = useRef({ toggle: playback.toggle, prev, next, fullscreen, undo: api.undo, redo: api.redo });
  keys.current = { toggle: playback.toggle, prev, next, fullscreen, undo: api.undo, redo: api.redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const k = keys.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) k.redo();
        else k.undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') { e.preventDefault(); k.toggle(); }
      else if (e.key === 'j' || e.key === 'J') k.prev();
      else if (e.key === 'l' || e.key === 'L') k.next();
      else if (e.key === 'f' || e.key === 'F') k.fullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSlow = useCallback(() => {
    try {
      if (sessionStorage.getItem(PREVIEW_SLOW_SEEN)) return;
      sessionStorage.setItem(PREVIEW_SLOW_SEEN, '1');
    } catch {
      // Without storage it can show again next session; still once here.
    }
    setPreviewSlow(true);
  }, []);

  const library = () => deps.openPanel('Library');

  if (isWindowSmall(size.w, size.h)) return <WindowSmall width={size.w} height={size.h} />;
  if (api.phase === 'missing') return <NoProject onLibrary={library} />;
  if (long && recording) {
    return <FullPage><LongRecording duration={recording.duration} onOpen={() => setLongOk(true)} onLibrary={library} /></FullPage>;
  }

  const ready = projectReady && !!cut && !!recording && firstFrame;
  const readOnly = session !== 'editing';
  const Stage = slots.stage;
  const slotProps: SlotProps | null = project && cut && recording ? {
    recording, project, cut, out: playback.out, length, playing: playback.playing, ready, readOnly, seek: playback.seek, play: playback.play, pause: playback.pause, edit: api.edit,
  } : null;
  // When the files cannot be read at all, the first source stands in as the missing one.
  const failed = mediaFailed ? project?.sources[0] : undefined;
  const missing = media?.missing.find((s) => !dismissed[`missing:${s.id}`]) ?? (failed && !dismissed[`missing:${failed.id}`] ? failed : undefined);
  const removeMissing = (s: Source) => {
    setDismissed((d) => ({ ...d, [`missing:${s.id}`]: true }));
    api.edit((p) => {
      const c = currentCut(p);
      const media = c.media.filter((m) => m.source === s.id).map((m) => m.id);
      const voice = c.voiceovers.filter((m) => m.source === s.id).map((m) => m.id);
      const once = media.length ? removeLayer(p, { kind: 'media', ids: media }) : p;
      return voice.length ? removeLayer(once, { kind: 'voiceovers', ids: voice }) : once;
    });
  };
  const findFile = () => fileInput.current?.click();
  const onPicked = (file: File | undefined) => {
    if (!file || !missing) return;
    deps.putFile(id, missing.file, file).then(() => {
      setMedia(null);
      setMediaFailed(false);
      setMediaKey((k) => k + 1);
    }, (error: unknown) => console.error('Klipkord: could not put the file back', error));
  };

  const banners: ReactNode[] = [];
  if (api.save === 'not-saved') banners.push(<NotSaved key="not-saved" onFreeUp={() => deps.openPanel('Storage')} onRetry={api.retrySave} />);
  if (missing) banners.push(<MediaMissing key="missing" name={missing.name ?? missing.file} onFind={findFile} onRemove={() => removeMissing(missing)} />);
  if (project?.sources.some((s) => s.kind === 'baked') && !dismissed.old) {
    banners.push(<OldRecording key="old" onDismiss={() => setDismissed((d) => ({ ...d, old: true }))} />);
  }
  if (previewSlow) {
    banners.push(<PreviewSlow key="slow" onLight={() => { setPreviewSlow(false); api.edit((p) => ({ ...p, options: { ...p.options, lightPreview: true } })); }} onDismiss={() => setPreviewSlow(false)} />);
  }

  const opening = slowOpen && !firstFrame
    ? <OpeningSlow onWait={() => setSlowOpen(false)} onLibrary={library} />
    : <OpeningSteps times={times} />;
  const extra = slotProps ? slots.topBar?.(slotProps) : undefined;
  const inspector = slotProps ? slots.inspector?.(slotProps) : undefined;
  const Aside = slots.aside;
  const Overlay = slots.overlay;

  return (
    <div style={{ height: '100vh', minHeight: 600, display: 'flex', flexDirection: 'column', background: C.ground, color: C.text, overflow: 'hidden' }}>
      <TopBar name={project?.name ?? recording?.title ?? ''} cutName={cut?.name ?? 'Full'} save={ready || (projectReady && mediaFailed && !firstFrame) ? api.save : 'opening'}
        canUndo={!readOnly && api.canUndo} canRedo={!readOnly && api.canRedo} onUndo={api.undo} onRedo={api.redo} onLibrary={library} {...extra} />
      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
            {slotProps ? (
              <TranscriptColumn {...slotProps} body={slots.transcript} state={transcriptState(slotProps.recording)} onGroq={deps.useGroq} />
            ) : (
              <TranscriptOpening />
            )}
            <section ref={previewRef} aria-label="Preview" style={{ flexGrow: 1, position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0, background: full ? '#000000' : C.ground }}>
              {project && cut ? (
                <Preview project={project} cut={stageCut?.id === cut.id ? stageCut : cut} out={playback.out} playing={playback.playing} sources={sources} events={media?.events}
                  captions={captions} light={project.options.lightPreview} opening={opening} firstFrame={firstFrame}
                  onFirstFrame={() => setFirstFrame(true)} onSlow={onSlow} stageRef={stageRef}>
                  {Stage && slotProps && <Stage {...slotProps} events={media?.events} preview={setStageCut} />}
                </Preview>
              ) : (
                <div ref={stageRef} style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 8 }}>
                  <div style={{ width: 533, height: 300, borderRadius: 6, background: C.raised, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{opening}</div>
                </div>
              )}
              {!full && <Transport out={playback.out} length={length || (recording?.duration ?? 0)} playing={playback.playing} canPlay={firstFrame} shape={cut?.shape ?? '16:9'}
                onToggle={playback.toggle} onPrev={prev} onNext={next} onFullscreen={fullscreen}
                onShape={() => setShapeOpen((o) => !o)} />}
              {!full && shapeOpen && cut && <ShapeMenu shape={cut.shape} fit={cut.fit} readOnly={readOnly} edit={api.edit} onClose={() => setShapeOpen(false)} />}
              <PreviewFullscreen active={full} playing={playback.playing} out={playback.out} length={length || (recording?.duration ?? 0)} onToggle={playback.toggle} seek={playback.seek} onExit={exitFull} />
            </section>
          </div>
          {slotProps ? <TimelineSlot {...slotProps} body={slots.timeline} /> : <TimelineOpening length={recording?.duration} />}
        </div>
        <Inspector panels={ready ? inspector?.panels : undefined} selection={ready ? inspector?.selection : undefined} notices={banners}
          cover={ready && slotProps && Aside ? <Aside {...slotProps} /> : undefined} />
      </div>
      {slotProps && Overlay && <Overlay {...slotProps} />}
      <input ref={fileInput} type="file" hidden onChange={(e) => onPicked(e.target.files?.[0])} />
      {session === 'elsewhere' && (
        <OpenElsewhere onClose={deps.closeTab} onEditHere={() => {
          void sessionRef.current?.take();
        }} />
      )}
      {session === 'editing' && api.recovered && (
        <UnsavedRecovered changes={api.recovered.changes} minutes={minutesAgo(api.recovered.at, Date.now())}
          onKeep={api.keepRecovered} onDiscard={api.discardRecovered} />
      )}
    </div>
  );
}
