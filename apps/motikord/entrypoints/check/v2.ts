import prompts from '@/test/quality/prompts.json';
import { writeClip } from '@/lib/ai/writeRecipe';
import type { FetchLike } from '@/lib/llm';
import { MediaCache } from '@/lib/render/cache';
import { drawFrame } from '@/lib/render/drawFrame';
import { renderFrames } from '@/lib/render/frames';
import { STYLE_PACKS } from '@/lib/templates/scenes';
import type { Numbers } from '@/lib/check/results';
import { frameStats, round } from '@/lib/check/stats';
import type { Asset, Aspect, Background, ClipType, Pace, Recipe, StyleId, TransitionKind } from '@/lib/types';

export const BUDGET = { fps: 30, frameMs: 300, pipelineS: 15 } as const;
export const BG_KINDS: Background['kind'][] = ['solid', 'gradient', 'blobs', 'blocks', 'grain'];
export const TRANSITIONS: TransitionKind[] = ['crossfade', 'slide', 'push', 'wipe', 'zoom', 'match'];

export interface V2Row { id: string; name: string; budget: string; value: number | null; unit: string; pass: boolean; numbers: Numbers }

interface Recorded {
  id: string; type: ClipType; aspect: Aspect; style: StyleId; pace: Pace; prompt: string; model?: string; assets?: Asset[];
  replies: { storyboard: string; fills: string[]; critic?: string; fixes?: Record<string, string> };
}
const SET = prompts as Recorded[];
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
type Part = string | { text?: string };
const textOf = (c: string | Part[]) => (typeof c === 'string' ? c : c.map((p) => (typeof p === 'string' ? p : (p.text ?? ''))).join(''));

/** A fake chat that replays the recorded replies by call kind, with no network. */
function replay(r: Recorded): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: string | Part[] }[] };
    const system = textOf(body.messages[0]!.content);
    const last = textOf(body.messages.at(-1)!.content);
    if (system.startsWith('You plan')) return ok(r.replies.storyboard);
    if (system.includes('checking small frames')) return ok(r.replies.critic ?? '{"notes":[]}');
    if (system.startsWith('You write the words')) {
      const i = Number(/Scene (\d+) of/.exec(last)?.[1]) - 1;
      const fix = last.includes('Change:') ? r.replies.fixes?.[String(i)] : undefined;
      return ok(fix ?? r.replies.fills[i] ?? '{}');
    }
    return ok('{}');
  };
}

async function make(r: Recorded): Promise<Recipe> {
  const model = r.model ?? 'openai/gpt-oss-120b';
  const out = await writeClip(
    { prompt: r.prompt, type: r.type, aspect: r.aspect, assets: r.assets ?? [], id: r.id, style: r.style, pace: r.pace, critic: true, settings: { ai: 'cloud', provider: 'groq', models: { groq: model } } },
    { ai: 'cloud', provider: 'groq', model, key: 'gsk_test', fetch: replay(r) },
    { frames: (recipe, times) => renderFrames(recipe, times) },
  );
  return out.recipe;
}

const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : 0; };

let base: Promise<Recipe> | undefined;
/** The 16:9 recorded prompt with the most scenes, made by the real pipeline: templated scenes in a real pack. */
function baseRecipe(): Promise<Recipe> {
  base ??= Promise.all(SET.filter((r) => r.aspect === '16:9').map(make)).then((rs) => rs.sort((a, b) => b.scenes.length - a.scenes.length)[0]!);
  return base;
}

function backgroundOf(kind: Background['kind']): Background {
  const pack = STYLE_PACKS.find((p) => p.background.kind === kind);
  if (pack) return { ...pack.background, drift: true };
  const p = STYLE_PACKS[0]!.palette;
  return { kind, colours: kind === 'solid' ? [p.bg] : [p.bg, p.bg2], drift: true };
}

/** Plays `timeAt(elapsed)` on a 1080p canvas for `seconds` and returns frame timing. */
function play(canvas: HTMLCanvasElement, recipe: Recipe, seconds: number, timeAt: (ms: number) => number): Promise<Record<string, number>> {
  const ctx = canvas.getContext('2d')!;
  const cache = new MediaCache();
  const intervals: number[] = [];
  const drawMs: number[] = [];
  const flushedMs: number[] = [];
  return new Promise((done) => {
    let start = 0;
    let last = 0;
    const tick = (now: number) => {
      if (!start) start = last = now;
      else intervals.push(now - last);
      last = now;
      const d = performance.now();
      drawFrame(ctx, recipe, '16:9', timeAt(now - start), cache);
      // Canvas draws are deferred; a 1 px read on every 10th frame forces the raster so its cost shows.
      if (intervals.length % 10 === 9) { ctx.getImageData(0, 0, 1, 1); flushedMs.push(performance.now() - d); }
      else drawMs.push(performance.now() - d);
      if (now - start < seconds * 1000) requestAnimationFrame(tick);
      else {
        const s = frameStats(intervals);
        done({ meanFps: round(s.meanFps), p95FrameMs: round(s.p95Ms), dropped: s.dropped, medianDrawMs: round(median(drawMs), 2), medianFlushedDrawMs: round(median(flushedMs), 2) });
      }
    };
    requestAnimationFrame(tick);
  });
}

const fpsRow = (id: string, name: string, n: Record<string, number>): V2Row =>
  ({ id, name, budget: `${BUDGET.fps} fps`, value: n.meanFps!, unit: 'fps', pass: n.meanFps! >= BUDGET.fps * 0.95, numbers: n });

export async function previewBackground(canvas: HTMLCanvasElement, kind: Background['kind'], seconds: number): Promise<V2Row> {
  const r = await baseRecipe();
  const bg = backgroundOf(kind);
  const recipe: Recipe = { ...r, scenes: r.scenes.map((s) => ({ ...s, bg, transition: undefined })) };
  const total = recipe.scenes.reduce((n, s) => n + s.durationMs, 0);
  return fpsRow(`bg-${kind}`, `1080p preview, ${kind} background`, await play(canvas, recipe, seconds, (ms) => ms % total));
}

export async function previewTransition(canvas: HTMLCanvasElement, kind: TransitionKind, seconds: number): Promise<V2Row> {
  const r = await baseRecipe();
  const ms = 600;
  const recipe: Recipe = { ...r, scenes: r.scenes.map((s, i) => ({ ...s, transition: i ? { kind, ms } : undefined })) };
  // Every frame is mid-transition: time cycles through each scene's first `ms`.
  const starts: number[] = [];
  recipe.scenes.reduce((at, s, i) => { if (i) starts.push(at); return at + s.durationMs; }, 0);
  const timeAt = (t: number) => { const k = Math.floor(t / ms) % starts.length; return starts[k]! + (t % ms); };
  return fpsRow(`tr-${kind}`, `1080p preview, ${kind} transition`, await play(canvas, recipe, seconds, timeAt));
}

export async function jpegFrame(): Promise<V2Row> {
  const r = await baseRecipe();
  const cache = new MediaCache();
  const times = r.scenes.map((_, i) => r.scenes.slice(0, i).reduce((n, s) => n + s.durationMs, 0) + r.scenes[i]!.durationMs / 2);
  const ms: number[] = [];
  await renderFrames(r, [times[0]!], { cache });   // warm up
  for (let k = 0; k < 20; k++) {
    const t = performance.now();
    await renderFrames(r, [times[k % times.length]!], { cache });
    ms.push(performance.now() - t);
  }
  const m = median(ms);
  return { id: 'jpeg', name: 'One 512 px JPEG frame, offscreen', budget: `< ${BUDGET.frameMs} ms`, value: round(m, 1), unit: 'ms', pass: m < BUDGET.frameMs, numbers: { runs: ms.length, medianMs: round(m, 1), maxMs: round(Math.max(...ms), 1) } };
}

export async function pipeline(): Promise<V2Row> {
  const s: number[] = [];
  for (const r of SET) {
    const t = performance.now();
    await make(r);
    s.push((performance.now() - t) / 1000);
  }
  const worst = Math.max(...s);
  return {
    id: 'pipeline', name: 'Storyboard + scenes + checker (recorded replies, no network)', budget: `< ${BUDGET.pipelineS} s plus network`, value: round(worst, 2), unit: 's (slowest)', pass: worst < BUDGET.pipelineS,
    numbers: { prompts: s.length, medianS: round(median(s), 3), maxS: round(worst, 3), note: 'Groq network time is not included' },
  };
}
