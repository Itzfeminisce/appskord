// Redaction: removes a span of a meeting for good (audio, transcript, summary lines, items, search entries).
import {
  deleteChunk, deleteMarker, deleteRecording, deleteSegment, getMeeting, getRecordingMeta, listChunks, listMarkers,
  listMeetings, listRecordingParts, listSegments, putMeeting, putRecordingMeta, putRecordingPart,
} from './db';
import { record } from './ledger';
import { deleteItem, getPerson, listItems, putItem, replaceVectors, vectorsForMeeting } from './memory/store';
import type { Chunk, Marker, Meeting, RecordingMeta, Segment, Summary } from './types';
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
}
export interface SpanPlan {
  segmentIds: string[]; markerIds: string[]; chunkIds: string[]; vectorIds: string[];
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
  const cut = input.summary && summaryWithout(input.summary, span, segs.map((s) => s.text), doomed.map((i) => i.text));
  return {
    segmentIds: segs.map((s) => s.id),
    markerIds: input.markers.filter((m) => inside(m.atMs, span)).map((m) => m.id),
    chunkIds: input.chunks.filter((c) => hits(c.startMs, c.endMs)).map((c) => c.id),
    vectorIds: input.vectors.filter((v) => hits(v.atMs, v.endMs)).map((v) => v.id),
    deleteItemIds: [...gone], changedItems, removedKinds,
    summary: cut?.summary, summaryLines: cut?.removed ?? 0,
  };
}

// Audio: decoded, the span set to silence, saved again as one WAV part

export interface Pcm { sampleRate: number; samples: Float32Array }
export type Decode = (blob: Blob) => Promise<Pcm | undefined>;
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

export function silence(pcm: Pcm, fromMs: number, toMs: number): Pcm {
  const samples = pcm.samples.slice();
  const a = Math.max(0, Math.floor((fromMs * pcm.sampleRate) / 1000));
  const b = Math.min(samples.length, Math.ceil((toMs * pcm.sampleRate) / 1000));
  if (b > a) samples.fill(0, a, b);
  return { sampleRate: pcm.sampleRate, samples };
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

/** Browser decoder (side panel); undefined where Web Audio is missing. */
export const browserDecode: Decode = async (blob) => {
  if (typeof OfflineAudioContext === 'undefined') return undefined;
  const buf = await new OfflineAudioContext(1, 1, PCM_RATE).decodeAudioData(await blob.arrayBuffer());
  const samples = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) samples[i] = (samples[i] ?? 0) + ch[i]! / buf.numberOfChannels;
  }
  return { sampleRate: buf.sampleRate, samples };
};

/**
 * Silences the span in the kept recording. The parts are fragments of one compressed file, so they cannot be cut
 * exactly as they are: the file is decoded, the span set to silence and saved as one WAV part. When it cannot be
 * decoded, the whole recording is dropped instead.
 */
async function redactAudio(meetingId: string, span: Span, decode: Decode): Promise<'none' | 'silenced' | 'dropped'> {
  const parts = await listRecordingParts(meetingId);
  if (!parts.length) return 'none';
  const meta = (await getRecordingMeta(meetingId)) ?? { meetingId, pauses: [] };
  let pcm: Pcm | undefined;
  try {
    pcm = await decode(new Blob(parts.map((p) => p.blob), { type: parts[0]!.mimeType }));
  } catch (error) {
    console.error('Rekord: could not decode the recording to redact it; dropping it', error);
  }
  await deleteRecording(meetingId);
  if (!pcm) return 'dropped';
  const quiet = silence(pcm, toRecordingMs(span.startMs, meta.pauses), toRecordingMs(span.endMs, meta.pauses));
  await putRecordingPart({ id: `${meetingId}-redacted-0`, meetingId, seq: 0, blob: encodeWav(quiet), mimeType: 'audio/wav' });
  await putRecordingMeta(meta);
  return 'silenced';
}

// Reading and redacting

export interface RedactPreview {
  meeting: Meeting; span: Span; segments: Segment[]; plan: SpanPlan; audio: boolean; searchEntries: number;
}

async function gather(meetingId: string, span: Span) {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new Error('This meeting is no longer on this computer.');
  const [segments, markers, chunks, vectors, items, parts] = await Promise.all([
    listSegments(meetingId), listMarkers(meetingId), listChunks(meetingId), vectorsForMeeting(meetingId), listItems(), listRecordingParts(meetingId),
  ]);
  return { meeting, segments, markers, chunks, vectors, items, hasAudio: parts.length > 0 || chunks.some((c) => c.audio && overlaps(c.startMs, c.endMs, span)) };
}

/** What "Redact" would remove, for the confirm sheet. */
export async function previewRedaction(meetingId: string, span: Span, now = Date.now()): Promise<RedactPreview> {
  const g = await gather(meetingId, span);
  const plan = planSpan({ meetingId, span, summary: g.meeting.summary, ...g }, now);
  const ids = new Set(plan.segmentIds);
  return { meeting: g.meeting, span, segments: g.segments.filter((s) => ids.has(s.id)), plan, audio: g.hasAudio, searchEntries: plan.vectorIds.length };
}

export interface RedactOptions { now?: number; decode?: Decode; notify?: () => void }
export interface RedactResult { plan: SpanPlan; audio: 'none' | 'silenced' | 'dropped'; mark: RedactionMark }

const badge = () => { browser.runtime.sendMessage({ type: 'rekord.badge.refresh' }).catch(() => undefined); };

/** Redacts the span for good. Runs only after the user's click on "Redact". */
export async function redactSpan(meetingId: string, span: Span, opts: RedactOptions = {}): Promise<RedactResult> {
  const now = opts.now ?? Date.now();
  const g = await gather(meetingId, span);
  const plan = planSpan({ meetingId, span, summary: g.meeting.summary, ...g }, now);
  const audio = await redactAudio(meetingId, span, opts.decode ?? browserDecode);
  await Promise.all([
    ...plan.segmentIds.map(deleteSegment), ...plan.markerIds.map(deleteMarker), ...plan.chunkIds.map(deleteChunk),
  ]);
  for (const id of plan.deleteItemIds) await deleteItem(id);
  for (const i of plan.changedItems) await putItem(i);
  if (plan.vectorIds.length) {
    const drop = new Set(plan.vectorIds);
    await replaceVectors(meetingId, g.vectors.filter((v) => !drop.has(v.id)));
  }
  const mark: RedactionMark = { startMs: span.startMs, endMs: span.endMs, at: now };
  const fresh = ((await getMeeting(meetingId)) ?? g.meeting) as RedactedMeeting;
  const next: RedactedMeeting = { ...fresh, redactions: [...(fresh.redactions ?? []), mark], needsFolderWrite: true };
  if (plan.summary) next.summary = plan.summary;
  await putMeeting(next);
  await record({ meetingId, service: 'redaction', what: 'Redacted', at: now });
  for (const l of folderListeners) l(meetingId);
  if (plan.deleteItemIds.length || plan.changedItems.length) (opts.notify ?? badge)();
  return { plan, audio, mark };
}

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

/** Redacts every word one person said, across meetings (T8's Forget option). Runs only after the user's click. */
export async function redactPerson(personId: string, opts: RedactOptions = {}): Promise<{ meetings: number; spans: number }> {
  const person = await getPerson(personId);
  if (!person) return { meetings: 0, spans: 0 };
  const names = [person.name, ...person.aliases];
  const wanted = new Set(names.map(norm));
  const items = await listItems();
  const ids = new Set([...person.meetingIds, ...items.filter((i) => wanted.has(norm(i.quote.speaker))).map((i) => i.meetingId)]);
  let meetings = 0;
  let spans = 0;
  for (const meetingId of ids) {
    const meeting = await getMeeting(meetingId);
    if (!meeting) continue;
    const found = personSpans(meetingId, meeting, names, await listSegments(meetingId), await listItems());
    if (!found.length) continue;
    meetings++;
    // Later spans first, so each redaction reads what the earlier ones left.
    for (const span of found.reverse()) { await redactSpan(meetingId, span, opts); spans++; }
  }
  return { meetings, spans };
}
