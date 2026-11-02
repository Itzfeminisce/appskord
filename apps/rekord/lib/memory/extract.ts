import { getMeeting, listMeetings, listSegments } from '../db';
import { record } from '../ledger';
import { chat, displayName, LLMError, transcriptLines, type FetchLike } from '../llm';
import { getSettings } from '../settings';
import type { Meeting, Segment } from '../types';
import { normalise, quoteFound } from './check';
import { linkItem, matchPerson, type ItemCandidate, type Seen } from './link';
import { transition } from './promise';
import { isoDay } from './rank';
import { itemsForMeeting, listItems, listPeople, putItem, putPerson } from './store';
import type { ItemKind, LedgerEntry, MemoryItem, Person, Quote } from './types';

export const PART_MS = 10 * 60_000;
export const MAX_CALL_TOKENS = 8_000;
export const REPLY_TOKENS = 1_500;
// With the prompt around it and the reply, a part of this size keeps a call under 8,000 tokens.
export const MAX_PART_TOKENS = 4_000;
const clip = (t: string) => (t.length > 120 ? `${t.slice(0, 119)}…` : t);
export const MAX_OPEN_PROMISES = 15;
export const MAX_NOT_PROMISES = 10;
export const LEDGER_WHAT = 'Transcript text for summary and memory';

const LATIN = /[\u0000-\u024f\u1e00-\u1eff\u2000-\u206f]/;

/** Counted generously: Latin text at 3 characters a token, any other character (CJK and so on) as a token of its own. */
export function estimateTokens(text: string): number {
  let narrow = 0;
  let wide = 0;
  for (const ch of text) if (LATIN.test(ch)) narrow++; else wide++;
  return wide + Math.ceil(narrow / 3);
}

export const EXTRACT_SYSTEM = [
  'You find promises, decisions and open questions in one part of a meeting transcript. Reply with ONLY a JSON object, no prose, shaped as:',
  '{"items": [{"kind": "promise"|"decision"|"question", "text": string, "quote": string, "speaker": string, "atMs": number, "owner"?: string, "to"?: string, "due"?: string}],',
  ' "done": [{"ref": number, "quote": string, "speaker": string, "atMs": number}]}',
  'A promise is someone committing to do something. A decision is something agreed. A question is an issue left open.',
  '"text" is short and plain, e.g. "Send the revised pricing deck". "quote" is the exact words from the transcript that prove it, copied verbatim.',
  '"speaker" is the name on the quoted line. "atMs" is the time of that line in milliseconds from the meeting start, from its [m:ss] stamp.',
  '"owner" is who owes a promise and "to" who it is owed to: "You" for the user, else a name. Leave them out when unclear.',
  '"due" is a deadline said aloud, as a date YYYY-MM-DD worked out from the meeting date. Leave it out when none was said.',
  '"done" lists earlier open promises (by ref) that this part says are finished, with the quote that says so. Use [] when none.',
  'Use empty arrays when there is nothing. Write in the language of the meeting.',
].join('\n');

export interface RawItem {
  kind: ItemKind; text: string; quote: string; speaker: string; atMs?: number;
  owner?: string; to?: string; due?: string;
}
export interface RawDone { ref: number; quote: string; speaker: string; atMs?: number }
export interface Extraction { items: RawItem[]; done: RawDone[] }

export interface Part { startMs: number; endMs: number; segments: Segment[] }

/** Splits a transcript into 10-minute parts, cutting a part early when its text would be too long for one call. */
export function splitParts(segments: Segment[], speakers?: Meeting['speakers'], partMs = PART_MS, maxTokens = MAX_PART_TOKENS): Part[] {
  const parts: Part[] = [];
  let cur: Part | undefined;
  let tokens = 0;
  for (const s of segments.filter((x) => x.text.trim() && !x.interim).sort((a, b) => a.startMs - b.startMs)) {
    const len = estimateTokens(`${transcriptLines([s], speakers)[0] ?? ''}\n`);
    const slot = Math.floor(s.startMs / partMs);
    if (!cur || Math.floor(cur.startMs / partMs) !== slot || tokens + len > maxTokens) {
      cur = { startMs: s.startMs, endMs: s.endMs, segments: [] };
      parts.push(cur);
      tokens = 0;
    }
    cur.segments.push(s);
    cur.endMs = Math.max(cur.endMs, s.endMs);
    tokens += len;
  }
  return parts;
}

export interface PromptInput {
  title: string; date: string; lines: string[];
  open: Pick<MemoryItem, 'text'>[];
  notPromises: Pick<MemoryItem, 'text' | 'quote'>[];
}

/** The user message for one part: meeting, earlier open promises, past "not a promise" dismissals, the part. */
export function buildExtractPrompt(p: PromptInput): string {
  const out = [`Meeting: ${p.title}`, `Meeting date: ${p.date}`];
  if (p.open.length) out.push('', 'Earlier open promises:', ...p.open.map((o, i) => `${i + 1}. ${clip(o.text)}`));
  if (p.notPromises.length) {
    out.push('', 'The user said these were not promises; do not return things like them:',
      ...p.notPromises.map((n) => `- ${clip(n.text)} ("${clip(n.quote.text)}")`));
  }
  out.push('', 'Transcript part:', ...p.lines);
  return out.join('\n');
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const KINDS: ItemKind[] = ['promise', 'decision', 'question'];

function toMs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string') {
    const m = v.trim().match(/^\[?(?:(\d+):)?(\d{1,2}):(\d{2})\]?$/);
    if (m) return (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
    if (/^\d+$/.test(v.trim())) return Number(v);
  }
  return undefined;
}

const isoDate = (v: unknown) => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined;
};

/** Parses a model reply; tolerates fences, prose, a bare array and bad entries. Never throws. */
export function parseExtraction(raw: string): Extraction {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data: unknown;
  // Try the shape that opens first, so an array of objects is not read as its first object.
  const shapes = ([['{', '}'], ['[', ']']] as const).slice().sort((x, y) => (text.indexOf(x[0]) + 1 || Infinity) - (text.indexOf(y[0]) + 1 || Infinity));
  for (const [open, close] of shapes) {
    const a = text.indexOf(open);
    const b = text.lastIndexOf(close);
    if (data === undefined && a >= 0 && b > a) { try { data = JSON.parse(text.slice(a, b + 1)); } catch { /* try the next shape */ } }
  }
  const o = (data && typeof data === 'object' && !Array.isArray(data) ? data : { items: data }) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
  const items = list(o.items).flatMap((x): RawItem[] => {
    const kind = str(x.kind)?.toLowerCase() as ItemKind | undefined;
    const t = str(x.text);
    const quote = str(x.quote);
    if (!kind || !KINDS.includes(kind) || !t || !quote) return [];
    return [{ kind, text: t, quote, speaker: str(x.speaker) ?? '', atMs: toMs(x.atMs), owner: str(x.owner), to: str(x.to), due: isoDate(x.due) }];
  });
  const done = list(o.done).flatMap((x): RawDone[] => {
    const ref = typeof x.ref === 'number' ? x.ref : Number(x.ref);
    const quote = str(x.quote);
    return Number.isInteger(ref) && ref > 0 && quote ? [{ ref, quote, speaker: str(x.speaker) ?? '', atMs: toMs(x.atMs) }] : [];
  });
  return { items, done };
}

/** Checks a quote near its time, or anywhere in the part when the model gave no time. */
export function checkQuote(text: string, atMs: number | undefined, part: Part): { found: boolean; atMs: number } {
  if (atMs !== undefined) return { found: quoteFound({ text, atMs }, part.segments), atMs };
  const found = quoteFound({ text, atMs: part.startMs }, part.segments, part.endMs - part.startMs + 90_000);
  return { found, atMs: part.startMs };
}

const NOT_PEOPLE = /^(you|me|i|others|someone|everyone|we|the team|speaker [a-z0-9]+)$/i;
export const isPersonName = (name?: string): name is string => !!name && !NOT_PEOPLE.test(name.trim());
const isMe = (name?: string) => !!name && /^(you|me|i)$/i.test(name.trim());

export interface PeoplePlan { people: Person[]; changed: Person[]; created: number; byName: Map<string, string> }

/** Links invite attendees first, then names heard in the meeting. Unmatched names become new people; "Is Sam Sam Ortiz?" comes from mergeSuggestions. */
export function resolvePeople(attendees: Seen[], names: string[], people: Person[], meetingId: string, now: number, newId: () => string): PeoplePlan {
  const all = [...people];
  const changed = new Map<string, Person>();
  const byName = new Map<string, string>();
  let created = 0;
  const key = (n: string) => n.trim().toLowerCase();
  const touch = (p: Person, name?: string) => {
    const aliases = name && key(name) !== key(p.name) && !p.aliases.some((a) => key(a) === key(name)) ? [...p.aliases, name] : p.aliases;
    if (p.meetingIds.includes(meetingId) && aliases === p.aliases) return p;
    const next = { ...p, aliases, meetingIds: [...new Set([...p.meetingIds, meetingId])], updatedAt: now };
    all[all.findIndex((x) => x.id === p.id)] = next;
    changed.set(next.id, next);
    return next;
  };
  const add = (seen: Seen): Person => {
    const name = seen.name?.trim() || seen.email!.split('@')[0]!;
    const p: Person = { id: newId(), name, aliases: [], meetingIds: [meetingId], createdAt: now, updatedAt: now, ...(seen.email ? { email: seen.email } : {}) };
    all.push(p);
    changed.set(p.id, p);
    created++;
    return p;
  };
  for (const a of attendees) {
    if (!a.email && !isPersonName(a.name)) continue;
    const hit = matchPerson(a, all).person;
    const p = hit ? touch(hit, a.name) : add(a);
    if (a.name) byName.set(key(a.name), p.id);
    byName.set(key(p.name), p.id);
  }
  for (const n of names) {
    if (!isPersonName(n) || byName.has(key(n))) continue;
    const hit = matchPerson({ name: n }, all).person;
    byName.set(key(n), (hit ? touch(hit, n) : add({ name: n })).id);
  }
  return { people: all, changed: [...changed.values()], created, byName };
}

/** Word overlap between two item texts, 0 to 1; stands in for vector similarity until recall vectors exist. */
export function similarity(a: string, b: string): number {
  const x = new Set(normalise(a));
  const y = new Set(normalise(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

export const LINK_MIN_SCORE = 0.4;
const SAME_SYSTEM = 'You compare two items from meetings. Reply with ONLY a JSON object {"relation": "same"|"replaces"|"different"}: "same" when the new item is the earlier one mentioned again, "replaces" when a new decision changes the earlier decision, else "different".';
export type Relation = 'same' | 'replaces' | 'different';

export function parseRelation(raw: string): Relation {
  const m = raw.match(/"relation"\s*:\s*"(same|replaces|different)"/i) ?? raw.match(/\b(same|replaces|different)\b/i);
  return (m?.[1]?.toLowerCase() as Relation | undefined) ?? 'different';
}

export interface ExtractResult { found: number; promises: number; decisions: number; questions: number; people: number; leftOut: number; looksDone: number }
export interface ExtractDeps { fetchFn?: FetchLike; now?: () => number; newId?: () => string }

const EMPTY: ExtractResult = { found: 0, promises: 0, decisions: 0, questions: 0, people: 0, leftOut: 0, looksDone: 0 };
// Ollama runs on the person's computer, so nothing leaves it and nothing is recorded.
const LEDGER_SERVICE: Partial<Record<string, LedgerEntry['service']>> = { groq: 'groq', openai: 'openai', openrouter: 'openrouter', anthropic: 'anthropic' };
// These failures happen before any text leaves the browser.
const NOT_SENT = new Set(['no-key', 'offline', 'local-unavailable', 'cancelled']);

export const extractedKey = (meetingId: string) => `rekord.extracted.${meetingId}`;
export const partsKey = (meetingId: string) => `rekord.extract.parts.${meetingId}`;
/** A part's parsed reply, with the open promises its "done" refs point at. */
interface SavedPart { extraction: Extraction; openIds: string[] }

async function readParts(meetingId: string): Promise<Record<string, SavedPart>> {
  return ((await browser.storage.local.get(partsKey(meetingId)))[partsKey(meetingId)] as Record<string, SavedPart> | undefined) ?? {};
}

/** How many parts of a meeting already have a reply kept, so a rate-limited meeting resumes where it stopped. */
export async function partsSaved(meetingId: string): Promise<number> {
  return Object.keys(await readParts(meetingId)).length;
}

export async function isExtracted(meetingId: string): Promise<boolean> {
  return !!(await browser.storage.local.get(extractedKey(meetingId)))[extractedKey(meetingId)];
}

const inFlight = new Map<string, Promise<ExtractResult>>();

/**
 * Finds memory items in a finished meeting and saves them as suggested. Saves nothing until every AI call
 * has answered; each part's reply is kept so a rate limit resumes from the first part without one.
 * A second call for the same meeting joins the first. Throws LLMError (rate limits included).
 */
export function extractMeeting(meetingId: string, deps: ExtractDeps = {}): Promise<ExtractResult> {
  let run = inFlight.get(meetingId);
  if (!run) {
    run = extractOnce(meetingId, deps).finally(() => inFlight.delete(meetingId));
    inFlight.set(meetingId, run);
  }
  return run;
}

async function extractOnce(meetingId: string, deps: ExtractDeps): Promise<ExtractResult> {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const [meeting, segments, settings] = await Promise.all([getMeeting(meetingId), listSegments(meetingId), getSettings()]);
  if (!meeting) return EMPTY;
  if ((await isExtracted(meetingId)) || (await itemsForMeeting(meetingId)).length) return EMPTY;
  const parts = splitParts(segments, meeting.speakers);
  if (!parts.length) return EMPTY;

  const [items, people, meetings] = await Promise.all([listItems(), listPeople(), listMeetings()]);
  const startedAt = new Map(meetings.map((m) => [m.id, m.startedAt]));
  // Only promises made before this meeting can be finished in it (backfill runs old meetings too).
  const open = items
    .filter((i) => i.kind === 'promise' && i.status === 'open' && i.meetingId !== meetingId && (startedAt.get(i.meetingId) ?? 0) < meeting.startedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_OPEN_PROMISES);
  const notPromises = items
    .filter((i) => i.status === 'dismissed' && i.dismissReason === 'notAPromise')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_NOT_PROMISES);
  const service = LEDGER_SERVICE[settings.summary.provider];
  // Recorded whether or not the call succeeds: a rate-limited or failed call may still have sent the text.
  const ask = async (system: string, user: string, maxTokens: number) => {
    let sent = true;
    try {
      return await chat([{ role: 'system', content: system }, { role: 'user', content: user }], { json: true, maxTokens }, deps.fetchFn);
    } catch (error) {
      sent = !(error instanceof LLMError && NOT_SENT.has(error.code));
      throw error;
    } finally {
      if (service && sent) await record({ meetingId, service, what: LEDGER_WHAT });
    }
  };

  const byId = new Map(items.map((i) => [i.id, i]));
  const saved = await readParts(meetingId);
  const found: { raw: RawItem; part: Part }[] = [];
  const done: { raw: RawDone; part: Part; target?: MemoryItem }[] = [];
  for (const [index, part] of parts.entries()) {
    let kept = saved[index];
    if (!kept) {
      const user = buildExtractPrompt({
        title: meeting.title, date: isoDay(meeting.startedAt), lines: transcriptLines(part.segments, meeting.speakers), open, notPromises,
      });
      kept = { extraction: parseExtraction(await ask(EXTRACT_SYSTEM, user, REPLY_TOKENS)), openIds: open.map((o) => o.id) };
      saved[index] = kept;
      await browser.storage.local.set({ [partsKey(meetingId)]: saved });
    }
    const { extraction, openIds } = kept;
    found.push(...extraction.items.map((raw) => ({ raw, part })));
    done.push(...extraction.done.map((raw) => ({ raw, part, target: byId.get(openIds[raw.ref - 1] ?? '') })));
  }

  const at = now();
  const attendees = (meeting.event?.attendees ?? []).filter((a) => !a.self).map((a) => ({ name: a.name, email: a.email }));
  const heard = Object.keys(meeting.speakers ?? {}).map((label) => displayName({ speaker: 'others', speakerLabel: label }, meeting.speakers));
  const named = found.flatMap(({ raw }) => [raw.owner, raw.to, raw.speaker]).filter(isPersonName);
  const plan = resolvePeople(attendees, [...heard, ...named], people, meetingId, at, newId);
  const idOf = (name?: string) => (isMe(name) ? 'me' : name ? plan.byName.get(name.trim().toLowerCase()) : undefined);

  const fresh: MemoryItem[] = found.map(({ raw, part }) => {
    const check = checkQuote(raw.quote, raw.atMs, part);
    const quote: Quote = { speaker: raw.speaker, text: raw.quote, meetingId, atMs: check.atMs };
    const ownerId = raw.kind === 'promise' ? idOf(raw.owner) : undefined;
    const toId = raw.kind === 'promise' ? idOf(raw.to) : undefined;
    const personIds = [...new Set([ownerId, toId, idOf(raw.speaker)].filter((id): id is string => !!id && id !== 'me'))];
    return {
      id: newId(), kind: raw.kind, status: 'suggested', text: raw.text, quote, meetingId, personIds, history: [],
      ...(ownerId ? { ownerId } : {}), ...(toId ? { toId } : {}), ...(raw.due ? { due: raw.due } : {}),
      ...(check.found ? {} : { leftOut: true }), createdAt: at, updatedAt: at,
    };
  });

  // Earlier items: a repeat adds to the earlier item's history; a changed decision is saved as replacing it.
  const earlier = items.filter((i) => i.meetingId !== meetingId && ['open', 'looksDone', 'suggested'].includes(i.status));
  const updated = new Map<string, MemoryItem>();
  const keep: MemoryItem[] = [];
  for (const item of fresh) {
    if (item.leftOut) { keep.push(item); continue; }
    const candidates: ItemCandidate[] = earlier.map((e) => ({ item: updated.get(e.id) ?? e, score: similarity(item.text, e.text) }));
    const relations = new Map<string, Relation>();
    const link = await linkItem(item, candidates, async (f, e) => {
      const r = parseRelation(await ask(SAME_SYSTEM, `Kind: ${f.kind}\nEarlier: ${e.text}\nNew: ${f.text}`, 50));
      relations.set(e.id, r);
      return r !== 'different';
    }, LINK_MIN_SCORE);
    if (!link) { keep.push(item); continue; }
    if (item.kind === 'decision' && relations.get(link.id) === 'replaces') { keep.push({ ...item, replacesId: link.id }); continue; }
    const repeat = [link.quote, ...link.history].some((q) => q.meetingId === item.quote.meetingId && q.text === item.quote.text);
    if (!repeat) updated.set(link.id, { ...link, history: [...link.history, item.quote], updatedAt: at });
  }

  // A later meeting can only say a promise looks done; the user closes it.
  let looksDone = 0;
  for (const { raw, part, target } of done) {
    if (!target || target.status !== 'open') continue;
    const check = checkQuote(raw.quote, raw.atMs, part);
    if (!check.found) continue;
    const current = updated.get(target.id) ?? target;
    const next = transition(current, { type: 'looksDone', evidence: { speaker: raw.speaker, text: raw.quote, meetingId, atMs: check.atMs } }, at);
    if (next !== current) { updated.set(target.id, next); looksDone++; }
  }

  // The marker goes first so no other path saves this meeting twice.
  if (await isExtracted(meetingId)) return EMPTY;
  await browser.storage.local.set({ [extractedKey(meetingId)]: at });
  for (const p of plan.changed) await putPerson(p);
  for (const i of [...keep, ...updated.values()]) await putItem(i);
  await browser.storage.local.remove(partsKey(meetingId));
  const kept = keep.filter((i) => !i.leftOut);
  const count = (k: ItemKind) => kept.filter((i) => i.kind === k).length;
  return {
    found: kept.length, promises: count('promise'), decisions: count('decision'), questions: count('question'),
    people: plan.created, leftOut: keep.length - kept.length, looksDone,
  };
}
