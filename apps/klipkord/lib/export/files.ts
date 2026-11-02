// What an export writes beside the video: names, the YouTube chapter list and the caption files.
import { safeName } from '../folder';
import { captionFile, type Caption } from '../project/captions';
import { toOut } from '../project/time';
import type { Cut, Project } from '../project/types';
import type { ContainerId } from './presets';

/** "Invite your team.mp4"; a cut other than the first adds its name: "Invite your team - LinkedIn 30s.mp4". */
export function exportName(project: Project, cut: Cut, ext: string): string {
  const base = safeName(project.name);
  const first = project.cuts[0]?.id === cut.id;
  return `${first ? base : safeName(`${base} - ${cut.name}`)}.${ext}`;
}

export const videoExt = (container: ContainerId): string => container;

/** Swaps the extension: "a.mp4" → "a.srt". */
export const sibling = (name: string, ext: string): string => `${name.replace(/\.[^.]+$/, '')}.${ext}`;

const clock = (ms: number) => {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

/**
 * YouTube's chapter list for the description: one "m:ss Title" line per chapter still in the cut, in output time.
 * YouTube needs the first at 0:00, so the first kept chapter moves there.
 */
export function youtubeChapters(project: Project, cut: Cut): string {
  const kept = project.chapters
    .map((c) => ({ at: toOut(cut, c.at), title: c.title.trim() }))
    .filter((c): c is { at: number; title: string } => c.at !== null && !!c.title)
    .sort((a, b) => a.at - b.at);
  if (!kept.length) return '';
  kept[0]!.at = 0;
  return `${kept.map((c) => `${clock(c.at)} ${c.title}`).join('\n')}\n`;
}

export interface ExtraFile { name: string; data: string; type: string }

/** The captions and chapter files picked under "Also save". Captions use the language shown in the video. */
export function extraFiles(project: Project, cut: Cut, captions: Caption[], videoName: string, o: { captionFiles: boolean; chapters: boolean }): ExtraFile[] {
  const files: ExtraFile[] = [];
  if (o.captionFiles && captions.length) {
    const lang = cut.captions.language;
    const translation = lang ? project.translations[lang] : undefined;
    files.push({ name: sibling(videoName, 'srt'), data: captionFile(cut, captions, 'srt', translation), type: 'application/x-subrip' });
    files.push({ name: sibling(videoName, 'vtt'), data: captionFile(cut, captions, 'vtt', translation), type: 'text/vtt' });
  }
  if (o.chapters) {
    const text = youtubeChapters(project, cut);
    if (text) files.push({ name: sibling(videoName, 'chapters.txt'), data: text, type: 'text/plain' });
  }
  return files;
}
