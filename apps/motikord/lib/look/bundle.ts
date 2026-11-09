// A clip as one file for export and import, carrying the look guides it uses so it looks the same elsewhere.
import { validateClip, validateLookGuide } from '@appskord/motion/recipe';
import type { Clip } from '../types';
import { isRestyled } from '../restyle/restyle';
import { isPackLookId } from './packs';
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
  hasClip(id: string): Promise<boolean>;
}

/** The clip and its saved look guide (a pack's own guide needs no copy). */
export async function exportClip(clip: Clip, deps: Pick<BundleDeps, 'getLook'>): Promise<ClipFile> {
  const id = isRestyled(clip) ? clip.v3.lookGuideId : undefined;
  const look = id ? await deps.getLook(id) : undefined;
  if (id && !look && !isPackLookId(id))
    throw new Error(
      `Motikord: could not export clip. Its look guide "${id}" is missing. Restyle the clip again with a saved look guide or a pack, then export.`,
    );
  const { thumbnail: _thumbnail, ...rest } = clip;
  return { app: 'motikord', kind: 'clip', version: 3, clip: rest, lookGuides: look ? [look] : [] };
}

/** The largest clip file read; a bigger one is refused before it is parsed. */
export const MAX_CLIP_FILE_BYTES = 25 * 1024 * 1024;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const bad = (key: string, fix: string) => new Error(`Motikord: could not read clip file. ${key}: ${fix}.`);
const notClip = () => new Error('Motikord: could not read clip file. It is not a Motikord clip.');

function checkRecipe(r: unknown, key: string): void {
  if (!isObj(r)) throw bad(key, 'is missing or not a recipe. Export the clip again from Motikord');
  if (!Array.isArray(r.scenes)) throw bad(`${key}.scenes`, 'is not a list. Export the clip again from Motikord');
  if (!isObj(r.assets)) throw bad(`${key}.assets`, 'is not an object. Export the clip again from Motikord');
}

/** Reads a clip file; every part is checked before anything is stored. */
export function readClipFile(text: string): ClipFile {
  if (typeof text !== 'string' || text.length > MAX_CLIP_FILE_BYTES)
    throw bad('file', 'is over 25 MB. Export the clip again without extra media, or pick a smaller file');
  let file: Partial<ClipFile>;
  try {
    file = JSON.parse(text) as Partial<ClipFile>;
  } catch {
    throw notClip();
  }
  if (!isObj(file) || file.app !== 'motikord' || file.kind !== 'clip' || !isObj(file.clip) || typeof file.clip.id !== 'string')
    throw notClip();
  const clip = file.clip as Record<string, unknown>;
  checkRecipe(clip.recipe, 'clip.recipe');
  if (!Array.isArray(clip.history)) throw bad('clip.history', 'is not a list. Export the clip again from Motikord');
  const hasV3 = 'v3' in clip;
  const hasV2 = 'v2Version' in clip;
  if (hasV3 !== hasV2)
    throw bad(hasV3 ? 'clip.v2Version' : 'clip.v3', 'is missing while its pair is present. v3 and v2Version go together; export the clip again from Motikord');
  if (hasV3) {
    checkRecipe(clip.v2Version, 'clip.v2Version');
    const r = validateClip(clip.v3);
    if (!r.ok) throw new Error(`Motikord: could not read clip file. ${r.errors.join(' ')}`);
  }
  const looks = Array.isArray(file.lookGuides) ? file.lookGuides : [];
  looks.forEach((l, i) => {
    const key = `lookGuides[${i}]`;
    if (!isObj(l)) throw bad(key, 'is not a saved look. Remove it or export the clip again');
    const r = validateLookGuide(l.guide);
    if (!r.ok) throw new Error(`Motikord: could not read clip file. ${r.errors.join(' ')}`);
    if (typeof l.updatedAt !== 'number' || !Number.isFinite(l.updatedAt))
      throw bad(`${key}.updatedAt`, 'is not a number. Set it to the time the look last changed');
    if (typeof l.packId !== 'string' || !l.packId) throw bad(`${key}.packId`, 'is missing. Set it to the pack the look came from');
  });
  return { app: 'motikord', kind: 'clip', version: 3, clip: file.clip as Clip, lookGuides: looks as SavedLook[] };
}

/** Stores the clip and the look guides it brought. A clip whose id is already in the library comes in under a new id. */
export async function importClip(text: string, deps: Pick<BundleDeps, 'putLook' | 'putClip' | 'hasClip'>): Promise<Clip> {
  const file = readClipFile(text);
  let clip = file.clip;
  if (await deps.hasClip(clip.id)) {
    const id = crypto.randomUUID();
    clip = { ...clip, id, recipe: { ...clip.recipe, id } };
    if (isRestyled(clip) && clip.v3.restyledFrom === file.clip.id)
      clip = { ...clip, v3: { ...clip.v3, restyledFrom: id } } as Clip;
  }
  for (const look of file.lookGuides) await deps.putLook(look);
  await deps.putClip(clip);
  return clip;
}

export const clipFileText = (file: ClipFile) => JSON.stringify(file);
