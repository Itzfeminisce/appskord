import { TYPING_DEPTH } from '@/lib/project/autoZoom';
import { newCut } from '@/lib/project/cuts';
import { currentCut, group } from '@/lib/project/history';
import { addChapter, addLayer, deleteWords, fixWord, LABELS, moveRange, quote, removeRec, setSpeed, split } from '@/lib/project/ops';
import { cutLength, spans, toOut } from '@/lib/project/time';
import type { Cut, Project, Zoom } from '@/lib/project/types';
import type { Chapter } from '@/lib/types';
import type { Unit } from '@/lib/wordCuts';

/** Depth of a zoom made from the transcript; T10's ZoomEdit changes it afterwards. */
export const DEFAULT_ZOOM_DEPTH = TYPING_DEPTH;
/** A silence this long between sentences shows as "3.2 s pause". */
export const PAUSE_ROW_MS = 2000;
/** Speeds offered by the selection bar: the Speed popover's (TimelineClip). */
export const SPEEDS = [0.5, 1, 1.5, 2, 4];

export const textOf = (u: Unit, i: number, fixes: Record<number, string>) => fixes[i] ?? u.text;
export const isUnitKept = (cut: Cut, u: Unit) => toOut(cut, (u.start + u.end) / 2) !== null;

/** Output time of a recording moment; a cut moment reads as where the video carries on after it. */
export function outAt(cut: Cut, rec: number): number {
  const o = toOut(cut, rec);
  if (o !== null) return o;
  let best = Infinity;
  for (const s of spans(cut)) if (!s.clip.gap && s.clip.in >= rec && s.start < best) best = s.start;
  return best === Infinity ? cutLength(cut) : best;
}

export interface LineView {
  line: number; first: number; last: number; start: number; end: number;
  chapters: { title: string; index: number }[];
  /** The silence before this line, when it is long enough to show. */
  pause?: { start: number; end: number };
}

/** Transcript lines with their chapter headings and the long pauses between them. */
export function lineViews(units: Unit[], chapters: Chapter[]): LineView[] {
  const lines: LineView[] = [];
  units.forEach((u, i) => {
    const prev = lines[lines.length - 1];
    if (prev && prev.line === u.line) { prev.last = i; prev.end = u.end; } else lines.push({ line: u.line, first: i, last: i, start: u.start, end: u.end, chapters: [] });
  });
  const order = chapters.map((c, index) => ({ ...c, index })).sort((a, b) => a.at - b.at);
  for (const c of order) {
    const target = lines.find((l) => l.end > c.at) ?? lines[lines.length - 1];
    target?.chapters.push({ title: c.title, index: c.index });
  }
  for (let k = 1; k < lines.length; k++) {
    const a = lines[k - 1]!;
    const b = lines[k]!;
    if (b.start - a.end >= PAUSE_ROW_MS) b.pause = { start: a.end, end: b.start };
  }
  return lines;
}

export interface Range { lo: number; hi: number }

export const indexes = ({ lo, hi }: Range): number[] => Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
export const rangeText = (units: Unit[], r: Range, fixes: Record<number, string>) => indexes(r).map((i) => textOf(units[i]!, i, fixes)).join(' ');

/** The output span the selection plays: from its first kept word to the end of its last. */
export function outSpan(cut: Cut, units: Unit[], r: Range): { from: number; to: number } {
  const keptOnes = indexes(r).filter((i) => isUnitKept(cut, units[i]!));
  if (!keptOnes.length) {
    const at = outAt(cut, units[r.lo]!.start);
    return { from: at, to: at };
  }
  const first = units[keptOnes[0]!]!;
  const last = units[keptOnes[keptOnes.length - 1]!]!;
  const from = outAt(cut, first.start);
  const to = (toOut(cut, last.end - 1) ?? outAt(cut, last.end)) + 1;
  return { from, to: Math.max(from, to) };
}

// ---- The selection bar: each action is one op from lib/project ----

export const deleteRange = (p: Project, units: Unit[], r: Range) => deleteWords(p, { units, chosen: new Set(indexes(r)) });

/** Speed: the selection becomes its own clips at that speed, as one step. */
export function speedRange(p: Project, units: Unit[], r: Range, rate: number): Project {
  const { from, to } = outSpan(currentCut(p), units, r);
  if (to - from < 1) return p;
  return group(p, LABELS.setSpeed(rate), (q) => {
    const parted = split(split(q, { at: from }), { at: to });
    const ids = spans(currentCut(parted)).filter((s) => !s.clip.gap && s.start >= from - 0.5 && s.end <= to + 0.5).map((s) => s.clip.id);
    return setSpeed(parted, { ids, speed: rate });
  });
}

/** One zoom per range with the default depth; it follows the cursor when there is an events track. */
export function zoomRanges(p: Project, units: Unit[], ranges: Range[]): Project {
  const items: Omit<Zoom, 'id'>[] = ranges.map((r) => ({
    at: units[r.lo]!.start, end: units[r.hi]!.end, depth: DEFAULT_ZOOM_DEPTH,
    focus: p.events ? 'cursor' : { x: 0.5, y: 0.5 }, feel: 'smooth', auto: false,
  }));
  return addLayer(p, { kind: 'zooms', items });
}

/** A chapter starting at the selection, named after its first words. */
export function chapterAt(p: Project, units: Unit[], r: Range): Project {
  const title = rangeText(units, r, p.wordFixes).split(/\s+/).slice(0, 3).join(' ').replace(/[.,!?…:;]+$/, '');
  return addChapter(p, { chapter: { at: units[r.lo]!.start, title } });
}

/** "Make a cut from this": a new cut that plays only the selection. */
export function cutFromRange(p: Project, units: Unit[], r: Range): Project {
  const name = rangeText(units, r, p.wordFixes).split(/\s+/).slice(0, 3).join(' ').replace(/[.,!?…:;]+$/, '');
  const start = units[r.lo]!.start;
  const end = units[r.hi]!.end;
  const made = newCut(p, { name });
  const mine = currentCut(p);
  const total = Math.max(...mine.clips.map((c) => c.out), end);
  const clips = removeRec(removeRec(mine.clips, end, total), 0, start);
  if (!clips.some((c) => !c.gap)) return p;
  // The new cut's first state is the selection, so its Undo never grows it back to full length.
  const id = made.current;
  return { ...made, cuts: made.cuts.map((c) => (c.id === id ? { ...c, clips } : c)) };
}

/** Drag the selection before word `target`. */
export function moveBefore(p: Project, units: Unit[], r: Range, target: number, lines: LineView[]): Project {
  if (target >= r.lo && target <= r.hi + 1) return p;
  const cut = currentCut(p);
  const { from, to } = outSpan(cut, units, r);
  const at = target >= units.length ? cutLength(cut) : outAt(cut, units[target]!.start);
  const heading = lines.find((l) => l.first === target)?.chapters[0]?.title;
  const words = target < units.length ? rangeText(units, { lo: target, hi: Math.min(units.length - 1, target + 3) }, p.wordFixes) : '';
  const before = heading ?? quote(words);
  return moveRange(p, { from, to, at, label: LABELS.moveRange(rangeText(units, r, p.wordFixes), before) });
}

// ---- Find and replace ----

/** A match over units `lo`..`hi`; `a` and `b` are its character offsets inside the first and last unit's text. */
export interface Match extends Range { a: number; b: number }

/** Every case-insensitive match of `query` among the words the cut still plays. */
export function findMatches(units: Unit[], fixes: Record<number, string>, cut: Cut, query: string): Match[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: number[] = [];
  let full = '';
  units.forEach((u, i) => {
    if (i > 0) full += ' ';
    starts.push(full.length);
    full += textOf(u, i, fixes).toLowerCase();
  });
  const unitAt = (pos: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= pos) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const out: Match[] = [];
  for (let at = full.indexOf(q); at >= 0; at = full.indexOf(q, at + q.length)) {
    const lo = unitAt(at);
    const hi = unitAt(at + q.length - 1);
    const m = { lo, hi, a: at - starts[lo]!, b: at + q.length - starts[hi]! };
    if (indexes(m).every((i) => isUnitKept(cut, units[i]!))) out.push(m);
  }
  return out;
}

/** Only a match inside one word can be fixed: a word fix never empties a word. */
export const replaceable = (m: Match) => m.lo === m.hi;

/** Replace this one match through `fixWord`. */
export function replaceOne(p: Project, units: Unit[], m: Match, fresh: string): Project {
  if (!replaceable(m) || !fresh.trim()) return p;
  const text = textOf(units[m.lo]!, m.lo, p.wordFixes);
  return fixWord(p, { index: m.lo, text: `${text.slice(0, m.a)}${fresh}${text.slice(m.b)}` });
}

/** "Replace all": every one-word match, as one step. */
export function replaceAll(p: Project, units: Unit[], matches: Match[], query: string, fresh: string): Project {
  const fixable = matches.filter(replaceable);
  if (!fixable.length || !fresh.trim()) return p;
  // Later matches first, so the offsets of earlier ones in the same word stay right.
  const ordered = [...fixable].sort((x, y) => y.lo - x.lo || y.a - x.a);
  return group(p, LABELS.replaceAll(query.trim(), fresh.trim()), (q) => ordered.reduce((acc, m) => replaceOne(acc, units, m, fresh), q));
}

export const cutMatches = (p: Project, units: Unit[], matches: Match[]) => deleteWords(p, { units, chosen: new Set(matches.flatMap(indexes)) });
