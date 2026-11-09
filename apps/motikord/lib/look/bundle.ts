// A clip as one file for export and import, carrying the look guides it uses so it looks the same elsewhere.
import { validateClip, validateLookGuide } from '@appskord/motion/recipe';
import type { Clip } from '../types';
import { isRestyled } from '../restyle/restyle';
import type { SavedLook } from './store';

export interface ClipFile {
  app: 'motikord';
  kind: 'clip';
  version: 3;
  clip: Clip;
  lookGuides: SavedLook[];
}

export interface BundleDeps {
  getLook(id: string): Promise<SavedLook | undefined>;
  putLook(look: SavedLook): Promise<void>;
  putClip(clip: Clip): Promise<void>;
}

/** The clip and its saved look guide (a pack's own guide needs no copy). */
export async function exportClip(clip: Clip, deps: Pick<BundleDeps, 'getLook'>): Promise<ClipFile> {
  const id = isRestyled(clip) ? clip.v3.lookGuideId : undefined;
  const look = id ? await deps.getLook(id) : undefined;
  const { thumbnail: _thumbnail, ...rest } = clip;
  return { app: 'motikord', kind: 'clip', version: 3, clip: rest, lookGuides: look ? [look] : [] };
}

/** Reads a clip file; every part is checked before anything is stored. */
export function readClipFile(text: string): ClipFile {
  let file: Partial<ClipFile>;
  try {
    file = JSON.parse(text) as Partial<ClipFile>;
  } catch {
    throw new Error('Motikord: could not read clip file. It is not a Motikord clip.');
  }
  if (file?.app !== 'motikord' || file.kind !== 'clip' || !file.clip || typeof file.clip.id !== 'string')
    throw new Error('Motikord: could not read clip file. It is not a Motikord clip.');
  const looks = Array.isArray(file.lookGuides) ? file.lookGuides : [];
  for (const l of looks) {
    const r = validateLookGuide(l?.guide);
    if (!r.ok) throw new Error(`Motikord: could not read clip file. ${r.errors.join(' ')}`);
  }
  if (isRestyled(file.clip)) {
    const r = validateClip(file.clip.v3);
    if (!r.ok) throw new Error(`Motikord: could not read clip file. ${r.errors.join(' ')}`);
  }
  return { app: 'motikord', kind: 'clip', version: 3, clip: file.clip, lookGuides: looks };
}

/** Stores the clip and the look guides it brought. */
export async function importClip(text: string, deps: Pick<BundleDeps, 'putLook' | 'putClip'>): Promise<Clip> {
  const file = readClipFile(text);
  for (const look of file.lookGuides) await deps.putLook(look);
  await deps.putClip(file.clip);
  return file.clip;
}

export const clipFileText = (file: ClipFile) => JSON.stringify(file);
