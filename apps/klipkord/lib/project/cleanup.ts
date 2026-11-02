import { findFillers } from '../fillers';
import { PAD_MS } from '../silence';
import type { Segment } from '../types';
import { units as unitsOf, type Unit } from '../wordCuts';
import { currentCut, group } from './history';
import { editCut, LABELS, removeRec, setSpeed } from './ops';
import { isKept } from './time';
import type { Cut, Project } from './types';

export type FindKind = 'filler' | 'pause' | 'retake';
export type PauseAction = 'cut' | 'speed';

/** One thing Clean up can take out. Times are rec ms; `units` are the transcript units it covers. */
export interface Find { id: string; kind: FindKind; start: number; end: number; text: string; units: number[]; saves: number }

export interface CleanupSettings { fillers: boolean; pauses: boolean; retakes: boolean; minPause: 1 | 2 | 3; pauseAction: PauseAction }
export const DEFAULT_CLEANUP: CleanupSettings = { fillers: true, pauses: true, retakes: true, minPause: 2, pauseAction: 'cut' };

/** "Speed up" plays a pause at this rate instead of cutting it. */
export const PAUSE_SPEED = 4;
/** A retake must repeat at least this many words. */
export const RETAKE_MIN_WORDS = 3;
/** A sentence of at least this many words may differ from its retake by one word; shorter ones must match exactly. */
export const RETAKE_LOOSE_WORDS = 6;

type Fixes = Record<number, string>;

/** The fillers Clean up and the quick wins name, in the order they are listed. */
export const FILLER_ORDER = ['um', 'uh', 'er', 'so', 'like', 'you know'];

const token = (text: string) => text.toLowerCase().replace(/[^a-z0-9']/g, '');
const SPOKEN_FILLERS = new Set(['um', 'uh', 'er']);
const kept = (cut: Cut, u: Unit) => isKept(cut, (u.start + u.end) / 2);
const opensPhrase = (all: Unit[], i: number) => i === 0 || all[i - 1]!.line !== all[i]!.line || /[.!?…,]$/.test(all[i - 1]!.text.trim());

/** Units whose middle lies in start..end. */
function unitsIn(all: Unit[], start: number, end: number): number[] {
  const out: number[] = [];
  all.forEach((u, i) => { const mid = (u.start + u.end) / 2; if (mid >= start && mid <= end) out.push(i); });
  return out;
}

/** v2's fillers, plus "so" when it opens a phrase. Only words the cut still plays. */
export function fillerFinds(segments: Segment[], cut: Cut, all: Unit[] = unitsOf(segments), fixes: Fixes = {}): Find[] {
  const hits = findFillers(segments).map((h) => ({ ...h }));
  all.forEach((u, i) => { if (token(u.text) === 'so' && opensPhrase(all, i)) hits.push({ start: u.start, end: u.end, text: 'so' }); });
  return hits
    .map((h) => ({ h, units: unitsIn(all, h.start, h.end) }))
    .filter(({ units }) => units.length > 0 && units.every((i) => kept(cut, all[i]!) && fixes[i] === undefined))
    .sort((a, b) => a.h.start - b.h.start)
    .map(({ h, units }) => ({
      id: `filler-${h.start}`, kind: 'filler' as const, start: h.start, end: h.end, units, saves: h.end - h.start,
      text: units.map((i) => fixes[i] ?? all[i]!.text).join(' '),
    }));
}

/** Silences between spoken words of at least `minPauseMs`, less PAD_MS of breath on each side. */
export function pauseFinds(all: Unit[], cut: Cut, minPauseMs: number, action: PauseAction = 'cut'): Find[] {
  const out: Find[] = [];
  const spoken = all.filter((u) => kept(cut, u));
  for (let i = 1; i < spoken.length; i++) {
    const a = spoken[i - 1]!;
    const b = spoken[i]!;
    const gap = b.start - a.end;
    const start = a.end + PAD_MS;
    const end = b.start - PAD_MS;
    if (gap < minPauseMs || end <= start || !isKept(cut, (start + end) / 2)) continue;
    const length = end - start;
    out.push({ id: `pause-${start}`, kind: 'pause', start, end, units: [], text: `${(gap / 1000).toFixed(1)} s`, saves: action === 'cut' ? length : length * (1 - 1 / PAUSE_SPEED) });
  }
  return out;
}

interface Line { first: number; last: number; start: number; end: number; tokens: string[] }

function linesOf(all: Unit[], cut: Cut, fixes: Fixes): Line[] {
  const lines: Line[] = [];
  all.forEach((u, i) => {
    if (!kept(cut, u)) return;
    const prev = lines[lines.length - 1];
    const words = (fixes[i] ?? u.text).split(/\s+/).map(token).filter((t) => t && !SPOKEN_FILLERS.has(t));
    if (prev && all[prev.last]!.line === u.line) {
      prev.last = i;
      prev.end = u.end;
      prev.tokens.push(...words);
    } else lines.push({ first: i, last: i, start: u.start, end: u.end, tokens: words });
  });
  return lines;
}

/** Edit distance between two word lists, capped just above `max`. */
function distance(a: string[], b: string[], max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

/** `b` repeats `a` from its first word: nearly all of it, or all of a sentence that was cut off. */
function repeats(a: Line, b: Line, cutOff: boolean): boolean {
  const n = a.tokens.length;
  if (n < RETAKE_MIN_WORDS) return false;
  if (cutOff && b.tokens.length >= n && a.tokens.every((t, k) => t === b.tokens[k])) return true;
  const slack = n >= RETAKE_LOOSE_WORDS ? 1 : 0;
  for (let m = n - slack; m <= n + slack; m++) if (m <= b.tokens.length && distance(a.tokens, b.tokens.slice(0, m), slack) <= slack) return true;
  return false;
}

/** A sentence said again straight after: the earlier one goes, up to where the last try starts. */
export function retakeFinds(all: Unit[], cut: Cut, fixes: Fixes = {}): Find[] {
  const lines = linesOf(all, cut, fixes);
  const out: Find[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1]!;
    const b = lines[i]!;
    const cutOff = !/[.!?…]["')\]]*$/.test(all[a.last]!.text.trim());
    if (!repeats(a, b, cutOff)) continue;
    const units = Array.from({ length: a.last - a.first + 1 }, (_, k) => a.first + k);
    out.push({
      id: `retake-${a.start}`, kind: 'retake', start: a.start, end: b.start, units, saves: b.start - a.start,
      text: units.map((k) => fixes[k] ?? all[k]!.text).join(' '),
    });
  }
  return out;
}

export interface Finds { fillers: Find[]; pauses: Find[]; retakes: Find[] }

/** Everything Clean up finds in the current cut, by kind, whatever is switched on. */
export function findAll(segments: Segment[], cut: Cut, settings: CleanupSettings, fixes: Fixes = {}): Finds {
  const all = unitsOf(segments);
  return {
    fillers: fillerFinds(segments, cut, all, fixes),
    pauses: pauseFinds(all, cut, settings.minPause * 1000, settings.pauseAction),
    retakes: retakeFinds(all, cut, fixes),
  };
}

/** The finds of the switched-on kinds, in time order. */
export function listed(finds: Finds, settings: CleanupSettings): Find[] {
  return [...(settings.fillers ? finds.fillers : []), ...(settings.pauses ? finds.pauses : []), ...(settings.retakes ? finds.retakes : [])]
    .sort((a, b) => a.start - b.start);
}

/** Time the finds save; a filler or pause inside a retake is counted once, with the retake. */
export function timeSaved(finds: Find[]): number {
  const retakes = finds.filter((f) => f.kind === 'retake');
  return finds.reduce((n, f) => n + (f.kind !== 'retake' && retakes.some((r) => f.start >= r.start && f.end <= r.end) ? 0 : f.saves), 0);
}

/** Cuts the finds (pauses cut or sped up) without a history step of its own: callers group it. */
export function cleanEdit(project: Project, finds: Find[], pauseAction: PauseAction): Project {
  const speedUp = pauseAction === 'speed' ? finds.filter((f) => f.kind === 'pause') : [];
  const cuts = finds.filter((f) => !speedUp.includes(f));
  // One op for every cut, not one per find.
  const clips = cuts.reduce((list, f) => removeRec(list, f.start, f.end), currentCut(project).clips);
  let p = clips.some((c) => !c.gap) ? editCut(project, LABELS.cutRange, (c) => ({ ...c, clips })) : project;
  if (speedUp.length) {
    const silences = speedUp.map((f) => ({ start: f.start, end: f.end }));
    // Clips already at another speed keep it; only plain ones get their pauses sped up.
    const ids = currentCut(p).clips.filter((c) => !c.gap && c.speed === 1 && silences.some((s) => s.start < c.out && s.end > c.in)).map((c) => c.id);
    if (ids.length) p = setSpeed(p, { ids, speed: PAUSE_SPEED, silences });
  }
  return p;
}

/** "Cut N": every chosen find as one Undo step. */
export function applyCleanup(project: Project, finds: Find[], pauseAction: PauseAction, label = LABELS.cleanUp(finds.length)): Project {
  if (finds.length === 0) return project;
  return group(project, label, (p) => cleanEdit(p, finds, pauseAction));
}
