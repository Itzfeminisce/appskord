/** Recall: local embeddings of transcript windows and hybrid search. The only entry point the UI uses. */
import { rankCandidates, type MeetingData } from '../askAll';
import { listMeetings, listNotes, listSegments } from '../db';
import { listItems, listVectors, replaceVectors, vectorsForMeeting } from '../memory/store';
import type { MemoryItem, VectorRow } from '../memory/types';
import type { Meeting } from '../types';
import { embedTexts, loadCachedModel } from './model';
import { quantize } from './quantize';
import { fuse, itemsByWindows, meetingsByWindows, rankWindows, scoreItem, searchable, type WindowHit } from './search';
import { windowsOf } from './windows';

export { ensureModel, modelState, removeModel, type ModelState, type Progress } from './model';

const BATCH = 16;

/** Embeds a meeting's transcript in 30 s windows and replaces its vectors. Returns the window count; 0 without a model. */
export async function embedMeeting(meetingId: string): Promise<number> {
  const windows = windowsOf(await listSegments(meetingId));
  if (!windows.length || !(await loadCachedModel())) return 0;
  const rows: VectorRow[] = [];
  for (let i = 0; i < windows.length; i += BATCH) {
    const part = windows.slice(i, i + BATCH);
    const vectors = await embedTexts(part.map((w) => w.text));
    part.forEach((w, j) => {
      const v = vectors[j];
      if (v) rows.push({ id: `${meetingId}:${w.atMs}`, meetingId, ...w, ...quantize(v) });
    });
  }
  await replaceVectors(meetingId, rows);
  return rows.length;
}

/** Background pass: embeds finished meetings that have no vectors yet, one at a time. Never throws. */
export async function embedPending(meetings?: Meeting[]): Promise<number> {
  let done = 0;
  try {
    if (!(await loadCachedModel())) return 0;
    for (const m of meetings ?? (await listMeetings())) {
      if (!m.endedAt || (await vectorsForMeeting(m.id)).length) continue;
      if (await embedMeeting(m.id)) done++;
    }
  } catch (e) {
    console.error('Rekord: could not embed meetings', e);
  }
  return done;
}

export interface SearchOptions {
  /** Meetings in scope (defaults to all). */
  meetings?: Meeting[];
  limit?: number;
  /** Loads a meeting's transcript and notes (defaults to the database). */
  load?: (m: Meeting) => Promise<MeetingData>;
}
export interface ItemHit { item: MemoryItem; score: number }
/** `atMs`/`text`: the best matching window, when vectors found one. */
export interface MeetingHit { meeting: Meeting; score: number; atMs?: number; text?: string }
/** Memory items come first, then meetings. 'keyword' means no search model was available. */
export interface SearchResult { mode: 'hybrid' | 'keyword'; items: ItemHit[]; meetings: MeetingHit[] }

const loadFromDb = async (meeting: Meeting): Promise<MeetingData> => ({
  meeting, segments: await listSegments(meeting.id), notes: await listNotes(meeting.id),
});

async function vectorHits(query: string, inScope: Set<string>): Promise<WindowHit[] | undefined> {
  try {
    if (!(await loadCachedModel())) return undefined;
    const [q] = await embedTexts([query]);
    if (!q) return undefined;
    return rankWindows(q, (await listVectors()).filter((r) => inScope.has(r.meetingId)));
  } catch (e) {
    console.error('Rekord: could not search by meaning', e);
    return undefined;
  }
}

/** Keyword (v3 scoring) plus cosine over windows, merged by rank fusion; keywords only without a model. */
export async function search(query: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const q = query.trim();
  const limit = opts.limit ?? 20;
  if (!q) return { mode: 'keyword', items: [], meetings: [] };
  const meetings = opts.meetings ?? (await listMeetings());
  const byId = new Map(meetings.map((m) => [m.id, m]));
  const [data, hits, allItems] = await Promise.all([
    Promise.all(meetings.map(opts.load ?? loadFromDb)),
    vectorHits(q, new Set(byId.keys())),
    listItems(),
  ]);

  const items = allItems.filter((i) => searchable(i) && byId.has(i.meetingId));
  const itemKeyword = items.map((i) => ({ id: i.id, s: scoreItem(i, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.id);
  const meetingKeyword = rankCandidates(data, q).map((c) => c.meeting.id);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const best = new Map<string, WindowHit>();
  for (const h of hits ?? []) if (!best.has(h.row.meetingId)) best.set(h.row.meetingId, h);

  return {
    mode: hits ? 'hybrid' : 'keyword',
    items: fuse(hits ? [itemKeyword, itemsByWindows(items, hits)] : [itemKeyword])
      .slice(0, limit)
      .map(({ id, score }) => ({ item: itemById.get(id)!, score })),
    meetings: fuse(hits ? [meetingKeyword, meetingsByWindows(hits)] : [meetingKeyword])
      .slice(0, limit)
      .map(({ id, score }) => ({ meeting: byId.get(id)!, score, atMs: best.get(id)?.row.atMs, text: best.get(id)?.row.text })),
  };
}
