// Saved look guides ("Your look guides"), in IndexedDB beside the clips. Its own database, so the clip store's
// version and upgrade stay untouched.
import { createDB, type DBSchema } from '@appskord/platform';
import { validateLookGuide } from '@appskord/motion/recipe';
import type { LookGuide } from '@appskord/motion/types';

/** A saved guide, with the pack it came from ("Studio · Smooth") and when it last changed. */
export interface SavedLook {
  guide: LookGuide;
  packId: string;
  updatedAt: number;
}

interface LookDB extends DBSchema {
  lookGuides: { key: string; value: SavedLook; indexes: { updatedAt: number } };
}

export const LOOK_DB_NAME = 'motikord-look';
const lookDB = createDB<LookDB>({
  name: LOOK_DB_NAME,
  version: 1,
  upgrade(db, oldVersion) {
    if (oldVersion < 1) db.createObjectStore('lookGuides', { keyPath: 'guide.id' }).createIndex('updatedAt', 'updatedAt');
  },
});

/** Test helper: close and forget the cached connection. */
export const closeLookDB = lookDB.close;

/** Saves a guide; a guide that fails the recipe check is refused with its errors. */
export async function putLook(look: SavedLook): Promise<void> {
  const checked = validateLookGuide(look.guide);
  if (!checked.ok) throw new Error(`Motikord: could not save look guide. ${checked.errors.join(' ')}`);
  await (await lookDB.get()).put('lookGuides', look);
}
export async function getLook(id: string): Promise<SavedLook | undefined> {
  return (await lookDB.get()).get('lookGuides', id);
}
/** Newest first. */
export async function listLooks(): Promise<SavedLook[]> {
  return (await (await lookDB.get()).getAllFromIndex('lookGuides', 'updatedAt')).reverse();
}
/** Deletes a saved guide; refused while a clip uses it (`inUse` holds the guide ids clips point at). */
export async function deleteLook(id: string, inUse: ReadonlySet<string>): Promise<void> {
  if (inUse.has(id))
    throw new Error(`Motikord: could not delete look guide "${id}". A clip uses it. Restyle that clip with another look, then delete.`);
  await (await lookDB.get()).delete('lookGuides', id);
}
