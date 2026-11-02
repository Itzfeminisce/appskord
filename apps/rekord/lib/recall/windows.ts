import type { Segment } from '../types';

export const WINDOW_MS = 30_000;

export interface TextWindow { atMs: number; endMs: number; text: string }

/** Groups transcript segments into windows of about 30 s; a window closes once it spans WINDOW_MS. */
export function windowsOf(segments: Pick<Segment, 'startMs' | 'endMs' | 'text' | 'interim'>[], size: number = WINDOW_MS): TextWindow[] {
  const out: TextWindow[] = [];
  let cur: TextWindow | undefined;
  for (const s of [...segments].filter((x) => !x.interim && x.text.trim()).sort((a, b) => a.startMs - b.startMs)) {
    if (cur && s.startMs - cur.atMs >= size) {
      out.push(cur);
      cur = undefined;
    }
    if (!cur) cur = { atMs: s.startMs, endMs: s.endMs, text: s.text.trim() };
    else {
      cur.endMs = Math.max(cur.endMs, s.endMs);
      cur.text += ` ${s.text.trim()}`;
    }
  }
  if (cur) out.push(cur);
  return out;
}
