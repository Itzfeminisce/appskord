import { toSrt, toVtt, type CaptionFormat, type Cue } from '../captions';
import type { Unit } from '../wordCuts';
import { toOut } from './time';
import type { Cut } from './types';

/** One spoken word of a caption: `index` is its transcript unit (lib/wordCuts), times are rec ms. */
export interface CaptionWord { index: number; text: string; start: number; end: number }
/** One caption on screen: at most two lines, joined by "\n". Rec ms. */
export interface Caption { start: number; end: number; text: string; words: CaptionWord[] }

export const LINE_CHARS = 42;
export const MAX_LINES = 2;
/** A silence this long starts a new caption. */
export const PAUSE_MS = 700;

const SENTENCE_END = /[.?!…]["”’')\]]*$/;

/** Splits each unit into words; a whole line without word timings shares its time out by length. */
function words(units: Unit[], wordFixes: Record<number, string>): CaptionWord[] {
  return units.flatMap((u, index) => {
    const parts = (wordFixes[index] ?? u.text).trim().split(/\s+/).filter(Boolean);
    const chars = parts.reduce((n, p) => n + p.length, 0) || 1;
    let at = u.start;
    return parts.map((text) => {
      const start = at;
      at += ((u.end - u.start) * text.length) / chars;
      return { index, text, start, end: at };
    });
  });
}

/** Wraps words into lines of about LINE_CHARS; a single longer word stays whole. */
export function wrap(texts: string[], max = LINE_CHARS): string[] {
  const lines: string[] = [];
  for (const t of texts) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + t.length <= max) lines[lines.length - 1] = `${last} ${t}`;
    else lines.push(t);
  }
  return lines;
}

/**
 * Caption lines for the whole recording, with word fixes applied. A caption ends at a sentence end,
 * at a pause, or when a third line would start. Indexes stay stable across cuts, so translations line up.
 */
export function captionLines(units: Unit[], wordFixes: Record<number, string> = {}): Caption[] {
  const out: Caption[] = [];
  let open: CaptionWord[] = [];
  const close = () => {
    if (open.length) out.push({ start: open[0]!.start, end: open[open.length - 1]!.end, text: wrap(open.map((w) => w.text)).join('\n'), words: open });
    open = [];
  };
  for (const w of words(units, wordFixes)) {
    const prev = open[open.length - 1];
    if (prev && (w.start - prev.end >= PAUSE_MS || wrap([...open, w].map((x) => x.text)).length > MAX_LINES)) close();
    open.push(w);
    if (SENTENCE_END.test(w.text)) close();
  }
  close();
  return out;
}

/** The caption showing at a recording time, if any. */
export function captionAt(captions: Caption[], rec: number): Caption | undefined {
  return captions.find((c) => rec >= c.start && rec < c.end);
}

/**
 * Captions on one cut's output timeline: cut words drop out, a caption with no word left goes.
 * `translation` (one line per caption, from Project.translations) replaces the text where present.
 */
export function cutCues(cut: Cut, captions: Caption[], translation?: string[]): Cue[] {
  const cues: Cue[] = [];
  captions.forEach((c, i) => {
    const kept = c.words.filter((w) => toOut(cut, (w.start + w.end) / 2) !== null);
    const first = kept[0];
    const last = kept[kept.length - 1];
    if (!first || !last) return;
    const start = toOut(cut, first.start) ?? toOut(cut, (first.start + first.end) / 2)!;
    const end = (toOut(cut, last.end - 1) ?? toOut(cut, (last.start + last.end) / 2)!) + 1;
    const text = translation?.[i]?.trim() || (kept.length === c.words.length ? c.text : wrap(kept.map((w) => w.text)).join('\n'));
    cues.push({ start, end: Math.max(end, start + 1), text });
  });
  return cues.sort((a, b) => a.start - b.start);
}

/** The SRT or VTT file for one cut, in the original language or a translation. */
export function captionFile(cut: Cut, captions: Caption[], format: CaptionFormat, translation?: string[]): string {
  const cues = cutCues(cut, captions, translation);
  return format === 'srt' ? toSrt(cues) : toVtt(cues);
}
