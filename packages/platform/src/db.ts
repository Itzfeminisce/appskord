/** One cached IndexedDB connection per app; each app passes its own name, version and upgrade steps. */
import { openDB, type DBSchema, type IDBPDatabase, type OpenDBCallbacks } from 'idb';

export type { DBSchema, IDBPDatabase };

export interface DBConfig<S extends DBSchema> {
  name: string;
  version: number;
  upgrade: NonNullable<OpenDBCallbacks<S>['upgrade']>;
}

export interface AppDB<S extends DBSchema> {
  /** Opens the database once and reuses the connection. */
  get(): Promise<IDBPDatabase<S>>;
  /** Closes and forgets the cached connection (tests). */
  close(): Promise<void>;
}

export function createDB<S extends DBSchema>(config: DBConfig<S>): AppDB<S> {
  let dbPromise: Promise<IDBPDatabase<S>> | null = null;
  return {
    get() {
      dbPromise ??= openDB<S>(config.name, config.version, { upgrade: config.upgrade });
      return dbPromise;
    },
    async close() {
      if (dbPromise) (await dbPromise).close();
      dbPromise = null;
    },
  };
}

/** A store holding File System Access handles, which survive only in IndexedDB. */
export interface HandleSchema extends DBSchema {
  handles: { key: string; value: FileSystemDirectoryHandle };
}

/** Get, put and clear the chosen folder's handle, kept in the `handles` store under `key`. */
export function folderHandle(getDB: () => Promise<IDBPDatabase<any>>, key = 'folder') {
  const db = async () => (await getDB()) as IDBPDatabase<HandleSchema>;
  return {
    get: async (): Promise<FileSystemDirectoryHandle | undefined> => (await db()).get('handles', key),
    put: async (handle: FileSystemDirectoryHandle): Promise<void> => {
      await (await db()).put('handles', handle, key);
    },
    clear: async (): Promise<void> => {
      await (await db()).delete('handles', key);
    },
  };
}
