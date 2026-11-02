// Redaction: removes a span of a meeting for good (audio, transcript, summary lines, items, search entries).
import {
  deleteAsk, deleteChunk, deleteMarker, deleteNote, deleteSegment, getMeeting, getRecordingMeta, listAsks, listChunks, listMarkers,
  listMeetings, listNotes, listRecordingParts, listSegments, putChunk, putMeeting, replaceRecordingParts,
} from './db';
import { record } from './ledger';
import { refreshBadge, send } from './messages';
import { addTombstones, deleteItem, getPerson, listItems, putItem, replaceVectors, vectorsForMeeting } from './memory/store';
import type { AskTurn, Chunk, Marker, Meeting, Note, RecordingMeta, RecordingPart, RecordingState, Segment, Summary } from './types';
import type { ItemKind, MemoryItem, Quote, VectorRow } from './memory/types';

/** T8's Forget can offer "redact their words" because `redactPerson` exists. */
export const canRedactPerson = true;

export interface Span { startMs: number; endMs: number }
/** One redaction on a meeting: the span in meeting time and when it was redacted. */
export interface RedactionMark extends Span { at: number }
/** Meetings carry their redactions and a flag for the Rekord folder writer (T13) to rewrite the meeting's file. */
export type RedactedMeeting = Meeting & { redactions?: RedactionMark[]; needsFolderWrite?: boolean };

export const redactionsOf = (m: Meeting | undefined): RedactionMark[] => (m as RedactedMeeting | undefined)?.redactions ?? [];
export const needsFolderWrite = (m: Meeting | undefined): boolean => !!(m as RedactedMeeting | undefined)?.needsFolderWrite;

/** The folder writer calls this once it has rewritten the meeting's file. */
export async function markFolderWritten(meetingId: string): Promise<void> {
  const m = (await getMeeting(meetingId)) as RedactedMeeting | undefined;
  if (!m?.needsFolderWrite) return;
  const { needsFolderWrite: _, ...rest } = m;
  await putMeeting(rest);
}

/** Meetings whose Rekord folder file must be rewritten. */
export async function meetingsNeedingFolderWrite(): Promise<Meeting[]> {
  return (await listMeetings()).filter(needsFolderWrite);
}

type FolderListener = (meetingId: string) => void;
const folderListeners = new Set<FolderListener>();
/** Hook for the folder writer: called after each redaction marks a meeting. Returns the unsubscribe. */
export function onFolderRewrite(listener: FolderListener): () => void {
  folderListeners.add(listener);
  return () => folderListeners.delete(listener);
}

// Pure planning

export const overlaps = (a0: number, a1: number, s: Span) => a0 < s.endMs && a1 > s.startMs;
export const inside = (at: number, s: Span) => at >= s.startMs && at <= s.endMs;
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Summary without the lines that quote the span; `removed` counts the lines taken out. */
export function summaryWithout(summary: Summary, span: Span, spanTexts: string[], goneItemTexts: string[]): { summary: Summary; removed: number } {
  const said = spanTexts.map(norm).filter((t) => t.length >= 8);
  const gone = new Set(goneItemTexts.map(norm));
  const quotes = (line: string) => {
    const n = norm(line);
    return !!n && (gone.has(n) || said.some((t) => t.includes(n) || n.includes(t)));
  };
  let removed = 0;
  const keep = <T>(list: T[], hit: (x: T) => boolean) => list.filter((x) => (hit(x) ? (removed++, false) : true));
  const sentences = summary.overview.split(/(?<=[.!?])\s+/).filter(Boolean);
  const overview = keep(sentences, (s) => said.some((t) => norm(s).includes(t))).join(' ');
  return {
    summary: {
      ...summary,
      overview,
      decisions: keep(summary.decisions, (d) => (typeof d === 'string' ? quotes(d) : (d.atMs !== undefined && inside(d.atMs, span)) || quotes(d.text))),
      actions: keep(summary.actions, (a) => quotes(a.text)),
      questions: keep(summary.questions, quotes),
    },
    removed,
  };
}

export interface SpanInput {
  meetingId: string; span: Span; summary?: Summary;
  segments: Segment[]; markers: Marker[]; chunks: Chunk[]; vectors: VectorRow[];
  items: MemoryItem[];               // every item: replaced decisions may sit in other meetings
  notes?: Note[]; asks?: AskTurn[];
}
export interface SpanPlan {
  segmentIds: string[]; markerIds: string[]; chunkIds: string[]; vectorIds: string[]; noteIds: string[]; askIds: string[];
  trimmedChunks: Chunk[];            // chunks without audio that only overlap the span's edge keep their outside part
  deleteItemIds: string[];
  changedItems: MemoryItem[];        // lost a later mention, or a link to a deleted item
  removedKinds: Record<ItemKind, number>;
  summary?: Summary; summaryLines: number;
}

/** What a redaction removes, without touching anything. */
export function planSpan(input: SpanInput, now: number): SpanPlan {
  const { meetingId, span } = input;
  // A line touching the span only at its edge stays; a zero-length line counts when it sits inside.
  const hits = (a0: number, a1: number) => overlaps(a0, Math.max(a1, a0 + 1), span);
  const segs = input.segments.filter((s) => hits(s.startMs, s.endMs));
  const quoted = (q: Quote | undefined) => !!q && q.meetingId === meetingId && inside(q.atMs, span);
  const doomed = input.items.filter((i) => quoted(i.quote));
  const gone = new Set(doomed.map((i) => i.id));
  const removedKinds: Record<ItemKind, number> = { promise: 0, decision: 0, question: 0 };
  for (const i of doomed) removedKinds[i.kind]++;
  const changedItems: MemoryItem[] = [];
  for (const i of input.items) {
    if (gone.has(i.id)) continue;
    const next: MemoryItem = { ...i, history: i.history.filter((q) => !quoted(q)) };
    if (quoted(i.evidence)) delete next.evidence;
    if (next.replacedById && gone.has(next.replacedById)) { delete next.replacedById; if (next.status === 'replaced') next.status = 'open'; }
    if (next.replacesId && gone.has(next.replacesId)) delete next.replacesId;
    const changed = next.history.length !== i.history.length || next.evidence !== i.evidence
      || next.replacedById !== i.replacedById || next.replacesId !== i.replacesId;
    if (changed) changedItems.push({ ...next, updatedAt: now });
  }
  // Compressed chunk audio cannot be cut, so a chunk holding audio goes whole; one without audio is trimmed to its outside part.
  const chunkIds: string[] = [];
  const trimmedChunks: Chunk[] = [];
  for (const c of input.chunks.filter((c) => hits(c.startMs, c.endMs))) {
    const before = c.startMs < span.startMs;
    if (c.audio || (!before && c.endMs <= span.endMs)) chunkIds.push(c.id);
    else trimmedChunks.push(before ? { ...c, endMs: span.startMs } : { ...c, startMs: span.endMs });
  }
  const said = segs.map((s) => norm(s.text)).filter((t) => t.length >= 8);
  const askIds = (input.asks ?? [])
    .filter((a) => a.citations?.some((at) => inside(at, span)) || (!!a.answer && said.some((t) => norm(a.answer!).includes(t))))
    .map((a) => a.id);
  const cut = input.summary && summaryWithout(input.summary, span, segs.map((s) => s.text), doomed.map((i) => i.text));
  return {
    segmentIds: segs.map((s) => s.id),
    markerIds: input.markers.filter((m) => inside(m.atMs, span)).map((m) => m.id),
    chunkIds, trimmedChunks,
    vectorIds: input.vectors.filter((v) => hits(v.atMs, v.endMs)).map((v) => v.id),
    noteIds: (input.notes ?? []).filter((n) => inside(n.atMs, span)).map((n) => n.id),
    askIds,
    deleteItemIds: [...gone], changedItems, removedKinds,
    summary: cut?.summary, summaryLines: cut?.removed ?? 0,
  };
}

/** Several spans of one meeting as one plan: each span is planned over what the earlier ones left. */
export function planSpans(input: Omit<SpanInput, 'span'>, spans: Span[], now: number): SpanPlan {
  let cur: Omit<SpanInput, 'span'> = input;
  const out: SpanPlan = {
    segmentIds: [], markerIds: [], chunkIds: [], vectorIds: [], noteIds: [], askIds: [], trimmedChunks: [], deleteItemIds: [],
    changedItems: [], removedKinds: { promise: 0, decision: 0, question: 0 }, summary: undefined, summaryLines: 0,
  };
  const trimmed = new Map<string, Chunk>();
  const changed = new Map<string, MemoryItem>();
  for (const span of spans) {
    const p = planSpan({ ...cur, span }, now);
    out.segmentIds.push(...p.segmentIds); out.markerIds.push(...p.markerIds); out.chunkIds.push(...p.chunkIds);
    out.vectorIds.push(...p.vectorIds); out.noteIds.push(...p.noteIds); out.askIds.push(...p.askIds); out.deleteItemIds.push(...p.deleteItemIds);
    for (const k of Object.keys(p.removedKinds) as ItemKind[]) out.removedKinds[k] += p.removedKinds[k];
    out.summaryLines += p.summaryLines;
    if (p.summary) out.summary = p.summary;
    for (const id of p.chunkIds) trimmed.delete(id);
    for (const c of p.trimmedChunks) trimmed.set(c.id, c);
    for (const id of p.deleteItemIds) changed.delete(id);
    for (const i of p.changedItems) changed.set(i.id, i);
    const drop = new Set([...p.segmentIds, ...p.markerIds, ...p.chunkIds, ...p.vectorIds, ...p.noteIds, ...p.askIds, ...p.deleteItemIds]);
    const keep = <T extends { id: string }>(rows: T[] | undefined, swap?: Map<string, T>) =>
      (rows ?? []).filter((r) => !drop.has(r.id)).map((r) => swap?.get(r.id) ?? r);
    cur = {
      ...cur, summary: p.summary ?? cur.summary,
      segments: keep(cur.segments), markers: keep(cur.markers), chunks: keep(cur.chunks, trimmed), vectors: keep(cur.vectors),
      items: keep(cur.items, changed), notes: keep(cur.notes), asks: keep(cur.asks),
    };
  }
  out.trimmedChunks = [...trimmed.values()];
  out.changedItems = [...changed.values()];
  return out;
}

// Audio: decoded once, the spans set to silence in place, saved again as one part

export interface Pcm { sampleRate: number; samples: Float32Array }
export type Decode = (blob: Blob) => Promise<Pcm | undefined>;
export type Encode = (pcm: Pcm) => Promise<Blob>;
const PCM_RATE = 16_000;

/** Meeting time to recording time: the recording has no audio during pauses. */
export function toRecordingMs(meetingMs: number, pauses: RecordingMeta['pauses']): number {
  let shift = 0;
  for (const p of [...pauses].sort((a, b) => a.atMs - b.atMs)) {
    const start = p.atMs + shift;
    if (meetingMs <= start) break;
    if (meetingMs < start + p.durationMs) return p.atMs;
    shift += p.durationMs;
  }
  return meetingMs - shift;
}

/** Sets the samples from `fromMs` to `toMs` to zero, in place: a long meeting is never copied. */
export function silence(pcm: Pcm, fromMs: number, toMs: number): Pcm {
  const a = Math.max(0, Math.floor((fromMs * pcm.sampleRate) / 1000));
  const b = Math.min(pcm.samples.length, Math.ceil((toMs * pcm.sampleRate) / 1000));
  if (b > a) pcm.samples.fill(0, a, b);
  return pcm;
}

export function encodeWav(pcm: Pcm): Blob {
  const n = pcm.samples.length;
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, pcm.sampleRate, true); view.setUint32(28, pcm.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm.samples[i]!)) * 0x7fff), true);
  return new Blob([view.buffer], { type: 'audio/wav' });
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function oggPage(packets: Uint8Array[], serial: number, seq: number, granule: number, flags: number): Uint8Array<ArrayBuffer> {
  const lacing: number[] = [];
  for (const p of packets) { let n = p.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
  const size = packets.reduce((n, p) => n + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + size);
  const v = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53, 0, flags]);
  v.setUint32(6, granule % 2 ** 32, true); v.setUint32(10, Math.floor(granule / 2 ** 32), true);
  v.setUint32(14, serial, true); v.setUint32(18, seq, true);
  page[26] = lacing.length; page.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const p of packets) { page.set(p, at); at += p.length; }
  let crc = 0;
  for (const b of page) crc = ((crc << 8) ^ CRC[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  v.setUint32(22, crc, true);
  return page;
}

/** Opus packets in an Ogg file (RFC 7845); `durations` are in 48 kHz samples. Mono. */
export function oggOpus(packets: Uint8Array[], durations: number[], inputRate: number, preSkip = 312): Blob {
  const serial = 0x52454b44;
  const head = new Uint8Array(19);
  const hv = new DataView(head.buffer);
  head.set([...'OpusHead'].map((c) => c.charCodeAt(0))); head[8] = 1; head[9] = 1;
  hv.setUint16(10, preSkip, true); hv.setUint32(12, inputRate, true);
  const vendor = [...'Rekord'].map((c) => c.charCodeAt(0));
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set([...'OpusTags'].map((c) => c.charCodeAt(0))); new DataView(tags.buffer).setUint32(8, vendor.length, true); tags.set(vendor, 12);
  const pages: BlobPart[] = [oggPage([head], serial, 0, 0, 2), oggPage([tags], serial, 1, 0, 0)];
  let granule = preSkip;
  let seq = 2;
  // About a second of 20 ms packets per page keeps the page overhead small.
  for (let i = 0; i < packets.length; i += 50) {
    const group = packets.slice(i, i + 50);
    for (let j = i; j < i + group.length; j++) granule += durations[j] ?? 960;
    pages.push(oggPage(group, serial, seq++, granule, i + 50 >= packets.length ? 4 : 0));
  }
  return new Blob(pages, { type: 'audio/ogg; codecs=opus' });
}

type Chunked = { byteLength: number; duration: number | null; copyTo(dest: Uint8Array): void };
interface EncoderLike {
  configure(c: object): void; encode(d: unknown): void; flush(): Promise<void>; close(): void; encodeQueueSize: number;
}
interface EncoderCtor {
  new (init: { output: (c: Chunked, meta?: { decoderConfig?: { description?: ArrayBuffer | ArrayBufferView } }) => void; error: (e: unknown) => void }): EncoderLike;
  isConfigSupported(c: object): Promise<{ supported?: boolean }>;
}

/** Opus through WebCodecs, about 1/20 the size of WAV; undefined when the browser has no Opus encoder. */
async function opusEncode(pcm: Pcm): Promise<Blob | undefined> {
  const g = globalThis as unknown as { AudioEncoder?: EncoderCtor; AudioData?: new (init: object) => { close(): void } };
  if (!g.AudioEncoder || !g.AudioData) return undefined;
  const config = { codec: 'opus', sampleRate: pcm.sampleRate, numberOfChannels: 1, bitrate: 24_000 };
  if (!(await g.AudioEncoder.isConfigSupported(config)).supported) return undefined;
  const packets: Uint8Array[] = [];
  const durations: number[] = [];
  let preSkip = 312;
  let failed: unknown;
  const encoder = new g.AudioEncoder({
    output: (chunk, meta) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      packets.push(bytes);
      durations.push(Math.round(((chunk.duration ?? 20_000) * 48) / 1000));
      const d = meta?.decoderConfig?.description;
      if (d) {
        const h = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
        if (h.length >= 12 && String.fromCharCode(...h.subarray(0, 8)) === 'OpusHead') preSkip = h[10]! | (h[11]! << 8);
      }
    },
    error: (e) => { failed = e; },
  });
  encoder.configure(config);
  const step = pcm.sampleRate;
  for (let i = 0; i < pcm.samples.length && !failed; i += step) {
    const data = pcm.samples.subarray(i, Math.min(i + step, pcm.samples.length));
    const frame = new g.AudioData({ format: 'f32-planar', sampleRate: pcm.sampleRate, numberOfFrames: data.length, numberOfChannels: 1, timestamp: Math.round((i * 1e6) / pcm.sampleRate), data });
    encoder.encode(frame);
    frame.close();
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
  }
  await encoder.flush();
  encoder.close();
  if (failed || !packets.length) return undefined;
  return oggOpus(packets, durations, pcm.sampleRate, preSkip);
}

/** Compact Opus where the browser can encode it, WAV otherwise. */
export const browserEncode: Encode = async (pcm) => {
  try {
    const opus = await opusEncode(pcm);
    if (opus) return opus;
  } catch (error) {
    console.error('Rekord: could not encode the redacted recording as Opus; saving WAV', error);
  }
  return encodeWav(pcm);
};

/** Browser decoder (side panel); undefined where Web Audio is missing. Mixes to mono inside the decoded buffer. */
export const browserDecode: Decode = async (blob) => {
  if (typeof OfflineAudioContext === 'undefined') return undefined;
  const buf = await new OfflineAudioContext(1, 1, PCM_RATE).decodeAudioData(await blob.arrayBuffer());
  const mono = buf.getChannelData(0);
  if (buf.numberOfChannels > 1) {
    const rest = Array.from({ length: buf.numberOfChannels - 1 }, (_, c) => buf.getChannelData(c + 1));
    for (let i = 0; i < mono.length; i++) {
      let sum = mono[i]!;
      for (const ch of rest) sum += ch[i]!;
      mono[i] = sum / buf.numberOfChannels;
    }
  }
  return { sampleRate: buf.sampleRate, samples: mono };
};

/**
 * The kept recording with the spans silenced, built in memory without writing anything. The parts are fragments of
 * one compressed file, so they cannot be cut as they are: the file is decoded once, the spans set to silence and
 * encoded again as one part. When it cannot be decoded this throws, and the redaction stops before any change.
 */
async function silencedRecording(meetingId: string, spans: Span[], decode: Decode, encode: Encode): Promise<RecordingPart | undefined> {
  const parts = await listRecordingParts(meetingId);
  if (!parts.length) return undefined;
  const meta = (await getRecordingMeta(meetingId)) ?? { meetingId, pauses: [] };
  const pcm = await decode(new Blob(parts.map((p) => p.blob), { type: parts[0]!.mimeType }));
  if (!pcm) throw new Error('Rekord: this browser cannot decode the recording, so it cannot be redacted');
  for (const s of spans) silence(pcm, toRecordingMs(s.startMs, meta.pauses), toRecordingMs(s.endMs, meta.pauses));
  const blob = await encode(pcm);
  return { id: `${meetingId}-redacted-0`, meetingId, seq: 0, blob, mimeType: blob.type };
}

// Reading and redacting

export interface RedactPreview {
  meeting: Meeting; span: Span; segments: Segment[]; plan: SpanPlan; audio: boolean; searchEntries: number;
}

async function gather(meetingId: string, span?: Span) {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new Error('This meeting is no longer on this computer.');
  const [segments, markers, chunks, vectors, items, parts, notes, asks] = await Promise.all([
    listSegments(meetingId), listMarkers(meetingId), listChunks(meetingId), vectorsForMeeting(meetingId), listItems(), listRecordingParts(meetingId),
    listNotes(meetingId), listAsks(meetingId),
  ]);
  const hasAudio = parts.length > 0 || chunks.some((c) => c.audio && (!span || overlaps(c.startMs, c.endMs, span)));
  return { meeting, segments, markers, chunks, vectors, items, notes, asks, hasAudio };
}

/** What "Redact" would remove, for the confirm sheet. */
export async function previewRedaction(meetingId: string, span: Span, now = Date.now()): Promise<RedactPreview> {
  const g = await gather(meetingId, span);
  const plan = planSpan({ meetingId, span, summary: g.meeting.summary, ...g }, now);
  const ids = new Set(plan.segmentIds);
  return { meeting: g.meeting, span, segments: g.segments.filter((s) => ids.has(s.id)), plan, audio: g.hasAudio, searchEntries: plan.vectorIds.length };
}

export interface RedactOptions {
  now?: number; decode?: Decode; encode?: Encode; notify?: () => void;
  /** The meeting being recorded now, if any; asks the background by default. */
  recording?: () => Promise<string | undefined>;
}
export interface RedactResult { plan: SpanPlan; audio: 'none' | 'silenced'; mark: RedactionMark; marks: RedactionMark[] }

/** The meeting the background is recording now; undefined when idle or when it does not answer. */
export async function recordingMeetingId(): Promise<string | undefined> {
  const state = await send<RecordingState>({ type: 'recording/get-state' }).catch(() => undefined);
  return state && state.status !== 'idle' ? state.meetingId : undefined;
}

/**
 * Redacts the spans of one meeting for good. Everything that can fail without changing anything runs first:
 * reading, planning, decoding and re-encoding the audio. Only then are the stores written, audio first in one transaction.
 */
export async function redactSpans(meetingId: string, spans: Span[], opts: RedactOptions = {}): Promise<RedactResult> {
  if (!spans.length) throw new Error('Rekord: nothing to redact');
  if ((await (opts.recording ?? recordingMeetingId)()) === meetingId) throw new Error('Rekord: this meeting is being recorded');
  const now = opts.now ?? Date.now();
  const g = await gather(meetingId);
  const plan = planSpans({ meetingId, summary: g.meeting.summary, ...g }, spans, now);
  const recording = await silencedRecording(meetingId, spans, opts.decode ?? browserDecode, opts.encode ?? browserEncode);

  if (recording) await replaceRecordingParts(meetingId, [recording]);
  await Promise.all([
    ...plan.segmentIds.map(deleteSegment), ...plan.markerIds.map(deleteMarker), ...plan.chunkIds.map(deleteChunk),
    ...plan.noteIds.map(deleteNote), ...plan.askIds.map(deleteAsk), ...plan.trimmedChunks.map(putChunk),
  ]);
  await addTombstones(plan.deleteItemIds);
  for (const id of plan.deleteItemIds) await deleteItem(id);
  for (const i of plan.changedItems) await putItem(i);
  if (plan.vectorIds.length) {
    const drop = new Set(plan.vectorIds);
    await replaceVectors(meetingId, g.vectors.filter((v) => !drop.has(v.id)));
  }
  const marks: RedactionMark[] = spans.map((s) => ({ startMs: s.startMs, endMs: s.endMs, at: now }));
  const fresh = ((await getMeeting(meetingId)) ?? g.meeting) as RedactedMeeting;
  const next: RedactedMeeting = { ...fresh, redactions: [...(fresh.redactions ?? []), ...marks], needsFolderWrite: true };
  if (plan.summary) next.summary = plan.summary;
  await putMeeting(next);
  for (const _ of marks) await record({ meetingId, service: 'redaction', what: 'Redacted', at: now });
  for (const l of folderListeners) l(meetingId);
  if (plan.deleteItemIds.length || plan.changedItems.length) (opts.notify ?? refreshBadge)();
  return { plan, audio: recording ? 'silenced' : 'none', mark: marks[0]!, marks };
}

/** Redacts one span for good. Runs only after the user's click on "Redact". */
export const redactSpan = (meetingId: string, span: Span, opts: RedactOptions = {}): Promise<RedactResult> => redactSpans(meetingId, [span], opts);

/** Merges touching or overlapping spans. */
export function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.startMs - b.startMs)) {
    const last = out[out.length - 1];
    if (last && s.startMs <= last.endMs) last.endMs = Math.max(last.endMs, s.endMs);
    else out.push({ ...s });
  }
  return out;
}

/** The spans one person spoke in a meeting: their diarized voice, and the lines their memory quotes come from. */
export function personSpans(meetingId: string, meeting: Meeting, names: string[], segments: Segment[], items: MemoryItem[]): Span[] {
  const wanted = new Set(names.map(norm).filter(Boolean));
  const labels = new Set(Object.entries(meeting.speakers ?? {})
    .filter(([, s]) => (s.name && wanted.has(norm(s.name))) || (!s.name && s.suggested && wanted.has(norm(s.suggested))))
    .map(([label]) => label));
  const spans: Span[] = segments.filter((s) => s.speakerLabel && labels.has(s.speakerLabel)).map((s) => ({ startMs: s.startMs, endMs: s.endMs }));
  const quotes = items.flatMap((i) => [i.quote, ...i.history, ...(i.evidence ? [i.evidence] : [])])
    .filter((q) => q.meetingId === meetingId && wanted.has(norm(q.speaker)));
  for (const q of quotes) {
    const seg = segments.find((s) => s.startMs <= q.atMs && q.atMs <= s.endMs);
    spans.push(seg ? { startMs: seg.startMs, endMs: seg.endMs } : { startMs: q.atMs, endMs: q.atMs });
  }
  return mergeSpans(spans);
}

/** Redacts every word one person said, across meetings (T8's Forget option): one decode per meeting. Runs only after the user's click. */
export async function redactPerson(personId: string, opts: RedactOptions = {}): Promise<{ meetings: number; spans: number }> {
  const person = await getPerson(personId);
  if (!person) return { meetings: 0, spans: 0 };
  const names = [person.name, ...person.aliases];
  const wanted = new Set(names.map(norm));
  const items = await listItems();
  const ids = new Set([...person.meetingIds, ...items.filter((i) => wanted.has(norm(i.quote.speaker))).map((i) => i.meetingId)]);
  const recording = await (opts.recording ?? recordingMeetingId)();
  if (recording && ids.has(recording)) throw new Error('Rekord: a meeting with this person is being recorded');
  const once = { ...opts, recording: async () => recording };
  let meetings = 0;
  let spans = 0;
  for (const meetingId of ids) {
    const meeting = await getMeeting(meetingId);
    if (!meeting) continue;
    const found = personSpans(meetingId, meeting, names, await listSegments(meetingId), await listItems());
    if (!found.length) continue;
    await redactSpans(meetingId, found, once);
    meetings++;
    spans += found.length;
  }
  return { meetings, spans };
}
