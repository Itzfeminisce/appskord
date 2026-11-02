import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { EVENTS_FILE } from '@/lib/events';
import { MARKER_LABEL } from '@/lib/markers';
import { recordingLength } from '@/lib/project/cuts';
import { currentCut, group } from '@/lib/project/history';
import { addChapter, addLayer, LABELS, newId, quote, setTrack, split, updateChapter } from '@/lib/project/ops';
import { recAtEdge, snapPoints, snapRec, trimClip, type Edge, type SnapPoint } from '@/lib/project/snap';
import { spanAt, spans, toRec } from '@/lib/project/time';
import type { EventsTrack, Project, Source } from '@/lib/project/types';
import { videoStore, type Track as StoreTrack } from '@/lib/videoStore';
import { units } from '@/lib/wordCuts';
import type { SlotProps } from '../components/slots';
import { chapterTitle } from '../dialogs/ChaptersEdit';
import { Cuts } from '../dialogs/Cuts';
import { FirstRunTour } from '../dialogs/FirstRunTour';
import { ProjectSettings, withOptions } from '../dialogs/ProjectSettings';
import { Shortcuts } from '../dialogs/Shortcuts';
import { UndoHistory, UndoToast } from '../dialogs/UndoHistory';
import { C, MONO } from '../ui';
import { clock } from '../format';
import { deleteSelected, duplicateLayers, LAYERS, moveClip, runMenu, shiftLayers, speedClips, audioSource, type MenuAction } from './actions';
import { chaptersInCut } from './chapters';
import { Filmstrip, type OpenFrames } from './filmstrip';
import { clampView, dropAt, fitView, HEAD_PX, msPerPx, tOf, viewAtSlider, xOf, type View } from './geometry';
import { SpeedPopover, TimelineMenu } from './Menu';
import { buildRows, type Block, type Row } from './rows';
import { Ruler } from './Ruler';
import { openDialog, resetTimeline, select, setTimeline, useTimeline, type Selected } from './store';
import { Toolbar } from './Toolbar';
import { ROW_PX, Track, type Part } from './Tracks';


/** What the timeline reads outside React; tests pass fakes. */
export interface TimelineIO {
  /** Click times (recording ms) from the events track, for snapping. */
  loadClicks(project: Project): Promise<number[]>;
  loadVideo(project: Project, source: Source): Promise<Blob>;
  openFrames?: OpenFrames;
  /** How long after the first frame the filmstrip pass starts, so it never slows the editor opening. */
  filmDelay?: number;
}

export const browserIO: TimelineIO = {
  async loadClicks(project) {
    if (!project.events) return [];
    const file = await videoStore.read(project.id, EVENTS_FILE as StoreTrack);
    if (file.size === 0) return [];
    return (JSON.parse(await file.text()) as EventsTrack).events.filter((e) => e.type === 'click').map((e) => e.t);
  },
  loadVideo: (project, source) => videoStore.read(project.id, source.file as StoreTrack, source.mime),
  filmDelay: 1500,
};

const SNAP_PX = 8;
const DRAG_PX = 3;
const FRAME_MS = 1000 / 30;
const ZOOM_MS = 3000;

type Drag =
  | { type: 'trim'; id: string; index: number; edge: Edge; start: number; end: number; rec: number }
  | { type: 'clip'; id: string; d: number }
  | { type: 'layer'; block: Block; ids: string[]; d: number; dRec: number }
  | { type: 'edge'; block: Block; edge: Edge; out: number; rec: number }
  | { type: 'box'; row: number; x0: number; y0: number; x1: number; y1: number }
  | { type: 'flag'; index: number; at: number };

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const sameKind = (sel: Selected | null, kind: Selected['kind']) => sel?.kind === kind;

/** The timeline (T7): toolbar, ruler, tracks, playhead, menus, the dialogs the top bar opens and the first-run tour. */
export function Timeline({ io = browserIO, ...p }: SlotProps & { io?: TimelineIO }) {
  const { project, cut, recording, out, length, playing, seek, edit, readOnly } = p;
  const tl = useTimeline();
  const root = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [view, setView] = useState<View>(() => fitView(length));
  const fitted = useRef(true);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragState(d); };
  const [hint, setHint] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; at: number; block: Block } | null>(null);
  const [clicks, setClicks] = useState<number[]>([]);
  const [film, setFilm] = useState<Filmstrip | null>(null);

  useEffect(() => { resetTimeline(); return () => resetTimeline(); }, [project.id]);

  // The width of the time area; the track names column takes HEAD_PX.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(100, el.clientWidth - HEAD_PX));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A fitted view stays fitted as the cut's length changes; a zoomed one stays where it is.
  useEffect(() => {
    setView((v) => (fitted.current ? fitView(length) : clampView(v, length)));
  }, [length]);

  // While playing, the view follows the playhead.
  useEffect(() => {
    if (!playing || (out >= view.start && out <= view.end)) return;
    const span = view.end - view.start;
    fitted.current = false;
    setView(clampView({ start: out - span * 0.1, end: out + span * 0.9 }, length));
  }, [out, playing, view, length]);

  useEffect(() => {
    let live = true;
    io.loadClicks(project).then((c) => { if (live) setClicks(c); }, (error: unknown) => console.error('Klipkord: could not read the clicks', error));
    return () => { live = false; };
  }, [project.id, project.events, io]); // eslint-disable-line react-hooks/exhaustive-deps

  const screen = useMemo(() => project.sources.find((s) => s.kind === 'screen') ?? project.sources.find((s) => s.kind === 'baked'), [project.sources]);
  useEffect(() => {
    if (!screen || !screen.video) return;
    const strip = new Filmstrip({ key: `${project.id}:${screen.id}`, duration: screen.duration, load: () => io.loadVideo(project, screen), ...(io.openFrames && { open: io.openFrames }) });
    setFilm(strip);
    const timer = setTimeout(() => void strip.run(), io.filmDelay ?? 0);
    return () => { clearTimeout(timer); strip.dispose(); };
  }, [screen, io]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { film?.setPlaying(playing); }, [film, playing]);

  const words = useMemo(() => units(recording.transcript), [recording.transcript]);
  const clipSpans = useMemo(() => spans(cut), [cut]);
  const chapters = useMemo(() => chaptersInCut(project, cut), [project, cut]);
  const points = useMemo<SnapPoint[]>(() => snapPoints({
    words, clicks,
    markers: [...project.chapters, ...recording.markers.map((m) => ({ at: m.at, title: MARKER_LABEL[m.kind] }))],
  }), [words, clicks, project.chapters, recording.markers]);
  const rows = useMemo(() => buildRows(project, cut, clipSpans, view), [project, cut, clipSpans, view]);
  const selectedIds = useMemo(() => new Set(tl.selected?.kind === 'chapters' ? [] : tl.selected?.ids ?? []), [tl.selected]);
  const recMax = useMemo(() => recordingLength(project.sources), [project.sources]);

  const xToOut = useCallback((clientX: number) => {
    const left = (root.current?.getBoundingClientRect().left ?? 0) + HEAD_PX;
    return Math.max(0, tOf(clientX - left, view, width));
  }, [view, width]);
  const threshold = msPerPx(view, width) * SNAP_PX;
  /** The snap distance in recording ms where `out` falls: a 2x clip covers twice the recording per pixel. */
  const recThreshold = (out: number) => {
    const span = spanAt(cut, out);
    return threshold * (span && !span.clip.gap ? span.clip.speed : 1);
  };
  const locked = (name: string) => !!cut.tracks[name]?.locked;
  const lockedKind = (b: Block) => (b.kind === 'clips' ? locked('screen') : b.kind === 'overlays' || b.kind === 'cards' ? locked('overlays') : locked(LAYERS[b.kind] ?? b.kind));
  const snapHint = (point: SnapPoint | null) => (point ? `Snapped to ${quote(point.label)}` : '');

  const finish = () => { setDrag(null); setHint(''); };
  // The drag in progress; dropped without committing on pointercancel or unmount.
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  /** Follows the pointer until it is released; `move` gets the output time and whether the drag has started. */
  const follow = (e: ReactPointerEvent, move: (ev: PointerEvent, moved: boolean) => void, up: (ev: PointerEvent, moved: boolean) => void) => {
    stopDrag.current?.();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const id = e.pointerId;
    const target = e.target as Element;
    // Captured, the drag keeps its pointer when it leaves the window or crosses an iframe.
    try { target.setPointerCapture?.(id); } catch { /* the pointer is already gone */ }
    let moved = false;
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id);
      stopDrag.current = null;
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return;
      moved = true;
      move(ev, moved);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      stop();
      up(ev, moved);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      stop();
      finish();
    };
    stopDrag.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const onBlockDown = (e: ReactPointerEvent, b: Block, part: Part) => {
    e.stopPropagation();
    if (e.shiftKey) {
      const sel = tl.selected;
      const ids = sameKind(sel, b.kind) ? (sel!.ids.includes(b.id) ? sel!.ids.filter((x) => x !== b.id) : [...sel!.ids, b.id]) : [b.id];
      select(ids.length ? { kind: b.kind, ids } : null);
      return;
    }
    const already = sameKind(tl.selected, b.kind) && tl.selected!.ids.includes(b.id);
    const ids = already ? tl.selected!.ids : [b.id];
    if (!already) select({ kind: b.kind, ids });
    if (readOnly || lockedKind(b)) return;
    const startOut = xToOut(e.clientX);
    if (b.kind === 'clips' && b.look === 'screen') {
      const span = clipSpans[b.index ?? -1];
      if (!span) return;
      if (part !== 'body') {
        const edge: Edge = part;
        follow(e, (ev) => {
          const rec = recAtEdge(cut.clips, span.index, xToOut(ev.clientX)) ?? 0;
          // A gap has no recording under it, so its edge never snaps.
          const s = snapRec(points, rec, threshold * (span.clip.gap ? 1 : span.clip.speed), ev.altKey || !tl.snap || !!span.clip.gap);
          const at = span.start + (s.rec - span.clip.in) / (span.clip.gap ? 1 : span.clip.speed);
          setDrag({ type: 'trim', id: b.id, index: span.index, edge, start: edge === 'start' ? Math.min(at, span.end - 1) : span.start, end: edge === 'end' ? Math.max(at, span.start + 1) : span.end, rec: s.rec });
          setHint(snapHint(s.point));
        }, (_ev, moved) => {
          const d = dragRef.current;
          finish();
          if (moved && d?.type === 'trim') edit((proj) => trimClip(proj, { id: d.id, edge: d.edge, rec: d.rec, max: recMax }));
        });
        return;
      }
      follow(e, (ev) => setDrag({ type: 'clip', id: b.id, d: xToOut(ev.clientX) - startOut }), (ev, moved) => {
        finish();
        if (!moved) return;
        const dropped = span.start + (xToOut(ev.clientX) - startOut) + (span.end - span.start) / 2;
        edit((proj) => moveClip(proj, { id: b.id, at: dropAt(currentCut(proj), b.id, dropped), words }));
      });
      return;
    }
    const kind = LAYERS[b.kind];
    if (!kind || !b.movable) return;
    if (part !== 'body') {
      const edge: Edge = part;
      follow(e, (ev) => {
        const o = xToOut(ev.clientX);
        const s = snapRec(points, toRec(cut, o) ?? 0, recThreshold(o), ev.altKey || !tl.snap);
        setDrag({ type: 'edge', block: b, edge, out: o, rec: s.rec });
        setHint(snapHint(s.point));
      }, (_ev, moved) => {
        const d = dragRef.current;
        finish();
        if (moved && d?.type === 'edge') edit((proj) => shiftLayers(proj, kind, [b.id], { edge: d.edge, rec: d.rec }));
      });
      return;
    }
    const item = (cut[kind] as { id: string; at: number }[]).find((x) => x.id === b.id);
    if (!item) return;
    follow(e, (ev) => {
      const d = xToOut(ev.clientX) - startOut;
      const target = toRec(cut, b.start + d);
      const s = snapRec(points, target ?? item.at + d, recThreshold(b.start + d), ev.altKey || !tl.snap);
      setDrag({ type: 'layer', block: b, ids, d, dRec: s.rec - item.at });
      setHint(snapHint(s.point));
    }, (_ev, moved) => {
      const d = dragRef.current;
      finish();
      if (moved && d?.type === 'layer' && d.dRec !== 0) edit((proj) => shiftLayers(proj, kind, d.ids, { dRec: d.dRec }));
    });
  };

  const onBlockMenu = (e: ReactMouseEvent, b: Block) => {
    e.preventDefault();
    if (!(sameKind(tl.selected, b.kind) && tl.selected!.ids.includes(b.id))) select({ kind: b.kind, ids: [b.id] });
    if (b.kind === 'music') return;
    setMenu({ x: e.clientX, y: e.clientY, at: xToOut(e.clientX), block: b });
  };

  const onEmptyDown = (e: ReactPointerEvent, row: Row) => {
    if (e.button !== 0) return;
    const rect = area.current?.getBoundingClientRect();
    const top = (rect?.top ?? 0) - (area.current?.scrollTop ?? 0);
    const rowIndex = rows.indexOf(row);
    const x0 = e.clientX;
    const y0 = e.clientY;
    follow(e, (ev) => setDrag({ type: 'box', row: rowIndex, x0, y0, x1: ev.clientX, y1: ev.clientY }), (ev, moved) => {
      finish();
      if (!moved) {
        select(null);
        seek(xToOut(ev.clientX));
        return;
      }
      const a = xToOut(Math.min(x0, ev.clientX));
      const b = xToOut(Math.max(x0, ev.clientX));
      const r0 = Math.floor((Math.min(y0, ev.clientY) - top) / (ROW_PX + 1));
      const r1 = Math.floor((Math.max(y0, ev.clientY) - top) / (ROW_PX + 1));
      const hits = rows.slice(Math.max(0, r0), r1 + 1).flatMap((r) => r.blocks).filter((x) => x.end > a && x.start < b && !x.gap);
      const kind = row.blocks[0]?.kind ?? hits[0]?.kind;
      const ids = [...new Set(hits.filter((x) => x.kind === kind).map((x) => x.id))];
      select(kind && ids.length ? { kind, ids } : null);
    });
  };

  const onScrub = (e: ReactPointerEvent) => {
    seek(xToOut(e.clientX));
    follow(e, (ev) => seek(xToOut(ev.clientX)), () => {});
  };

  const onFlag = (e: ReactPointerEvent, c: { index: number; at: number }) => {
    follow(e, (ev) => setDrag({ type: 'flag', index: c.index, at: xToOut(ev.clientX) }), (ev, moved) => {
      finish();
      if (!moved) { select({ kind: 'chapters', ids: [String(c.index)] }); return; }
      const rec = toRec(cut, xToOut(ev.clientX));
      if (rec !== null) edit((proj) => updateChapter(proj, { index: c.index, patch: { at: Math.round(rec) } }));
    });
  };

  const onToggle = (row: Row, flag: 'hidden' | 'locked' | 'muted') => {
    const on = !row.tracks.every((t) => !!cut.tracks[t]?.[flag]);
    const patch = { [flag]: on };
    edit((proj) => (row.tracks.length === 1
      ? setTrack(proj, { name: row.tracks[0]!, patch, label: trackLabel(flag, on, row.name) })
      : group(proj, trackLabel(flag, on, row.name), (q) => row.tracks.reduce((r, name) => setTrack(r, { name, patch }), q))));
  };

  const addZoom = useCallback(() => {
    const rec = toRec(cut, out);
    if (rec === null || readOnly) return;
    const id = newId();
    edit((proj) => addLayer(proj, { kind: 'zooms', items: [{ id, at: Math.round(rec), end: Math.round(Math.min(rec + ZOOM_MS, recMax)), depth: 1.5, focus: project.events ? 'cursor' : { x: 0.5, y: 0.5 }, feel: 'smooth', auto: false }] }));
    select({ kind: 'zooms', ids: [id] });
  }, [cut, out, readOnly, edit, recMax, project.events]);

  const external = (name: 'text' | 'voiceover' | 'media' | 'music') => tl.actions[name]?.();
  const onHint = (add: NonNullable<Row['hint']>['add']) => {
    if (add === 'zoom') addZoom();
    else if (add) external(add);
  };

  const splitAtPlayhead = useCallback(() => { if (!readOnly && !locked('screen')) edit((proj) => split(proj, { at: out })); }, [edit, out, readOnly, cut.tracks]); // eslint-disable-line react-hooks/exhaustive-deps
  const deleteSelection = useCallback((leaveGap = false) => {
    const sel = tl.selected;
    if (!sel || readOnly) return;
    if (sel.kind === 'chapters') return;
    select(null);
    edit((proj) => deleteSelected(proj, sel, leaveGap));
  }, [tl.selected, readOnly, edit]);
  const openSpeed = useCallback(() => {
    if (!sameKind(tl.selected, 'clips')) {
      const s = spanAt(cut, out);
      if (!s || s.clip.gap) return;
      select({ kind: 'clips', ids: [s.clip.id] });
    }
    setTimeline({ speedOpen: true });
  }, [tl.selected, cut, out]);
  const fit = useCallback(() => { fitted.current = true; setView(fitView(length)); }, [length]);
  const addChapterHere = useCallback(() => {
    const rec = toRec(cut, out);
    if (rec === null || readOnly) return;
    edit((proj) => addChapter(proj, { chapter: { at: Math.round(rec), title: chapterTitle(words, rec, out) } }));
  }, [cut, out, readOnly, edit, words]);

  const pick = (action: MenuAction) => {
    const sel = tl.selected;
    if (!sel || !menu) return;
    if (sel.kind !== 'clips') {
      if (action === 'duplicate') edit((proj) => duplicateLayers(proj, sel));
      else deleteSelection();
      return;
    }
    let result: ReturnType<typeof runMenu> | null = null;
    edit((proj) => {
      result = runMenu(proj, action, sel.ids, { at: menu.at, clipboard: tl.clipboard, words });
      return result.project;
    });
    const r = result as ReturnType<typeof runMenu> | null;
    if (!r) return;
    if (r.clipboard) setTimeline({ clipboard: r.clipboard });
    if (r.speed) setTimeline({ speedOpen: true });
    if (r.renaming) setTimeline({ selected: null, dialog: 'cuts', renaming: true });
    if (action === 'deleteClose' || action === 'deleteGap') select(null);
  };

  // Keys the timeline owns; the shell keeps Space, J, L, F and Undo.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (typing(e.target) || e.defaultPrevented) return;
    if (e.key === '?') { e.preventDefault(); openDialog(tl.dialog === 'shortcuts' ? null : 'shortcuts'); return; }
    if (tl.dialog || menu) return;
    if (e.key === 'Escape') { if (tl.speedOpen) setTimeline({ speedOpen: false }); else select(null); return; }
    const sel = tl.selected;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && sel?.kind === 'clips' && ['d', 'c', 'v'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const action: MenuAction = e.key.toLowerCase() === 'd' ? 'duplicate' : e.key.toLowerCase() === 'c' ? 'copy' : 'paste';
      let result: ReturnType<typeof runMenu> | null = null;
      if (action === 'copy') result = runMenu(project, 'copy', sel.ids, { at: out, clipboard: tl.clipboard, words });
      else edit((proj) => { result = runMenu(proj, action, sel.ids, { at: out, clipboard: tl.clipboard, words }); return result.project; });
      const r = result as ReturnType<typeof runMenu> | null;
      if (r?.clipboard) setTimeline({ clipboard: r.clipboard });
      return;
    }
    if (mod || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Delete' || k === 'Backspace') { if (sel && sel.kind !== 'chapters') { e.preventDefault(); deleteSelection(e.shiftKey); } return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); seek(Math.max(0, Math.min(length, out + (k === 'ArrowLeft' ? -FRAME_MS : FRAME_MS)))); return; }
    if (k === 's') splitAtPlayhead();
    else if (k === 'r') openSpeed();
    else if (k === 'z') { if (e.shiftKey) fit(); else addZoom(); }
    else if (k === 't') external('text');
    else if (k === 'v') external('voiceover');
    else if (k === 'a') external('media');
    else if (k === 'n') setTimeline({ snap: !tl.snap });
    else if (k === 'm') addChapterHere();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // Ctrl or Cmd + wheel zooms around the pointer; a sideways wheel pans.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const at = xToOut(e.clientX);
        const scale = Math.exp(e.deltaY * 0.002);
        fitted.current = false;
        setView((v) => clampView({ start: at - (at - v.start) * scale, end: at + (v.end - at) * scale }, length));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const d = (e.shiftKey ? e.deltaY : e.deltaX) * msPerPx(view, width);
        fitted.current = false;
        setView((v) => clampView({ start: v.start + d, end: v.end + d }, length));
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [xToOut, length, view, width]);

  // Holding Undo opens the history, as right-clicking does; the click that ends the hold does not undo.
  useEffect(() => {
    let timer = 0;
    let swallow = false;
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[aria-label="Undo (Ctrl+Z)"]') || e.button !== 0) return;
      timer = window.setTimeout(() => { swallow = true; openDialog('history'); }, 500);
    };
    const up = () => clearTimeout(timer);
    const click = (e: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('click', click, true);
    return () => { clearTimeout(timer); window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('click', click, true); };
  }, []);

  // Working in the transcript ends the timeline selection, so Delete never hits both.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('section[aria-label="Transcript"]')) select(null);
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, []);

  const moved = (b: Block): { start: number; end: number } | null => {
    if (!drag) return null;
    if (drag.type === 'trim' && b.id === drag.id && b.kind === 'clips') return { start: drag.start, end: drag.end };
    if (drag.type === 'clip' && b.id === drag.id && b.look === 'screen') return { start: b.start + drag.d, end: b.end + drag.d };
    if (drag.type === 'layer' && b.kind === drag.block.kind && drag.ids.includes(b.id)) return { start: b.start + drag.d, end: b.end + drag.d };
    if (drag.type === 'edge' && b.key === drag.block.key) return drag.edge === 'start' ? { start: Math.min(drag.out, b.end - 1), end: b.end } : { start: b.start, end: Math.max(drag.out, b.start + 1) };
    return null;
  };

  const sel = tl.selected;
  const multi = sel && sel.kind !== 'chapters' && sel.ids.length > 1 ? `${sel.ids.length} selected` : '';
  const zoomHint = sel?.kind === 'zooms' && sel.ids.length === 1 ? 'Drag the edges to change when it zooms in and out' : '';
  const toolbarHint = hint || (sel?.kind === 'chapters' || drag?.type === 'flag' ? 'Drag a flag to move a chapter' : multi || zoomHint);
  const playX = xOf(out, view, width);
  const atClip = spanAt(cut, out);
  const speedClipsSel = sel?.kind === 'clips' && tl.speedOpen ? cut.clips.filter((c) => sel.ids.includes(c.id)) : [];
  const speedSpan = speedClipsSel[0] ? clipSpans.find((s) => s.clip.id === speedClipsSel[0]!.id) : undefined;
  const speedLeft = speedSpan ? Math.max(8, Math.min(width + HEAD_PX - 288, HEAD_PX + xOf((speedSpan.start + speedSpan.end) / 2, view, width) - 140)) : 0;
  const onTourDone = useCallback(() => edit(withOptions({ tour: false })), [edit]);
  const box = drag?.type === 'box' && root.current ? (() => {
    const r = root.current!.getBoundingClientRect();
    return { left: Math.min(drag.x0, drag.x1) - r.left, top: Math.min(drag.y0, drag.y1) - r.top, width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) };
  })() : null;

  return (
    <div ref={root} data-timeline style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', userSelect: 'none' }}>
      <Toolbar view={view} length={length} snap={tl.snap} hint={toolbarHint}
        can={{
          split: !readOnly && !!atClip && out > atClip.start && !locked('screen'), delete: !readOnly && !!sel && sel.kind !== 'chapters',
          speed: !readOnly && (sel?.kind === 'clips' || (!!atClip && !atClip.clip.gap)), zoom: !readOnly && toRec(cut, out) !== null,
          text: !readOnly && !!tl.actions.text, voiceover: !readOnly && !!tl.actions.voiceover, media: !readOnly && !!tl.actions.media,
        }}
        onSplit={splitAtPlayhead} onDelete={() => deleteSelection()} onSpeed={openSpeed} onZoom={addZoom}
        onText={() => external('text')} onVoiceover={() => external('voiceover')} onMedia={() => external('media')}
        onSnap={() => setTimeline({ snap: !tl.snap })} onFit={fit}
        onSlider={(v) => { fitted.current = v === 0; setView(viewAtSlider(v, length, out)); }} />
      <Ruler view={view} width={width} chapters={chapters} dragging={drag?.type === 'flag' ? drag : null} onScrub={onScrub} onFlag={onFlag} />
      <div ref={area} style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rows.map((row, i) => (
          <Track key={`${row.key}:${i}`} row={row} cut={cut} view={view} width={width} selected={selectedIds} moved={moved}
            strip={row.key === 'screen' ? { kind: 'film', clipSpans, film, offset: screen?.offset ?? 0 } : row.key === 'voice' ? { kind: 'wave', clipSpans, words } : undefined}
            onBlockDown={onBlockDown} onBlockMenu={onBlockMenu} onEmptyDown={onEmptyDown} onHint={onHint} onToggle={onToggle} />
        ))}
      </div>
      {playX >= 0 && playX <= width && (
        <span aria-hidden="true" style={{ position: 'absolute', left: HEAD_PX + playX, top: 36, bottom: 0, width: 2, background: '#FFFFFF', zIndex: 4, pointerEvents: 'none' }}>
          <span style={{ position: 'absolute', top: 0, left: -5, width: 12, height: 10, borderRadius: 2, background: '#FFFFFF' }} />
          <span style={{ position: 'absolute', top: -16, left: 6, padding: '0 4px', borderRadius: 3, background: '#FFFFFF', color: C.ground, fontFamily: MONO, fontSize: 10, lineHeight: '14px', whiteSpace: 'nowrap' }}>{clock(out)}</span>
        </span>
      )}
      {box && <span aria-hidden="true" style={{ position: 'absolute', ...box, border: `1px solid ${C.accentText}`, background: 'rgba(251,146,60,0.12)', zIndex: 5, pointerEvents: 'none' }} />}
      {menu && (
        <TimelineMenu x={menu.x} y={menu.y} clip={menu.block.kind === 'clips'} canPaste={tl.clipboard.length > 0} canDetach={!!audioSource(project.sources)}
          onPick={pick} onClose={() => setMenu(null)} />
      )}
      {speedClipsSel.length > 0 && (
        <SpeedPopover clips={speedClipsSel} left={speedLeft} onClose={() => setTimeline({ speedOpen: false })}
          onSpeed={(args) => edit((proj) => speedClips(proj, sel!.ids, args, words))} />
      )}
      <UndoToast p={p} />
      {tl.dialog === 'cuts' && <Cuts p={p} renaming={tl.renaming} onClose={() => setTimeline({ dialog: null, renaming: false })} />}
      {tl.dialog === 'history' && <UndoHistory p={p} onClose={() => openDialog(null)} />}
      {tl.dialog === 'shortcuts' && <Shortcuts onClose={() => openDialog(null)} />}
      {tl.dialog === 'settings' && <ProjectSettings p={p} onClose={() => openDialog(null)} />}
      {project.options.tour && !readOnly && !tl.dialog && <FirstRunTour onDone={onTourDone} />}
    </div>
  );
}

function trackLabel(flag: 'hidden' | 'locked' | 'muted', on: boolean, name: string): string {
  const verb = flag === 'hidden' ? (on ? 'Hid' : 'Showed') : flag === 'locked' ? (on ? 'Locked' : 'Unlocked') : on ? 'Muted' : 'Unmuted';
  return LABELS.track(verb, name);
}
