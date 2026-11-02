import type { Quote } from './types';

export interface QuoteSegment { startMs: number; endMs: number; text: string }

export function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

// Small ASR slips: one wrong letter in words of 4+, two in words of 8+.
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  if (len < 4) return false;
  return editDistance(a, b) <= (len >= 8 ? 2 : 1);
}

function commonInOrder(quote: string[], heard: string[]): number {
  let prev = new Array<number>(heard.length + 1).fill(0);
  for (let i = 1; i <= quote.length; i++) {
    const cur = [0];
    for (let j = 1; j <= heard.length; j++) {
      cur[j] = sameWord(quote[i - 1]!, heard[j - 1]!) ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    prev = cur;
  }
  return prev[heard.length]!;
}

/** True when the quote was said within `windowMs` of its time: case, punctuation and small ASR slips are forgiven. */
export function quoteFound(quote: Pick<Quote, 'text' | 'atMs'>, segments: QuoteSegment[], windowMs = 90_000): boolean {
  const words = normalise(quote.text);
  if (words.length === 0) return false;
  const heard = segments
    .filter((s) => s.endMs >= quote.atMs - windowMs && s.startMs <= quote.atMs + windowMs)
    .sort((a, b) => a.startMs - b.startMs)
    .flatMap((s) => normalise(s.text));
  // Short quotes must match every word; longer ones may lose one word in five.
  const need = words.length < 4 ? words.length : Math.ceil(words.length * 0.8);
  const span = words.length + Math.max(2, Math.ceil(words.length * 0.25));
  const firstWords = words.slice(0, words.length - need + 1);
  for (let start = 0; start + need <= heard.length; start++) {
    if (!firstWords.some((w) => sameWord(w, heard[start]!))) continue;
    if (commonInOrder(words, heard.slice(start, start + span)) >= need) return true;
  }
  return false;
}
