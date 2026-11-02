/** Rekord folder writer: the chosen directory handle lives in its own small DB, since only IndexedDB can hold it. */
import { createDB, folderHandle, type DBSchema } from '@appskord/platform';
import { listMarkers, listMeetings, listNotes, listSegments } from '../db';
import { itemsForMeeting, listItems, listPeople } from '../memory/store';
import { getSettings, updateSettings } from '../settings';
import { folderFiles, type FolderFile, type MeetingParts } from './markdown';

export * from './markdown';

// `since`: when the folder was chosen; `written`: meetings already in it, so the rest count as past meetings.
interface FolderMeta { name: string; since: number; lastWrittenAt?: number; queue: string[]; written: string[] }
interface FolderDB extends DBSchema {
  handles: { key: string; value: FileSystemDirectoryHandle };
  meta: { key: string; value: FolderMeta };
}

type Permission = 'granted' | 'denied' | 'prompt';
type Writable = { write(data: string): Promise<void>; close(): Promise<void> };
type FileHandle = { createWritable(): Promise<Writable> };
/** The File System Access parts Rekord uses, beyond what TypeScript's DOM types declare. */
export interface DirHandle {
  name: string;
  queryPermission?(o: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<Permission>;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle>;
}

let dbName = 'rekord-folder';
let folderDB = makeDB();
function makeDB() {
  return createDB<FolderDB>({
    name: dbName,
    version: 1,
    upgrade(db) {
      db.createObjectStore('handles');
      db.createObjectStore('meta');
    },
  });
}
/** Dev frames and tests point the writer at a scratch DB, so a real folder is never touched. */
export async function useFolderDB(name: string): Promise<void> {
  await folderDB.close();
  dbName = name;
  folderDB = makeDB();
}

const handles = () => folderHandle(folderDB.get);
const META = 'folder';
const readMeta = async () => (await folderDB.get()).get('meta', META);
const writeMeta = async (m: FolderMeta) => { await (await folderDB.get()).put('meta', m, META); };

export type FolderStatus =
  | { state: 'off' }
  | { state: 'on' | 'needsPermission'; name: string; lastWrittenAt?: number; queued: number; past: number };

export async function folderStatus(): Promise<FolderStatus> {
  const [handle, meta] = await Promise.all([handles().get(), readMeta()]);
  if (!handle || !meta) return { state: 'off' };
  const permission = await (handle as unknown as DirHandle).queryPermission?.({ mode: 'readwrite' }).catch(() => 'prompt' as const);
  const state = permission === 'granted' ? 'on' : 'needsPermission';
  const written = new Set(meta.written);
  const past = (await listMeetings()).filter((m) => !written.has(m.id)).length;
  return { state, name: meta.name, lastWrittenAt: meta.lastWrittenAt, queued: meta.queue.length, past };
}

/** Opens the folder picker (needs the user's click) and keeps the handle; past meetings wait for "Write all". */
export async function chooseFolder(): Promise<boolean> {
  const picker = (globalThis as unknown as { showDirectoryPicker?: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
  if (!picker) return false;
  let handle: DirHandle;
  try {
    handle = await picker({ id: 'rekord-folder', mode: 'readwrite' });
  } catch {
    return false; // the user closed the picker
  }
  await handles().put(handle as unknown as FileSystemDirectoryHandle);
  await writeMeta({ name: handle.name, since: Date.now(), queue: [], written: [] });
  await setFolderSetting(true);
  await write(false);
  return true;
}

/** "Allow" after a Chrome restart: asks again (needs the user's click), then writes what queued. */
export async function allowFolder(): Promise<boolean> {
  const handle = (await handles().get()) as unknown as DirHandle | undefined;
  if (!handle?.requestPermission) return false;
  const granted = (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  if (granted) await flushFolder();
  return granted;
}

export async function stopFolder(): Promise<void> {
  await handles().clear();
  await (await folderDB.get()).delete('meta', META);
  await setFolderSetting(false);
}

async function setFolderSetting(folder: boolean) {
  const { memory } = await getSettings();
  await updateSettings({ memory: { ...memory, folder } });
}

/** Marks meetings to (re)write; they are written on the next flush while the panel is open. */
export async function queueMeetings(ids: string[]): Promise<void> {
  const meta = await readMeta();
  if (!meta) return;
  await writeMeta({ ...meta, queue: [...new Set([...meta.queue, ...ids])] });
}

export async function writeFiles(dir: DirHandle, files: FolderFile[]): Promise<void> {
  for (const file of files) {
    const parts = file.path.split('/');
    const name = parts.pop()!;
    let at = dir;
    for (const part of parts) at = await at.getDirectoryHandle(part, { create: true });
    const writable = await (await at.getFileHandle(name, { create: true })).createWritable();
    await writable.write(file.text);
    await writable.close();
  }
}

async function partsFor(ids: string[]): Promise<MeetingParts[]> {
  const meetings = (await listMeetings()).filter((m) => ids.includes(m.id));
  return Promise.all(meetings.map(async (meeting) => {
    const [segments, notes, markers, items] = await Promise.all([
      listSegments(meeting.id), listNotes(meeting.id), listMarkers(meeting.id), itemsForMeeting(meeting.id),
    ]);
    return { meeting, segments, notes, markers, items };
  }));
}

/** Writes the queued meetings, every meeting new since the last write, and the people and list files. */
async function write(all: boolean, now = Date.now()): Promise<boolean> {
  const [handle, meta] = await Promise.all([handles().get(), readMeta()]);
  if (!handle || !meta) return false;
  const dir = handle as unknown as DirHandle;
  if ((await dir.queryPermission?.({ mode: 'readwrite' })) !== 'granted') return false;
  const [meetings, people, items] = await Promise.all([listMeetings(), listPeople(), listItems()]);
  const since = meta.lastWrittenAt ?? meta.since;
  const changed = new Set(items.filter((i) => i.updatedAt > since).map((i) => i.meetingId));
  const ids = all ? meetings.map((m) => m.id)
    : meetings.filter((m) => meta.queue.includes(m.id) || changed.has(m.id) || m.startedAt > since || (m.endedAt ?? 0) > since).map((m) => m.id);
  await writeFiles(dir, folderFiles(await partsFor(ids), { meetings, people, items }));
  await writeMeta({ ...meta, lastWrittenAt: now, queue: [], written: [...new Set([...meta.written, ...ids])] });
  return true;
}

/** "Write all 24 past meetings". */
export const writeAll = () => write(true);

/** Runs when the side panel opens; does nothing while the folder is off or waiting for "Allow". */
export async function flushFolder(): Promise<boolean> {
  try {
    return await write(false);
  } catch (error) {
    console.error('Rekord: could not write to the Rekord folder', error);
    return false;
  }
}
