import type { Chapter } from '../types';
import type { Unit } from '../wordCuts';
import { currentCut } from '../project/history';
import { isKept } from '../project/time';
import type { Project } from '../project/types';
import { cardSlots } from '../render/layers/card';

/** PLAN "Performance budget": every AI call, prompt and reply together, stays under this. */
export const MAX_CALL_TOKENS = 8_000;
/** A request longer than this is cut, so it can't crowd out the transcript. */
export const MAX_REQUEST = 1_000;
/** The longest reply we ask for. */
export const REPLY_TOKENS = 1_200;

/** A safe over-estimate of tokens: about two characters each, since "1234:word" lines tokenize densely. */
export const tokens = (text: string): number => Math.ceil(text.length / 2);

/** The repair pass names at most this many problems, each value cut to `ECHO_CHARS`. */
export const MAX_PROBLEMS = 5;
export const ECHO_CHARS = 40;
/** The most a repair message can cost: its frame plus `MAX_PROBLEMS` problems. */
export const REPAIR_TOKENS = 400;

/**
 * Room for the transcript in one call. `header` is the user message without the words; a repair pass resends the
 * reply and the problems and gets a second reply, so both replies and the repair message are kept back.
 */
export function transcriptBudget(system: string, header: string): number {
  return MAX_CALL_TOKENS - tokens(system) - tokens(header) - 2 * REPLY_TOKENS - REPAIR_TOKENS - 100;
}

/** One sentence: unit indexes `from`..`to`, inclusive. */
export interface Sentence { from: number; to: number; line: string }
/** Words `from`..`to` sent in one call, with the chapters they cover. */
export interface Chunk { from: number; to: number; text: string }

const ENDS = /[.!?…]["”']?$/;
/** A sentence with no end mark is split here, so one line never outgrows a call. */
const LONGEST_LINE = 600;

/** Numbered words grouped by sentence; a word already cut from this cut is marked with `~`. Never times. */
export function sentences(project: Project, units: Unit[]): Sentence[] {
  const cut = currentCut(project);
  const out: Sentence[] = [];
  let from = 0;
  let parts: string[] = [];
  units.forEach((u, i) => {
    const text = project.wordFixes[i] ?? u.text;
    parts.push(`${isKept(cut, (u.start + u.end) / 2) ? '' : '~'}${i}:${text.trim()}`);
    const next = units[i + 1];
    if (!next || next.line !== u.line || ENDS.test(text.trim()) || parts.join(' ').length >= LONGEST_LINE) {
      out.push({ from, to: i, line: parts.join(' ') });
      from = i + 1;
      parts = [];
    }
  });
  return out;
}

/** The chapter each sentence starts in, by index into `chapters`; -1 before the first. */
function chapterOf(chapters: Chapter[], units: Unit[], s: Sentence): number {
  const at = units[s.from]!.start;
  let k = -1;
  chapters.forEach((c, i) => { if (c.at <= at + 1) k = i; });
  return k;
}

/**
 * Splits the transcript into calls under `budget` tokens: whole chapters packed together, and a chapter too long
 * for one call split between sentences.
 */
export function chunkTranscript(project: Project, units: Unit[], budget: number): Chunk[] {
  const chapters = [...project.chapters].sort((a, b) => a.at - b.at);
  const chunks: Chunk[] = [];
  let lines: string[] = [];
  let from = 0;
  let to = -1;
  let size = 0;
  const flush = () => {
    if (lines.length) chunks.push({ from, to, text: lines.join('\n') });
    lines = [];
    size = 0;
  };
  // Sentences grouped by chapter, each group with its heading first.
  const groups: { heading: string; list: Sentence[] }[] = [];
  for (const s of sentences(project, units)) {
    const k = chapterOf(chapters, units, s);
    const heading = k < 0 ? '# Start' : `# Chapter: ${chapters[k]!.title}`;
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.list.push(s);
    else groups.push({ heading, list: [s] });
  }
  for (const g of groups) {
    const whole = tokens([g.heading, ...g.list.map((s) => s.line)].join('\n'));
    if (size > 0 && size + whole > budget) flush();
    for (const [i, s] of g.list.entries()) {
      const line = i === 0 ? `${g.heading}\n${s.line}` : s.line;
      const cost = tokens(line) + 1;
      if (size > 0 && size + cost > budget) flush();
      if (!lines.length) from = s.from;
      // A heading repeats when its chapter runs on into the next call.
      lines.push(size === 0 && i > 0 ? `${g.heading} (continued)\n${s.line}` : line);
      to = s.to;
      size += cost;
    }
  }
  flush();
  return chunks;
}

/** The current cut in a few lines, with no times: name, shape and what it already has. */
export function cutSummary(project: Project): string {
  const cut = currentCut(project);
  return [
    `Cut "${cut.name}", shape ${cut.shape}, ${cut.clips.filter((c) => !c.gap).length} clips.`,
    `It has ${cut.zooms.length} zooms, ${cut.cards.length} cards, ${cut.layouts.length} layout switches; captions ${cut.captions.show ? cut.captions.style : 'off'}.`,
  ].join('\n');
}

/** The system prompt for Ask AI: the closed list of operations, in JSON. */
export function editSystem(templates: readonly string[]): string {
  return [
    'You edit a screen recording by its transcript. Words are numbered "index:word"; "~" marks a word already cut.',
    'Lines starting with "#" are chapters. Reply with one JSON object and nothing else:',
    '{"ops":[...], "cant":"..."}',
    'Each op has a short "label" for the person, in plain words, e.g. "Cut 11 filler words". Ops, by word index (never times):',
    '{"op":"cut","from":i,"to":j} removes words i..j. {"op":"keep","from":i,"to":j} brings back cut words.',
    '{"op":"move","from":i,"to":j,"after":k} moves words i..j to play after word k.',
    '{"op":"speed","from":i,"to":j,"rate":0.5-4} changes speed. {"op":"zoom","from":i,"to":j,"depth":1.25-2} zooms on the cursor.',
    '{"op":"caption","style":"clean"|"bold"|"word"} turns captions on.',
    templates.length ? `{"op":"card","template":${templates.map((t) => JSON.stringify(t)).join('|')},"at":i,"slots":{"<slot>":"..."}} adds a card at word i. Slots: ${templates.map((t) => `${t}: ${cardSlots(t).map((d) => `${d.id} (${d.words} words)`).join(', ')}`).join('; ')}.` : '',
    '{"op":"chapter","at":i,"title":"..."} adds a chapter at word i, or renames the chapter that starts there.',
    '{"op":"layout","at":i,"layout":"bubble"|"side"|"camera"|"screen"} switches the camera layout at word i.',
    '{"op":"newCut","name":"...","shape":"16:9"|"9:16"|"1:1"|"4:5","keep":[{"from":i,"to":j}]} makes a new cut of only those words, for highlights.',
    'Only use word indexes you were given. Cut ranges must not overlap. Leave "cant" out unless the request needs something',
    'these ops cannot do: then reply {"ops":[], "cant":"<what, as a verb phrase, e.g. add sound effects>"}.',
  ].filter(Boolean).join('\n');
}

/** The user message for one call: the request, the chapters, the cut and this chunk's words. */
export function editUser(request: string, project: Project, chunk: Chunk, part: { index: number; count: number }): string {
  const chapters = project.chapters.map((c) => `- ${c.title}`).join('\n') || '- none';
  return [
    `Request: ${request.slice(0, MAX_REQUEST)}`,
    `Chapters:\n${chapters}`,
    cutSummary(project),
    part.count > 1 ? `Part ${part.index + 1} of ${part.count}: words ${chunk.from} to ${chunk.to}. Only edit these words; reply {"ops":[]} when this part needs nothing.` : '',
    chunk.text,
  ].filter(Boolean).join('\n\n');
}

/** A value echoed in a problem, cut to `ECHO_CHARS`. */
export function echo(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > ECHO_CHARS ? `${text.slice(0, ECHO_CHARS - 1)}…` : text;
}

/** The follow-up after a reply that failed validation: the first `MAX_PROBLEMS` problems, once. */
export function repairUser(problems: string[]): string {
  const shown = problems.slice(0, MAX_PROBLEMS).map((p) => `- ${p.slice(0, 120)}`);
  const more = problems.length > MAX_PROBLEMS ? `\n- and ${problems.length - MAX_PROBLEMS} more like these` : '';
  return `That reply had problems:\n${shown.join('\n')}${more}\nReply again with the corrected JSON object only.`;
}
