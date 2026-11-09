// "Quality check": three passes, Story, Same look throughout, Look and motion. Free checks first, then one AI call
// per pass on the compact recipe. One automatic fix per scene, then Motikord asks.
import { IMAGE_TOKENS } from '@appskord/llm';
import type { ClipV3 } from '@appskord/motion/types';
import { criticSkip, type CriticModel } from '../../ai/critic';
import { toAiError, type AiStateId } from '../../ai/errors';
import { CALL_BUDGET, parseJsonReply, type AiOptions } from '../../ai/writeRecipe';
import { chat, type ChatMessage } from '../../llm';
import { stateCopy, type StateCopy } from '../../pipeline/v3/states';
import { strictTokens, withTimeout } from '../../pipeline/v3/tokens';
import { note, PASS_KINDS, PASSES, runChecks, type CheckInput, type NoteKind, type PassId, type QualityNote } from './checks';
import { applyFix, type Fixed } from './fixes';
import { summary, type Detail } from './summary';

export const CRITIC_V3_TOKENS = 600;
/** "Groq looked at 8 small frames per pass", when that many fit the call. */
export const MAX_PASS_FRAMES = 8;

export const QUALITY = {
  title: 'Quality check',
  toLookAt: (n: number) => `${n} things to look at`,
  fixedCount: (n: number) => `${n} fixed for you`,
  looked: (provider: string, n: number) => `${provider} looked at ${n} small frames per pass`,
  ran: 'Ran',
  passToLookAt: (n: number) => `${n} to look at`,
  fixedTitle: 'Fixed for you',
  undo: 'Undo',
  oneFix: 'One automatic fix per scene, then Motikord asks you.',
  fixAll: (n: number) => `Fix all ${n}`,
  again: 'Check again',
} as const;

const ASK: Readonly<Record<PassId, string>> = {
  story: 'Story: does each scene move the message on? kinds: "repeat" (a scene repeats an earlier point; give "other"), "words" (too wordy to read in time).',
  look: 'Same look throughout: does every scene keep the look guide? kinds: "colour" (a colour outside the palette), "camera" (a camera busier than the rest).',
  motion: 'Look and motion: kinds: "flat" (no depth), "plastic" (glow too strong), "generic" (could be any brand), "stiff" (lines land together).',
};

export function passSystem(pass: PassId): string {
  return [
    'You check one pass of a short motion graphics clip, read from its recipe.',
    ASK[pass],
    'Only report real problems, at most one per scene. Reply with JSON only: {"notes":[{"scene":n,"kind":k,"other"?:n}]}, scenes from 1.',
  ].join('\n');
}

/** Renders the clip at each time to a small JPEG data URL. */
export type ClipFrames = (clip: ClipV3, timesMs: number[]) => Promise<string[]>;

export interface QualityOptions extends AiOptions {
  /** The model for the look passes, from criticModel(); the Story pass uses the chat model. */
  critic: CriticModel;
  render?: ClipFrames;
  /** Automatic fixes already used, by scene id; "Check again" passes the last result's. */
  fixesUsed?: Readonly<Record<string, number>>;
}
export interface PassResult {
  id: PassId;
  name: string;
  ran: boolean;
  /** Why the AI part didn't run: critic-not-available, or a provider failure's state. */
  state?: 'critic-not-available' | AiStateId;
  notes: QualityNote[];
  frames: number;
  /** The call's estimated size: prompt plus the reply allowance. */
  tokens: number;
}
export interface Question {
  sceneIndex: number;
  copy: StateCopy;
}
export interface QualityResult {
  recipe: CheckInput['recipe'];
  clip: ClipV3;
  passes: PassResult[];
  toLookAt: QualityNote[];
  fixed: Fixed[];
  questions: Question[];
  fixesUsed: Record<string, number>;
}

/** The scenes' key-frame times, evenly picked up to `n`. */
export function frameTimes(clip: ClipV3, n: number): number[] {
  const starts: number[] = [];
  clip.scenes.reduce((t, s) => (starts.push(t), t + s.ms), 0);
  const count = Math.min(n, clip.scenes.length);
  const picks = [...new Set(Array.from({ length: count }, (_, k) => Math.round((k * (clip.scenes.length - 1)) / Math.max(1, count - 1))))];
  return picks.map((i) => starts[i]! + Math.round(clip.scenes[i]!.ms * 0.6));
}

/** The compact recipe, as detailed as fits with `images` frames under the call budget. */
export function passMessages(pass: PassId, x: CheckInput, images: string[] = []): ChatMessage[] {
  const build = (d: Detail): ChatMessage[] => [
    { role: 'system', content: passSystem(pass) },
    { role: 'user', content: summary(x.recipe, x.clip, x.look, d), ...(images.length ? { images } : {}) },
  ];
  for (const d of ['full', 'short'] as const) {
    const m = build(d);
    if (strictTokens(m) + CRITIC_V3_TOKENS <= CALL_BUDGET) return m;
  }
  return build('bare');
}

function readNotes(raw: unknown, pass: PassId, scenes: number): QualityNote[] {
  const list = typeof raw === 'object' && raw !== null && Array.isArray((raw as { notes?: unknown }).notes) ? (raw as { notes: unknown[] }).notes : [];
  const out: QualityNote[] = [];
  for (const n of list) {
    if (typeof n !== 'object' || n === null) continue;
    const o = n as Record<string, unknown>;
    const i = Number(o.scene) - 1;
    const kind = o.kind as NoteKind;
    if (!Number.isInteger(i) || i < 0 || i >= scenes || !PASS_KINDS[pass].includes(kind)) continue;
    const other = Number(o.other) - 1;
    if (kind === 'repeat' && !(other >= 0 && other < i)) continue;
    if (out.some((x) => x.sceneIndex === i)) continue;
    out.push(note(kind, i, 'ai', kind === 'repeat' ? { other } : {}));
  }
  return out;
}

async function runPass(pass: PassId, x: CheckInput, o: QualityOptions): Promise<PassResult> {
  const name = PASSES.find((p) => p.id === pass)!.name;
  const checks = runChecks(pass, x);
  const visual = pass !== 'story';
  const result = (r: Partial<PassResult>): PassResult => ({ id: pass, name, ran: false, notes: checks, frames: 0, tokens: 0, ...r });
  if (visual && criticSkip(true, o.critic)) return result({ state: 'critic-not-available' });
  const text = passMessages(pass, x);
  // Even the bare recipe is too big: the free checks stand and the AI part is skipped.
  if (strictTokens(text) + CRITIC_V3_TOKENS > CALL_BUDGET) return result({});
  const room = Math.floor((CALL_BUDGET - CRITIC_V3_TOKENS - strictTokens(text)) / IMAGE_TOKENS);
  const n = visual && o.render ? Math.max(0, Math.min(MAX_PASS_FRAMES, room)) : 0;
  const images = n ? (await o.render!(x.clip, frameTimes(x.clip, n))).slice(0, n) : [];
  const messages = images.length ? passMessages(pass, x, images) : text;
  const tokens = strictTokens(messages) + CRITIC_V3_TOKENS;
  const model = visual ? o.critic.model : o.model;
  const signal = withTimeout(o.signal);
  try {
    const reply = await chat(messages, { ...o, signal, model, json: true, maxTokens: CRITIC_V3_TOKENS, temperature: 0.2 });
    const ai = readNotes(parseJsonReply(reply.text), pass, x.clip.scenes.length);
    const notes = [...checks, ...ai.filter((a) => !checks.some((c) => c.sceneIndex === a.sceneIndex && c.kind === a.kind))];
    return result({ ran: true, notes, frames: images.length, tokens });
  } catch (e) {
    // The 30 s limit, not the caller's cancel: the provider is busy.
    if (signal.aborted && !o.signal?.aborted) return result({ state: 'provider-busy', frames: images.length, tokens });
    const err = toAiError(e, 'make');
    if (err.code === 'cancelled') throw err;
    // A garbled reply means no AI notes; the free checks still stand.
    if (err.code === 'bad-reply') return result({ ran: true, frames: images.length, tokens });
    console.error('Motikord: could not run quality check', err);
    return result({ state: err.state, frames: images.length, tokens });
  }
}

/** Runs the three passes, then gives each scene its one automatic fix; scenes past it become questions. */
export async function qualityCheck(x: CheckInput, o: QualityOptions): Promise<QualityResult> {
  const passes: PassResult[] = [];
  for (const p of PASSES) passes.push(await runPass(p.id, x, o));
  const used: Record<string, number> = { ...o.fixesUsed };
  let state = { recipe: x.recipe, clip: x.clip };
  const fixed: Fixed[] = [];
  const toLookAt: QualityNote[] = [];
  const questions: Question[] = [];
  const all = passes.flatMap((p) => p.notes);
  for (let i = 0; i < x.clip.scenes.length; i++) {
    const notes = all.filter((n) => n.sceneIndex === i);
    if (!notes.length) continue;
    const id = x.clip.scenes[i]!.id;
    if ((used[id] ?? 0) >= 1) {
      toLookAt.push(...notes);
      questions.push({ sceneIndex: i, copy: stateCopy('critic-fix-limit', { scene: i + 1 }) });
      continue;
    }
    let done: QualityNote | undefined;
    for (const n of notes) {
      const f = applyFix(n, { ...x, ...state });
      if (!f) continue;
      fixed.push({ sceneIndex: i, kind: n.kind, line: f.line, before: state });
      state = { recipe: f.recipe, clip: f.clip };
      used[id] = (used[id] ?? 0) + 1;
      done = n;
      break;
    }
    toLookAt.push(...notes.filter((n) => n !== done));
  }
  return { ...state, passes, toLookAt, fixed, questions, fixesUsed: used };
}
