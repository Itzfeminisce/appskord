import type { Aspect, FileKind } from './types';

export const CREDITS_FILE = 'credits.txt';
export const EXT: Record<FileKind, string> = { mp4: 'mp4', webm: 'webm', gif: 'gif', 'webm-alpha': 'webm' };
export const KIND_LABEL: Record<FileKind, string> = { mp4: 'MP4', webm: 'WebM', gif: 'GIF', 'webm-alpha': 'See-through WebM' };

/** "Sourdough promo" → "sourdough-promo": lower case, ASCII letters and digits, safe on every system. */
export function slug(name: string): string {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s || 'motikord-clip';
}

/** sourdough-promo-9x16.mp4; see-through files say so, so they never clash with the plain WebM. */
export function videoFileName(name: string, aspect: Aspect, kind: FileKind): string {
  const size = aspect.replace(':', 'x');
  return `${slug(name)}-${size}${kind === 'webm-alpha' ? '-see-through' : ''}.${EXT[kind]}`;
}

/** The "You'll get" list: one file per size and kind, in render order, then credits.txt. */
export function youllGet(name: string, aspects: Aspect[], kinds: FileKind[], credits: boolean): string[] {
  const files: string[] = [];
  for (const kind of kinds) for (const aspect of aspects) files.push(videoFileName(name, aspect, kind));
  if (credits) files.push(CREDITS_FILE);
  return files;
}
