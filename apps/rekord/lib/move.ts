/**
 * "Move to a new computer": all of Rekord as one .rekord file, and bringing one in with duplicates kept once.
 * Layout: "REKORD-MOVE\n", the header's byte length as 12 digits and "\n", the JSON header, then each audio part's
 * bytes in header order. Audio stays a Blob end to end, so a 1 GB file is never held in memory as one string.
 */
import { getDB, getMeeting, putAsk, putMarker, putMeeting, putNote, putRecordingMeta, putRecordingPart, putSegment } from './db';
import {
  getAgenda, getItem, getPerson, listLedger, listPeople, listItems, listVectors, putAgenda, putItem, putLedgerEntry, putPerson, putVectors,
  tombstones,
} from './memory/store';
import type { Agenda, LedgerEntry, MemoryItem, Person, VectorRow } from './memory/types';
import { getSettings, updateSettings } from './settings';
import type { AskTurn, Marker, Meeting, Note, RecordingMeta, Segment, Settings } from './types';

export const MOVE_FORMAT = 'rekord-move';
export const MOVE_VERSION = 2;
const MAGIC = 'REKORD-MOVE\n';
const PREFIX = MAGIC.length + 13;

type StoredVector = Omit<VectorRow, 'v'> & { v: string };
/** One audio part as the header lists it; its bytes follow the header. */
export interface AudioEntry { id: string; meetingId: string; seq: number; mimeType: string; size: number }
interface MoveHeader {
  format: typeof MOVE_FORMAT; version: number; exportedAt: number;
  meetings: Meeting[]; segments: Segment[]; notes: Note[]; markers: Marker[]; asks: AskTurn[];
  recordingMeta: RecordingMeta[]; audio: AudioEntry[];
  people: Person[]; items: MemoryItem[]; vectors: StoredVector[]; ledger: LedgerEntry[]; agendas: Agenda[];
  settings: Partial<Settings>;
}
/** A read file: each audio part is a slice of the file, read only when it is stored. */
export type MoveFile = Omit<MoveHeader, 'audio'> & { audio: (AudioEntry & { blob: Blob })[] };

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

async function readAll(full: boolean): Promise<{ file: MoveHeader; blobs: Blob[]; audioBytes: number }> {
  const db = await getDB();
  const [meetings, segments, notes, markers, asks, recordingMeta, parts, people, items, vectors, ledger, settings] = await Promise.all([
    db.getAll('meetings'), db.getAll('segments'), db.getAll('notes'), db.getAll('markers'), db.getAll('asks'),
    db.getAll('recordingMeta'), db.getAll('recordings'),
    listPeople(), listItems(), listVectors(), listLedger(), getSettings(),
  ]);
  // Agendas are keyed by meeting or calendar event; store.ts is the only reader of v4 stores.
  const keys = [...new Set(meetings.flatMap((m) => [m.id, m.event?.id]).filter((k): k is string => !!k))];
  const agendas = (await Promise.all(keys.map(getAgenda))).filter((a): a is Agenda => !!a);
  const audio = parts.map((p) => ({ id: p.id, meetingId: p.meetingId, seq: p.seq, mimeType: p.mimeType, size: p.blob.size }));
  return {
    file: {
      format: MOVE_FORMAT, version: MOVE_VERSION, exportedAt: Date.now(),
      meetings, segments, notes, markers, asks, recordingMeta, audio,
      people, items, vectors: full ? vectors.map(vectorOut) : vectors.map((r) => ({ ...r, v: 'x'.repeat(Math.ceil(r.v.byteLength / 3) * 4) })), ledger, agendas, settings: portableSettings(settings),
    },
    blobs: parts.map((p) => p.blob),
    audioBytes: parts.reduce((n, p) => n + p.blob.size, 0),
  };
}

export interface ExportInfo { bytes: number; meetings: number; people: number; items: number; audio: boolean }

/** Size and contents of the file "Save the file" would write, without encoding audio or vectors. */
export async function exportInfo(): Promise<ExportInfo> {
  const { file, audioBytes } = await readAll(false);
  const bytes = PREFIX + JSON.stringify(file).length + audioBytes;
  return { bytes, meetings: file.meetings.length, people: file.people.length, items: file.items.length, audio: audioBytes > 0 };
}

/** The .rekord file as a Blob of pieces: the audio parts are referenced, not copied into memory. */
export async function buildExport(): Promise<Blob> {
  const { file, blobs } = await readAll(true);
  const header = new TextEncoder().encode(JSON.stringify(file));
  return new Blob([MAGIC, `${String(header.byteLength).padStart(12, '0')}\n`, header, ...blobs], { type: 'application/octet-stream' });
}

export const exportName = (now: number) => {
  const d = new Date(now);
  return `rekord-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.rekord`;
};

/** Reads a .rekord file by slices: only the header is read now; undefined when it is not one. */
export async function parseMove(file: Blob): Promise<MoveFile | undefined> {
  try {
    const head = await file.slice(0, PREFIX).text();
    if (!head.startsWith(MAGIC) || head[PREFIX - 1] !== '\n') return undefined;
    const length = Number(head.slice(MAGIC.length, PREFIX - 1));
    if (!Number.isInteger(length) || PREFIX + length > file.size) return undefined;
    const data = JSON.parse(await file.slice(PREFIX, PREFIX + length).text()) as Partial<MoveHeader>;
    if (data.format !== MOVE_FORMAT || !Array.isArray(data.meetings)) return undefined;
    const list = <T>(v: T[] | undefined) => (Array.isArray(v) ? v : []);
    let at = PREFIX + length;
    const audio = list(data.audio).map((a) => {
      const blob = file.slice(at, at + a.size, a.mimeType);
      at += a.size;
      return { ...a, blob };
    });
    if (at > file.size) return undefined;
    return {
      format: MOVE_FORMAT, version: data.version ?? MOVE_VERSION, exportedAt: data.exportedAt ?? 0,
      meetings: data.meetings, segments: list(data.segments), notes: list(data.notes), markers: list(data.markers), asks: list(data.asks),
      recordingMeta: list(data.recordingMeta), audio, people: list(data.people), items: list(data.items),
      vectors: list(data.vectors), ledger: list(data.ledger), agendas: list(data.agendas), settings: data.settings ?? {},
    };
  } catch {
    return undefined;
  }
}

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** `local` with only the keys it lacks taken from `from`, nested objects included: this computer's settings win. */
export function fillMissing<T extends object>(local: T, from: Record<string, unknown>): T {
  const out = { ...local } as Record<string, unknown>;
  for (const [k, v] of Object.entries(from)) {
    if (out[k] === undefined) out[k] = v;
    else if (plain(out[k]) && plain(v)) out[k] = fillMissing(out[k] as Record<string, unknown>, v);
  }
  return out as T;
}

export interface MovePreview { meetings: number; people: number; already: number }

/** "312 meetings, 48 people, 6 already here (kept once)". */
export async function previewMove(file: MoveFile): Promise<MovePreview> {
  const here = await Promise.all(file.meetings.map((m) => getMeeting(m.id)));
  return { meetings: file.meetings.length, people: file.people.length, already: here.filter(Boolean).length };
}

/**
 * Brings a file in. A meeting, person, item or entry already here is kept once: this computer's copy stays.
 * Items and people redacted or forgotten here stay gone, and local settings win.
 */
export async function importMove(file: MoveFile): Promise<{ meetings: number }> {
  const gone = await tombstones();
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
    await putRecordingPart({ id: a.id, meetingId: a.meetingId, seq: a.seq, mimeType: a.mimeType, blob: a.blob });
  }
  for (const p of file.people) if (!gone.has(p.id) && !(await getPerson(p.id))) await putPerson(p);
  for (const i of file.items) if (!gone.has(i.id) && !(await getItem(i.id))) await putItem(i);
  await putVectors(ofFresh(file.vectors).map(vectorIn));
  const ledger = new Set((await listLedger()).map((e) => e.id));
  for (const e of file.ledger) if (!ledger.has(e.id)) await putLedgerEntry(e);
  for (const a of file.agendas) if (!(await getAgenda(a.meetingKey))) await putAgenda(a);
  const local = await getSettings();
  await updateSettings(fillMissing(local, portableSettings(file.settings as Settings)));
  return { meetings: fresh.size };
}
