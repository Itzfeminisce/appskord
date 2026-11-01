/* Each app's upgrade steps exactly as on origin/main before M5 (git show origin/main:apps/<app>/lib/db.ts). */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const REKORD = {
  name: 'rekord',
  version: 2,
  upgrade(db: any, oldVersion: number) {
    if (oldVersion < 1) {
      db.createObjectStore('meetings', { keyPath: 'id' });
      db.createObjectStore('segments', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      db.createObjectStore('notes', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      db.createObjectStore('markers', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
      chunks.createIndex('meetingId', 'meetingId');
      chunks.createIndex('status', 'status');
    }
    if (oldVersion < 2) {
      db.createObjectStore('asks', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      db.createObjectStore('recordings', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      db.createObjectStore('recordingMeta', { keyPath: 'meetingId' });
    }
  },
};

export function withV2Fields(r: any): any {
  if (r.transcriptModel) return r;
  const transcriptModel = r.status === 'ready' && !r.transcriptPending ? 'full' : 'live';
  return { ...r, transcriptModel };
}

export const KLIPKORD = {
  name: 'klipkord',
  version: 3,
  async upgrade(db: any, oldVersion: number, _newVersion: number | null, tx: any) {
    if (oldVersion < 1) {
      db.createObjectStore('recordings', { keyPath: 'id' }).createIndex('status', 'status');
      db.createObjectStore('handles');
    }
    if (oldVersion >= 1 && oldVersion < 2) {
      for (let cursor = await tx.objectStore('recordings').openCursor(); cursor; cursor = await cursor.continue()) {
        await cursor.update(withV2Fields(cursor.value));
      }
    }
    if (oldVersion < 3) db.createObjectStore('searchIndex', { keyPath: 'id' });
  },
};

export const MOTIKORD = {
  name: 'motikord',
  version: 1,
  upgrade(db: any, oldVersion: number) {
    if (oldVersion < 1) {
      db.createObjectStore('clips', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      db.createObjectStore('brandKit');
      db.createObjectStore('exportJobs', { keyPath: 'id' }).createIndex('status', 'status');
      db.createObjectStore('handles');
    }
  },
};
