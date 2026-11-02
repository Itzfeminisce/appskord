import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { findAll, listed, type Find } from '@/lib/project/cleanup';
import { restoreWords } from '@/lib/project/ops';
import { isKept, toRec } from '@/lib/project/time';
import { units as unitsOf } from '@/lib/wordCuts';
import { TranscriptFrame, type TranscriptSlotProps } from '../components/slots';
import { SuggestedEdits } from '../dialogs/SuggestedEdits';
import { useDraftUnits } from '../ai/store';
import { clock } from '../format';
import { C, Icon, iconButton, MONO } from '../ui';
import { FindBar } from './FindBar';
import { ICON } from './icons';
import { isUnitKept, lineViews, moveBefore, outAt, rangeText, type LineView, type Match, type Range } from './model';
import { SelectBar } from './SelectBar';
import { resetUi, setUi, toggleOff, useUi } from './store';

const WORD: CSSProperties = { padding: '1px 0', borderRadius: 3 };
const STYLE: Record<string, CSSProperties> = {
  cut: { color: C.muted, textDecoration: 'line-through' },
  filler: { textDecoration: `underline dotted ${C.muted}`, textUnderlineOffset: 3 },
  clean: { background: 'rgba(194,65,12,0.18)', color: C.accentText, textDecoration: 'line-through', cursor: 'pointer' },
  selected: { background: 'rgba(251,146,60,0.32)', color: '#FFFFFF', cursor: 'grab' },
  match: { background: 'rgba(250,204,21,0.35)', color: '#FFFFFF' },
  current: { background: '#FACC15', color: '#111114' },
  drop: { boxShadow: `inset 2px 0 0 ${C.accentText}` },
};

function wordStyle(flags: string): CSSProperties {
  let s: CSSProperties = WORD;
  if (flags.includes('-')) s = { ...s, ...STYLE.cut };
  else if (flags.includes('x')) s = { ...s, ...STYLE.clean };
  else if (flags.includes('f')) s = { ...s, ...STYLE.filler };
  if (flags.includes('M')) s = { ...s, ...STYLE.current };
  else if (flags.includes('m')) s = { ...s, ...STYLE.match };
  if (flags.includes('s')) s = { ...s, ...STYLE.selected };
  if (flags.includes('d')) s = { ...s, ...STYLE.drop };
  return s;
}

const HEADING: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 4px', color: C.muted, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' };
const TIME: CSSProperties = { fontFamily: MONO, fontSize: 11, color: C.muted, paddingTop: 3, width: 30, flexShrink: 0 };

/** `flags` is the line's own flags joined by ',' so memo compares them by value. */
interface LineProps { view: LineView; texts: string[]; flags: string; time: string; pauseTime?: string; pauseCut: boolean; playing: boolean; first: boolean }

const Line = memo(function Line({ view, texts, flags, time, pauseTime, pauseCut, playing, first }: LineProps) {
  const words = [];
  const own = flags.split(',');
  for (let i = view.first; i <= view.last; i++) {
    if (i > view.first) words.push(' ');
    words.push(<span key={i} data-i={i} style={wordStyle(own[i - view.first]!)}>{texts[i - view.first]}</span>);
  }
  return (
    <>
      {view.pause && (
        <div style={{ display: 'flex', gap: 10, padding: '4px 6px', borderRadius: 6 }}>
          <span style={TIME}>{pauseTime}</span>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>
            <span style={{ ...WORD, padding: '1px 4px', fontFamily: MONO, fontSize: 11, color: C.muted, border: `1px dashed ${C.line}`, ...(pauseCut && { textDecoration: 'line-through' }) }}>
              {`${((view.pause.end - view.pause.start) / 1000).toFixed(1)} s pause`}
            </span>
          </p>
        </div>
      )}
      {view.chapters.map((c, k) => (
        <div key={c.index} style={{ ...HEADING, ...(first && k === 0 && !view.pause && { margin: '0 0 4px' }) }}>
          <Icon size={12}>{ICON.flag}</Icon><span>{c.title}</span>
        </div>
      ))}
      <div data-line={view.line} style={{ display: 'flex', gap: 10, padding: '4px 6px', borderRadius: 6, ...(playing && { background: C.raised }) }}>
        <span style={TIME}>{time}</span>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, userSelect: 'none' }}>{words}</p>
      </div>
    </>
  );
});

const HINT = {
  idle: 'Click a word to jump. Select words and press Delete to cut.',
  selected: 'Drag the selection to move this part. Shift+click to extend.',
  search: 'Replace fixes the words and captions. The audio stays as you said it.',
  cleanup: 'Highlighted words will be cut. Click one to keep it.',
};

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** T6: the transcript column, edited like a document. */
export function TranscriptPanel(p: TranscriptSlotProps) {
  const { recording, project, cut, out, length, readOnly, seek, edit } = p;
  const ui = useUi();
  const units = useMemo(() => unitsOf(recording.transcript), [recording.transcript]);
  const lines = useMemo(() => lineViews(units, project.chapters), [units, project.chapters]);
  const kept = useMemo(() => units.map((u) => isUnitKept(cut, u)), [units, cut]);
  const finds = useMemo(() => findAll(recording.transcript, cut, ui.settings, project.wordFixes), [recording.transcript, cut, ui.settings, project.wordFixes]);
  // A waiting AI draft shows in orange, like Clean up's finds.
  const draft = useDraftUnits(project, recording);
  const fillerUnits = useMemo(() => new Set(finds.fillers.flatMap((f) => f.units)), [finds]);
  // Clean up open: the words of every ticked filler and retake, by find.
  const cleanBy = useMemo(() => {
    const m = new Map<number, Find>();
    if (ui.cleanup) for (const f of listed(finds, ui.settings)) if (!ui.off.has(f.id)) f.units.forEach((i) => m.set(i, f));
    return m;
  }, [ui.cleanup, ui.off, ui.settings, finds]);

  const [sel, setSel] = useState<Range | null>(null);
  const [search, setSearch] = useState(false);
  const [matches, setMatches] = useState<{ list: Match[]; current: number }>({ list: [], current: -1 });
  const [drop, setDrop] = useState<number | null>(null);
  const anchor = useRef<number | null>(null);
  const drag = useRef<{ mode: 'select' | 'move'; from: number; moved: boolean } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => () => resetUi(), []);
  // An edit can leave the selection pointing past the words it covered.
  useEffect(() => { setSel((s) => (s && s.hi < units.length ? s : null)); }, [units.length]);

  const flags = useMemo(() => {
    const matchOf = new Map<number, string>();
    matches.list.forEach((m, k) => { for (let i = m.lo; i <= m.hi; i++) matchOf.set(i, k === matches.current ? 'M' : 'm'); });
    return units.map((_, i) => {
      let f = kept[i] ? '' : '-';
      if (cleanBy.has(i) || draft.has(i)) f += 'x';
      if (fillerUnits.has(i)) f += 'f';
      if (search) f += matchOf.get(i) ?? '';
      if (sel && i >= sel.lo && i <= sel.hi) f += 's';
      if (drop === i) f += 'd';
      return f || '.';
    });
  }, [units, kept, cleanBy, draft, fillerUnits, search, matches, sel, drop]);

  const rec = toRec(cut, out);
  const playingLine = rec === null ? -1 : lines.findIndex((l, k) => rec >= l.start && rec < (lines[k + 1]?.start ?? Infinity));

  useEffect(() => {
    if (!p.playing || playingLine < 0) return;
    const el = scroller.current?.querySelector(`[data-line="${lines[playingLine]!.line}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [playingLine, p.playing, lines]);

  const seekTo = useCallback((i: number) => seek(outAt(cut, units[i]!.start)), [seek, cut, units]);

  const state = useRef({ sel, kept, cleanBy, units, readOnly, seekTo, lines });
  state.current = { sel, kept, cleanBy, units, readOnly, seekTo, lines };

  const indexAt = (target: EventTarget | null): number | null => {
    const el = target instanceof Element ? target.closest('[data-i]') : null;
    return el ? Number(el.getAttribute('data-i')) : null;
  };

  const onMouseDown = (e: ReactMouseEvent) => {
    const i = indexAt(e.target);
    if (i === null || e.button !== 0) return;
    e.preventDefault();
    const s = state.current;
    if (e.shiftKey && anchor.current !== null) {
      setSel({ lo: Math.min(anchor.current, i), hi: Math.max(anchor.current, i) });
      return;
    }
    if (s.sel && i >= s.sel.lo && i <= s.sel.hi && !s.readOnly) drag.current = { mode: 'move', from: i, moved: false };
    else drag.current = { mode: 'select', from: i, moved: false };
  };

  const onMouseOver = (e: ReactMouseEvent) => {
    const d = drag.current;
    const i = indexAt(e.target);
    if (!d || i === null) return;
    if (i !== d.from) d.moved = true;
    if (d.mode === 'select' && d.moved) {
      anchor.current = d.from;
      setSel({ lo: Math.min(d.from, i), hi: Math.max(d.from, i) });
    } else if (d.mode === 'move') {
      const s = state.current.sel!;
      setDrop(i >= s.lo && i <= s.hi + 1 ? null : i);
    }
  };

  useEffect(() => {
    const up = (e: MouseEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const s = state.current;
      const i = indexAt(e.target) ?? d.from;
      setDrop(null);
      if (d.mode === 'move' && d.moved && s.sel) {
        if (i < s.sel.lo || i > s.sel.hi + 1) {
          const r = s.sel;
          edit((q) => moveBefore(q, s.units, r, i, s.lines));
          setSel(null);
        }
        return;
      }
      if (d.moved) return;
      // A click: a struck word comes back; a word Clean up would cut is kept; any other word jumps there.
      const find = s.cleanBy.get(i);
      if (find) { toggleOff(find.id); return; }
      if (!s.kept[i] && !s.readOnly) { edit((q) => restoreWords(q, { units: s.units, from: i, to: i })); return; }
      anchor.current = i;
      setSel(null);
      s.seekTo(i);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [edit]);

  const openSearch = useCallback(() => { setSearch(true); setSel(null); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
        return;
      }
      if (typing(e.target)) return;
      if (e.key === 'Escape') { setSel(null); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch]);

  const lineTexts = useMemo(() => lines.map((v) => units.slice(v.first, v.last + 1).map((u, k) => project.wordFixes[v.first + k] ?? u.text)), [lines, units, project.wordFixes]);
  const lineFlags = useMemo(() => lines.map((v) => flags.slice(v.first, v.last + 1).join(',')), [lines, flags]);
  const selected = sel ? rangeText(units, sel, project.wordFixes) : '';
  const hint = ui.cleanup ? HINT.cleanup : search ? HINT.search : sel ? HINT.selected : HINT.idle;

  const tools = (
    <>
      <button type="button" aria-label="Find in transcript (Ctrl+F)" title="Find in transcript (Ctrl+F)" onClick={openSearch} style={iconButton(28)}>
        <Icon>{ICON.search}</Icon>
      </button>
      <button type="button" onClick={() => setUi({ cleanup: true, off: new Set() })} disabled={readOnly} style={{
        height: 28, padding: '0 12px', borderRadius: 8, background: C.raised, color: C.text, border: `1px solid ${C.line}`, fontFamily: 'inherit', fontSize: 13,
        fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', boxSizing: 'border-box',
      }}><Icon size={15}>{ICON.wand}</Icon><span>Clean up</span></button>
    </>
  );
  const footer = (
    <>
      {!search && !sel && !ui.cleanup && <span>{clock(length)}</span>}
      <span style={{ color: C.muted }}>{hint}</span>
    </>
  );

  return (
    <TranscriptFrame tools={tools} footer={footer}>
      {search && (
        <FindBar units={units} project={project} cut={cut} readOnly={readOnly} edit={edit}
          onMatches={(list, current) => {
            setMatches({ list, current });
            const m = list[current];
            if (m) {
              seekTo(m.lo);
              scroller.current?.querySelector(`[data-i="${m.lo}"]`)?.scrollIntoView?.({ block: 'nearest' });
            }
          }}
          onClose={() => { setSearch(false); setMatches({ list: [], current: -1 }); }} />
      )}
      <div ref={scroller} onMouseDown={onMouseDown} onMouseOver={onMouseOver}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: 2, position: 'relative', paddingBottom: 48 }}>
        {lines.map((view, k) => (
          <div key={view.line} style={{ position: 'relative' }}>
            <Line view={view} texts={lineTexts[k]!} flags={lineFlags[k]!}
              time={clock(outAt(cut, view.start))} pauseTime={view.pause ? clock(outAt(cut, view.pause.start)) : undefined}
              pauseCut={!!view.pause && !isKept(cut, (view.pause.start + view.pause.end) / 2)} playing={k === playingLine} first={k === 0} />
            {sel && !readOnly && sel.hi >= view.first && sel.hi <= view.last && (
              <SelectBar units={units} range={sel} text={selected} cut={cut} edit={edit} onDone={() => setSel(null)} />
            )}
          </div>
        ))}
      </div>
      <SuggestedEdits {...p} />
    </TranscriptFrame>
  );
}
