// Follow-up questions after a telling: the gaps in the extraction draft, the prompt, and the reply parser. Pure.
import type { RawItem } from '../memory/extract';
import type { CatchupQuestion } from './types';

export const MAX_QUESTIONS = 3;
export const QUESTIONS_REPLY_TOKENS = 400;
/** Gaps sent per call, so the prompt stays far under the 8,000-token budget. */
const MAX_GAPS = 12;
const MAX_TEXT = 160;

export type DraftItem = Pick<RawItem, 'kind' | 'text' | 'owner' | 'to' | 'due'>;
export interface Gap { about: CatchupQuestion['about']; line: string }

const UNNAMED = /^(?:someone|somebody|they|them|he|she|him|her|others|the team|their team|a guy|a person|someone from .+|their .+|the .+ (?:guy|person|lead|team))$/i;
const isMe = (name?: string) => !!name && /^(?:you|me|i)$/i.test(name.trim());
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Promises with no owner or due date, open questions with no outcome, people named only vaguely, attendees with nothing on them. */
export function findGaps(items: readonly DraftItem[], attendees: readonly string[] = []): Gap[] {
  const gaps: Gap[] = [];
  for (const i of items) {
    const text = clip(i.text);
    if (i.kind === 'promise') {
      if (!i.owner?.trim()) gaps.push({ about: 'owner', line: `Promise with no owner: "${text}"` });
      else if (UNNAMED.test(i.owner.trim())) gaps.push({ about: 'name', line: `Promise owed by someone not named ("${i.owner.trim()}"): "${text}"` });
      if (!i.due) gaps.push({ about: 'due', line: `Promise with no due date${i.owner && !isMe(i.owner) ? ` (owner ${i.owner.trim()})` : ''}: "${text}"` });
      if (i.to && UNNAMED.test(i.to.trim())) gaps.push({ about: 'name', line: `Promise owed to someone not named ("${i.to.trim()}"): "${text}"` });
    } else if (i.kind === 'question') {
      gaps.push({ about: 'outcome', line: `Open question with no outcome: "${text}"` });
    } else if (i.kind === 'decision' && /\b(?:maybe|might|probably|possibly|tbd|or)\b/i.test(i.text)) {
      gaps.push({ about: 'outcome', line: `Decision with no clear outcome: "${text}"` });
    }
  }
  const named = items.flatMap((i) => [i.owner, i.to, i.text]).filter(Boolean).join(' ').toLowerCase();
  for (const a of attendees) {
    if (a.trim() && !named.includes(firstName(a).toLowerCase())) gaps.push({ about: 'owner', line: `${a.trim()} was there but nothing is on them` });
  }
  return gaps.slice(0, MAX_GAPS);
}

export const QUESTIONS_SYSTEM = [
  'The user retold a meeting from memory. You write short follow-up questions that fill gaps in what they said.',
  `Reply with ONLY a JSON object, no prose: {"questions": [{"text": string, "about": "owner"|"due"|"outcome"|"name"}]}, at most ${MAX_QUESTIONS} questions, most useful first.`,
  'Ask one thing per question, in plain words, naming the person or item, e.g. "Tom is setting up admin access for the pilot. By when?".',
  'Only ask about the gaps listed. Use {"questions": []} when none is worth asking.',
].join('\n');

/** The user message for the one questions call; undefined when there is nothing to ask about. */
export function buildQuestionsPrompt(p: { title: string; date: string; items: readonly DraftItem[]; attendees?: readonly string[] }): string | undefined {
  const gaps = findGaps(p.items, p.attendees);
  if (!gaps.length) return undefined;
  return [`Meeting: ${p.title}`, `Meeting date: ${p.date}`, '', 'Gaps:', ...gaps.map((g, n) => `${n + 1}. [${g.about}] ${g.line}`)].join('\n');
}

const ABOUT = new Set<CatchupQuestion['about']>(['owner', 'due', 'outcome', 'name']);

/** Parses the reply into at most 3 questions; bad JSON or a bad shape gives none. Never throws. */
export function parseQuestions(raw: string): CatchupQuestion[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return [];
  let data: unknown;
  try { data = JSON.parse(text.slice(a, b + 1)); } catch { return []; }
  const list = (data as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return [];
  const out: CatchupQuestion[] = [];
  for (const q of list) {
    if (!q || typeof q !== 'object') continue;
    const { text: t, about } = q as Record<string, unknown>;
    if (typeof t !== 'string' || !t.trim() || typeof about !== 'string' || !ABOUT.has(about as CatchupQuestion['about'])) continue;
    if (out.some((o) => o.text === t.trim())) continue;
    out.push({ id: `q${out.length + 1}`, text: t.trim(), about: about as CatchupQuestion['about'] });
    if (out.length === MAX_QUESTIONS) break;
  }
  return out;
}
