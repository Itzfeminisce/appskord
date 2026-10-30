/** Width in px of `text` drawn at `sizePx`; injected so fitting stays pure and testable. */
export type Measure = (text: string, sizePx: number) => number;

export interface FitInput {
  text: string; width: number; height: number;   // the box in px
  maxSize: number; minSize?: number; lineHeight: number;
  measure: Measure;
}
export interface Fit { sizePx: number; lines: string[]; fits: boolean }

/** Greedy word wrap; a word wider than the box is broken between characters. */
export function wrap(text: string, width: number, sizePx: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, sizePx) <= width) { line = next; continue; }
      if (line) lines.push(line);
      line = '';
      let rest = word;
      while (measure(rest, sizePx) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n), sizePx) > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
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
    if (r.ok) { best = { sizePx: mid, lines: r.lines, fits: true }; lo = mid + 1; } else hi = mid - 1;
  }
  return best ?? { sizePx: min, lines: fitsAt(input, min).lines, fits: false };
}
