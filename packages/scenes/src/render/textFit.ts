import type { Aspect, TextLayer } from '../types';

/** A text layer's size on one shape: its size times that shape's scale. */
export const sizeOn = (l: Pick<TextLayer, 'sizePx' | 'scaleAt'>, a: Aspect): number => l.sizePx * (l.scaleAt?.[a] ?? 1);

/** Width in px of `text` drawn at `sizePx`; injected so fitting stays pure and testable. */
export type Measure = (text: string, sizePx: number) => number;

export interface FitInput {
  text: string;
  width: number;
  height: number; // the box in px
  maxSize: number;
  minSize?: number;
  lineHeight: number;
  measure: Measure;
}
export interface Fit {
  sizePx: number;
  lines: string[];
  fits: boolean;
}

/** Greedy word wrap. A word is never split: one wider than the box keeps a line of its own, so the fit fails and the checker reports it. */
export function wrap(text: string, width: number, sizePx: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || measure(next, sizePx) <= width) {
        line = next;
        continue;
      }
      lines.push(line);
      line = word;
    }
    lines.push(line);
  }
  return lines;
}

// Faces wider than the default rough glyph width: advances in hundredths of an em, from the shipped font file; other characters take `rest`.
const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ,.'!?-&%$";
const ADVANCES: Record<string, { em: number[]; rest: number }> = {
  'Archivo Black': {
    em: [
      67, 67, 67, 67, 67, 39, 67, 67, 33, 33, 67, 33, 100, 67, 67, 67, 67, 44, 61, 44, 67, 61, 94, 67, 61, 56, 78, 78,
      78, 78, 72, 67, 83, 83, 39, 67, 83, 67, 94, 83, 83, 72, 83, 78, 72, 72, 83, 78, 100, 78, 78, 72, 67, 67, 67, 67,
      67, 67, 67, 67, 67, 67, 33, 33, 33, 28, 33, 61, 33, 89, 100, 67,
    ],
    rest: 78,
  },
};

/** The rough glyph-width measure for a face and its tracking (em), so a long word in a wide face is not under-measured; 0.56 em a character otherwise. */
export function estimateFor(font?: string, letterSpacing = 0): Measure {
  const a = ADVANCES[font ?? ''];
  if (!a) return (text, sizePx) => text.length * sizePx * 0.56;
  return (text, sizePx) => {
    let em = 0;
    for (const c of text) {
      const i = CHARS.indexOf(c);
      em += (i < 0 ? a.rest : a.em[i]!) / 100 + letterSpacing;
    }
    return em * sizePx;
  };
}

function fitsAt(input: FitInput, size: number): { ok: boolean; lines: string[] } {
  const lines = wrap(input.text, input.width, size, input.measure);
  const tall = lines.length * size * input.lineHeight <= input.height + 0.5;
  const wide = lines.every((l) => input.measure(l, size) <= input.width + 0.5);
  return { ok: tall && wide, lines };
}

/** The largest whole px size up to maxSize at which the wrapped text fits the box. */
export function fitText(input: FitInput): Fit {
  const max = Math.max(1, Math.floor(input.maxSize));
  const min = Math.max(1, Math.min(max, Math.floor(input.minSize ?? 8)));
  const top = fitsAt(input, max);
  if (top.ok) return { sizePx: max, lines: top.lines, fits: true };
  let lo = min;
  let hi = max - 1;
  let best: Fit | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = fitsAt(input, mid);
    if (r.ok) {
      best = { sizePx: mid, lines: r.lines, fits: true };
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best ?? { sizePx: min, lines: fitsAt(input, min).lines, fits: false };
}
