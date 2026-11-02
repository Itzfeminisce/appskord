import { spans } from '@/lib/project/time';
import type { Cut, Project } from '@/lib/project/types';
import { clock } from '../format';
import { outAtOrAfter } from './geometry';

/** YouTube needs the first chapter at 0:00 and each at least 10 s long. */
export const YOUTUBE_MIN_MS = 10_000;

/** A chapter placed on this cut's timeline; `index` is its place in Project.chapters. */
export interface CutChapter { index: number; at: number; title: string }

/** Chapters follow the cut: each sits where its moment plays, or where the next kept part starts when it was cut. */
export function chaptersInCut(project: Project, cut: Cut): CutChapter[] {
  const all = spans(cut);
  const seen = new Set<number>();
  const out: CutChapter[] = [];
  project.chapters.forEach((c, index) => {
    const at = outAtOrAfter(all, c.at);
    if (at === null) return;
    const key = Math.round(at);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ index, at, title: c.title });
  });
  return out.sort((a, b) => a.at - b.at);
}

/** The chapters YouTube accepts: the first moved to 0:00, then only those at least 10 s after the last kept one and 10 s before the end. */
export function youtubeChapters(list: readonly CutChapter[], length: number): CutChapter[] {
  const out: CutChapter[] = [];
  for (const c of list) {
    if (!c.title.trim()) continue;
    if (out.length === 0) { out.push({ ...c, at: 0 }); continue; }
    if (c.at - out[out.length - 1]!.at < YOUTUBE_MIN_MS || length - c.at < YOUTUBE_MIN_MS) continue;
    out.push(c);
  }
  return out;
}

/** "0:00 Intro" lines for the video description. */
export const youtubeText = (list: readonly CutChapter[]): string => list.map((c) => `${clock(c.at)} ${c.title.trim()}`).join('\n');
