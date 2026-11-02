/** "Move to a new computer": all of Rekord as one .rekord file (JSON), and bringing one in with duplicates kept once. */
import { getDB, getMeeting, putAsk, putMarker, putMeeting, putNote, putRecordingMeta, putRecordingPart, putSegment } from './db';
import {
  getAgenda, getItem, getPerson, listLedger, listPeople, listItems, listVectors, putAgenda, putItem, putLedgerEntry, putPerson, putVectors,
} from './memory/store';
import type { Agenda, LedgerEntry, MemoryItem, Person, VectorRow } from './memory/types';
import { getSettings, updateSettings } from './settings';
import type { AskTurn, Marker, Meeting, Note, RecordingMeta, Segment, Settings } from './types';

export const MOVE_FORMAT = 'rekord-move';
export const MOVE_VERSION = 1;

type StoredVector = Omit<VectorRow, 'v'> & { v: string };
export interface AudioPart { id: string; meetingId: string; seq: number; mimeType: string; data: string }
export interface MoveFile {
  format: typeof MOVE_FORMAT; version: number; exportedAt: number;
  meetings: Meeting[]; segments: Segment[]; notes: Note[]; markers: Marker[]; asks: AskTurn[];
  recordingMeta: RecordingMeta[]; audio: AudioPart[];
  people: Person[]; items: MemoryItem[]; vectors: StoredVector[]; ledger: LedgerEntry[]; agendas: Agenda[];
  settings: Partial<Settings>;
}

// Keys and tokens never live in settings, but these fields point at a grant or a connection on this computer only.
const LOCAL_ONLY = ['penvApp', 'keySource', 'penv', 'onboarded', 'google', 'notion'] as const;
/** Settings with nothing that belongs to this computer's keys or connections. */
export function portableSettings(s: Settings): Partial<Settings> {
  const copy: Partial<Settings> = structuredClone(s);
  for (const k of LOCAL_ONLY) delete copy[k];
  return copy;
}

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const vectorOut = (r: VectorRow): StoredVector => ({ ...r, v: toBase64(new Uint8Array(r.v.buffer, r.v.byteOffset, r.v.byteLength)) });
const vectorIn = (r: StoredVector): VectorRow => { const b = fromBase64(r.v); return { ...r, v: new Int8Array(b.buffer, b.byteOffset, b.byteLength) }; };

async function readAll(full: boolean): Promise<{ file: MoveFile; audioBytes: number }> {
  const db = await getDB();
  const [meetings, segments, notes, markers, asks, recordingMeta, parts, people, items, vectors, ledger, settings] = await Promise.all([
    db.getAll('meetings'), db.getAll('segments'), db.getAll('notes'), db.getAll('markers'), db.getAll('asks'),
    db.getAll('recordingMeta'), db.getAll('recordings'),
    listPeople(), listItems(), listVectors(), listLedger(), getSettings(),
  ]);
  // Agendas are keyed by meeting or calendar event; store.ts is the only reader of v4 stores.
  const keys = [...new Set(meetings.flatMap((m) => [m.id, m.event?.id]).filter((k): k is string => !!k))];
  const agendas = (await Promise.all(keys.map(getAgenda))).filter((a): a is Agenda => !!a);
  const audio = full
    ? await Promise.all(parts.map(async (p) => ({ id: p.id, meetingId: p.meetingId, seq: p.seq, mimeType: p.mimeType, data: toBase64(new Uint8Array(await p.blob.arrayBuffer())) })))
    : [];
  return {
    file: {
      format: MOVE_FORMAT, version: MOVE_VERSION, exportedAt: Date.now(),
      meetings, segments, notes, markers, asks, recordingMeta, audio,
      people, items, vectors: full ? vectors.map(vectorOut) : vectors.map((r) => ({ ...r, v: 'x'.repeat(Math.ceil(r.v.byteLength / 3) * 4) })), ledger, agendas, settings: portableSettings(settings),
    },
    audioBytes: parts.reduce((n, p) => n + p.blob.size, 0),
  };
}

export interface ExportInfo { bytes: number; meetings: number; people: number; items: number; audio: boolean }

/** Size and contents of the file "Save the file" would write, without encoding audio or vectors. */
export async function exportInfo(): Promise<ExportInfo> {
  const { file, audioBytes } = await readAll(false);
  const bytes = JSON.stringify(file).length + Math.ceil(audioBytes / 3) * 4;
  return { bytes, meetings: file.meetings.length, people: file.people.length, items: file.items.length, audio: audioBytes > 0 };
}

export async function buildExport(): Promise<Blob> {
  const { file } = await readAll(true);
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export const exportName = (now: number) => {
  const d = new Date(now);
  return `rekord-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.rekord`;
};

/** Reads a .rekord file; undefined when it is not one. */
export function parseMove(text: string): MoveFile | undefined {
  try {
    const data = JSON.parse(text) as Partial<MoveFile>;
    if (data.format !== MOVE_FORMAT || !Array.isArray(data.meetings)) return undefined;
    const list = <T>(v: T[] | undefined) => (Array.isArray(v) ? v : []);
    return {
      format: MOVE_FORMAT, version: data.version ?? MOVE_VERSION, exportedAt: data.exportedAt ?? 0,
      meetings: data.meetings, segments: list(data.segments), notes: list(data.notes), markers: list(data.markers), asks: list(data.asks),
      recordingMeta: list(data.recordingMeta), audio: list(data.audio), people: list(data.people), items: list(data.items),
      vectors: list(data.vectors), ledger: list(data.ledger), agendas: list(data.agendas), settings: data.settings ?? {},
    };
  } catch {
    return undefined;
  }
}

export interface MovePreview { meetings: number; people: number; already: number }

/** "312 meetings, 48 people, 6 already here (kept once)". */
export async function previewMove(file: MoveFile): Promise<MovePreview> {
  const here = await Promise.all(file.meetings.map((m) => getMeeting(m.id)));
  return { meetings: file.meetings.length, people: file.people.length, already: here.filter(Boolean).length };
}

/** Brings a file in. A meeting, person, item or entry already here is kept once: this computer's copy stays. */
export async function importMove(file: MoveFile): Promise<{ meetings: number }> {
  const fresh = new Set<string>();
  for (const m of file.meetings) {
    if (await getMeeting(m.id)) continue;
    fresh.add(m.id);
    await putMeeting(m);
  }
  const ofFresh = <T extends { meetingId: string }>(rows: T[]) => rows.filter((r) => fresh.has(r.meetingId));
  for (const s of ofFresh(file.segments)) await putSegment(s);
  for (const n of ofFresh(file.notes)) await putNote(n);
  for (const m of ofFresh(file.markers)) await putMarker(m);
  for (const a of ofFresh(file.asks)) await putAsk(a);
  for (const r of ofFresh(file.recordingMeta)) await putRecordingMeta(r);
  for (const a of ofFresh(file.audio)) {
    await putRecordingPart({ id: a.id, meetingId: a.meetingId, seq: a.seq, mimeType: a.mimeType, blob: new Blob([fromBase64(a.data) as BlobPart], { type: a.mimeType }) });
  }
  for (const p of file.people) if (!(await getPerson(p.id))) await putPerson(p);
  for (const i of file.items) if (!(await getItem(i.id))) await putItem(i);
  await putVectors(ofFresh(file.vectors).map(vectorIn));
  const ledger = new Set((await listLedger()).map((e) => e.id));
  for (const e of file.ledger) if (!ledger.has(e.id)) await putLedgerEntry(e);
  for (const a of file.agendas) if (!(await getAgenda(a.meetingKey))) await putAgenda(a);
  const local = await getSettings();
  const keep = Object.fromEntries(LOCAL_ONLY.map((k) => [k, local[k]]));
  await updateSettings({ ...portableSettings({ ...local, ...file.settings } as Settings), ...keep });
  return { meetings: fresh.size };
}
