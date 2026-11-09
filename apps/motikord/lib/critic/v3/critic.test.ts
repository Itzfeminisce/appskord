import { describe, expect, it, vi } from 'vitest';
import { estimateTokens } from '@appskord/llm';
import { validateClip } from '@appskord/motion/recipe';
import type { ClipV3 } from '@appskord/motion/types';
import type { CriticModel } from '../../ai/critic';
import { CALL_BUDGET } from '../../ai/writeRecipe';
import { criticModelFor } from '../../providers';
import { approveAll, drawKeyFrames } from '../../pipeline/v3/keyFrames';
import { addMotion } from '../../pipeline/v3/motion';
import { fakeGroq, LOOK, PACK, testRecipe } from '../../pipeline/v3/testClip';
import type { Recipe } from '../../types';
import { strictTokens } from '../../pipeline/v3/tokens';
import { isFlat, note, runChecks, stiffLines } from './checks';
import { applyFix } from './fixes';
import { passMessages, QUALITY, qualityCheck } from './quality';

function made(recipe: Recipe = testRecipe()) {
  const r = addMotion({ recipe, board: approveAll(drawKeyFrames(recipe, LOOK, PACK)), look: LOOK, pack: PACK });
  if (!r.ok) throw new Error(r.state);
  return { recipe, clip: r.clip, look: LOOK };
}

/** Scene 1 lines land together, scene 3 is flat, scene 4 glows too hard. */
function flawed() {
  const x = made();
  const clip = structuredClone(x.clip);
  const s1 = clip.scenes[0]!;
  const text = s1.layers.filter((l) => l.kind === 'text');
  for (const l of text) {
    delete l.type;
    l.start = 100;
  }
  const s3 = clip.scenes[2]!;
  s3.camera = { move: 'hold', amount: 0 };
  s3.layers = s3.layers.map((l) => {
    const { z: _z, ...rest } = l;
    const tracks = Object.fromEntries(Object.entries(rest.tracks).filter(([p]) => !['z', 'blur', 'rotateY', 'extrude'].includes(p)));
    return { ...rest, depth: 'front', tracks };
  });
  clip.scenes[3]!.effects = [{ effect: 'bloom', amount: 0.9, scope: 'scene', sceneId: clip.scenes[3]!.id }];
  return { ...x, clip, stiff: text.map((l) => l.id) };
}

const vision = (): CriticModel => ({ ai: 'cloud', provider: 'groq', model: criticModelFor('groq', 'openai/gpt-oss-120b') });
const frames = vi.fn(async (_c: ClipV3, times: number[]) => times.map(() => 'data:image/jpeg;base64,AAAA'));

describe('quality check: free checks', () => {
  it('finds stiff lines, flat scenes, plastic glow, colours outside the guide, busy cameras, repeats and long words', () => {
    const x = flawed();
    expect(stiffLines(x.clip.scenes[0]!).length).toBeGreaterThan(1);
    expect(isFlat(x.clip.scenes[2]!)).toBe(true);
    const motion = runChecks('motion', x);
    expect(motion.map((n) => [n.sceneIndex, n.tag, n.problem, n.action])).toEqual([
      [0, 'Stiff timing', 'Scene 1 lines land together', 'Overlap the lines'],
      [2, 'Flat', 'Scene 3 looks flat', 'Add depth'],
      [3, 'Plastic', 'Scene 4 glow looks plastic', 'Soften the glow'],
    ]);
    expect(runChecks('look', x)).toEqual([]);
    const recipe = structuredClone(x.recipe);
    const t = recipe.scenes[2]!.layers.find((l) => l.type === 'text')!;
    if (t.type === 'text') t.colour = '#FF00FF';
    const clip = structuredClone(x.clip);
    clip.scenes[4]!.camera = { move: 'orbit', amount: 0.5 };
    expect(runChecks('look', { ...x, recipe, clip }).map((n) => n.problem)).toEqual([
      'Scene 3 uses a colour outside your look guide',
      'Scene 5 camera is busier than the rest',
    ]);
    expect(runChecks('look', { ...x, recipe, brandColours: ['#ff00ff'] }).map((n) => n.kind)).toEqual([]);
    recipe.scenes[3]!.slots = { ...recipe.scenes[0]!.slots };
    recipe.scenes[4]!.slots = { cta: 'Try Fieldnote free and find every note you ever took', handle: 'fieldnote.app' };
    expect(runChecks('story', { ...x, recipe }).map((n) => [n.problem, n.action])).toEqual([
      ['Scene 4 repeats scene 1’s point', 'Merge scenes'],
      [expect.stringMatching(/^Scene 5 .* is over \d+ words$/), 'Show me'],
    ]);
  });
});

describe('quality check: three passes', () => {
  it('runs Story, Same look throughout and Look and motion with recorded replies, each call under 8,000 tokens', async () => {
    const x = flawed();
    const g = fakeGroq({
      story: '{"notes":[{"scene":4,"kind":"repeat","other":2},{"scene":9,"kind":"repeat","other":1}]}',
      look: '{"notes":[{"scene":5,"kind":"camera"},{"scene":1,"kind":"flat"}]}',
      motion: '{"notes":[{"scene":1,"kind":"stiff"},{"scene":2,"kind":"generic"}]}',
    });
    const r = await qualityCheck(x, { ...g.opts, critic: vision(), render: frames });
    expect(g.sent.map((s) => s.kind)).toEqual(['story', 'look', 'motion']);
    expect(g.sent.map((s) => s.body.model)).toEqual(['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'qwen/qwen3.8-27b']);
    expect(r.passes.map((p) => [p.name, p.ran, p.frames])).toEqual([
      ['Story', true, 0],
      ['Same look throughout', true, expect.any(Number)],
      ['Look and motion', true, expect.any(Number)],
    ]);
    expect(r.passes[1]!.frames).toBeGreaterThan(0);
    expect(r.passes[1]!.frames).toBeLessThanOrEqual(8);
    for (const s of g.sent) expect(estimateTokens(s.body.messages as never) + s.body.max_tokens).toBeLessThanOrEqual(CALL_BUDGET);
    for (const p of r.passes) expect(p.tokens).toBeLessThanOrEqual(CALL_BUDGET);
    // AI notes use the frame's copy; unknown scenes, wrong-pass kinds and duplicates of a free check are dropped.
    const notes = r.passes.flatMap((p) => p.notes.map((n) => `${n.by}:${n.problem}`));
    expect(notes).toEqual(
      expect.arrayContaining(['ai:Scene 4 repeats scene 2’s point', 'ai:Scene 5 camera is busier than the rest', 'ai:Scene 2 could be any brand']),
    );
    expect(notes.filter((n) => n.includes('Scene 1 lines land together'))).toEqual(['check:Scene 1 lines land together']);
    expect(notes.some((n) => n.includes('Scene 9') || n.includes('Scene 1 looks flat'))).toBe(false);
  });

  it('gives each scene one automatic fix, then asks', async () => {
    const x = flawed();
    const g = fakeGroq({ motion: '{"notes":[{"scene":1,"kind":"generic"}]}' });
    const r = await qualityCheck(x, { ...g.opts, critic: vision() });
    expect(r.fixed.map((f) => [f.sceneIndex, f.line])).toEqual([
      [0, expect.stringMatching(/^Scene 1 \S+ now overlaps by 40 ms$/)],
      [2, 'Scene 3 looks flat'],
      [3, 'Scene 4 glow looks plastic'],
    ]);
    expect(r.fixed[0]!.before.clip).toBe(x.clip);
    expect(r.toLookAt.map((n) => n.problem)).toEqual(['Scene 1 could be any brand']);
    expect(r.questions).toEqual([]);
    expect(validateClip(r.clip).ok).toBe(true);
    expect(stiffLines(r.clip.scenes[0]!)).toEqual([]);
    const [a, b] = x.stiff.map((id) => r.clip.scenes[0]!.layers.find((l) => l.id === id)!);
    expect(b!.start! - a!.start!).toBeGreaterThan(0);
    expect(isFlat(r.clip.scenes[2]!)).toBe(false);
    expect(r.clip.scenes[3]!.effects![0]!.amount).toBe(0.4);
    expect(r.fixesUsed).toEqual({ sc1: 1, sc3: 1, sc4: 1 });
    expect(QUALITY.toLookAt(r.toLookAt.length)).toBe('1 things to look at');

    // Check again with scene 1 flawed again: its fix is used, so Motikord asks.
    const again = structuredClone(r.clip);
    for (const l of again.scenes[0]!.layers) if (l.kind === 'text') l.start = 100;
    const r2 = await qualityCheck({ ...x, recipe: r.recipe, clip: again }, { ...g.opts, critic: vision(), fixesUsed: r.fixesUsed });
    expect(r2.fixed).toEqual([]);
    expect(r2.questions).toEqual([
      {
        sceneIndex: 0,
        copy: {
          id: 'critic-fix-limit',
          title: 'Scene 1 still needs your eye',
          line: 'Motikord used its one automatic fix here. The scene stays as it is until you choose.',
          action: 'Show me',
        },
      },
    ]);
    expect(r2.clip).toBe(again);
  });

  it('fixes a colour outside the guide with the nearest guide colour', async () => {
    const x = made();
    const recipe = structuredClone(x.recipe);
    const t = recipe.scenes[0]!.layers.find((l) => l.type === 'text')!;
    if (t.type === 'text') t.colour = '#FE01FE';
    const r = await qualityCheck({ ...x, recipe }, { ...fakeGroq({}).opts, critic: vision() });
    const after = r.recipe.scenes[0]!.layers.find((l) => l.id === t.id)!;
    expect(after.type === 'text' && LOOK.palette.includes(after.colour)).toBe(true);
    expect(r.fixed.map((f) => f.line)).toEqual(['Scene 1 uses a colour outside your look guide']);
    expect(x.recipe.scenes[0]).toEqual(testRecipe().scenes[0]);
  });

  it('critic-not-available: a model that can’t see images still runs the Story pass', async () => {
    const x = flawed();
    const g = fakeGroq({});
    const blind: CriticModel = { ai: 'cloud', provider: 'openrouter', model: 'openai/gpt-oss-120b' };
    const r = await qualityCheck(x, { ...g.opts, provider: 'openrouter', key: 'sk-test', critic: blind, render: frames });
    expect(g.sent.map((s) => s.kind)).toEqual(['story']);
    expect(r.passes.map((p) => [p.ran, p.state])).toEqual([
      [true, undefined],
      [false, 'critic-not-available'],
      [false, 'critic-not-available'],
    ]);
    // The free checks still found the motion problems.
    expect(r.passes[2]!.notes.length).toBe(3);
  });

  it('a provider failure keeps the free checks and names the state', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const x = flawed();
    const g = fakeGroq({ motion: () => new Response('{"error":{"message":"slow down"}}', { status: 429 }) });
    const r = await qualityCheck(x, { ...g.opts, critic: vision() });
    expect(r.passes[2]).toMatchObject({ ran: false, state: 'provider-busy' });
    expect(r.passes[2]!.notes.length).toBe(3);
    spy.mockRestore();
  });

  it('keeps a twelve-scene wordy clip under 8,000 tokens per call, frames included', async () => {
    const base = testRecipe();
    const recipe: Recipe = { ...base, scenes: Array.from({ length: 12 }, (_, i) => ({ ...structuredClone(base.scenes[i % 5]!), id: `s${i}` })) };
    for (const s of recipe.scenes) for (const l of s.layers) if (l.type === 'text') l.text = `${l.text} ${'with many extra words to read '.repeat(6)}`;
    const x = made(recipe);
    for (const pass of ['story', 'look', 'motion'] as const) {
      expect(estimateTokens(passMessages(pass, x)) + 600).toBeLessThanOrEqual(CALL_BUDGET);
    }
    const g = fakeGroq({});
    const r = await qualityCheck(x, { ...g.opts, critic: vision(), render: frames });
    for (const s of g.sent) expect(estimateTokens(s.body.messages as never) + s.body.max_tokens).toBeLessThanOrEqual(CALL_BUDGET);
    expect(r.passes.map((p) => p.tokens).every((t) => t <= CALL_BUDGET)).toBe(true);
  });
});

describe('quality check: hard caps, validated fixes, timeout', () => {
  const many = (n: number) => {
    const x = made();
    const recipe = structuredClone(x.recipe);
    const clip = structuredClone(x.clip);
    recipe.scenes = Array.from({ length: n }, (_, i) => ({ ...structuredClone(x.recipe.scenes[i % 5]!), id: `m${i}` }));
    clip.scenes = Array.from({ length: n }, (_, i) => ({ ...structuredClone(x.clip.scenes[i % 5]!), id: `m${i}` }));
    return { ...x, recipe, clip };
  };

  it('keeps a 40k-character slot and a 40-scene clip under the budget, and skips the AI when even bare is too big', async () => {
    const x = made();
    const recipe = structuredClone(x.recipe);
    const slots = recipe.scenes[0]!.slots as Record<string, string>;
    slots[Object.keys(slots)[0]!] = 'x'.repeat(40000);
    for (const pass of ['story', 'look', 'motion'] as const) {
      const m = passMessages(pass, { ...x, recipe });
      expect(m[1]!.content).not.toContain('x'.repeat(200));
      expect(strictTokens(m) + 600).toBeLessThanOrEqual(CALL_BUDGET);
      expect(strictTokens(passMessages(pass, many(40))) + 600).toBeLessThanOrEqual(CALL_BUDGET);
    }
    const g = fakeGroq({});
    const r = await qualityCheck(many(400), { ...g.opts, critic: vision() });
    expect(g.sent).toEqual([]);
    expect(r.passes.map((p) => [p.ran, p.state])).toEqual([[false, undefined], [false, undefined], [false, undefined]]);
  });

  it('discards a fix that breaks the scene, and one that changes nothing', async () => {
    const x = flawed();
    const bad = structuredClone(x.clip);
    bad.scenes[3]!.layers[0]!.tracks.y = [{ t: 500, v: 0 }, { t: 100, v: 1 }];
    expect(applyFix(note('plastic', 3, 'check'), { ...x, clip: bad })).toBeUndefined();
    const g = fakeGroq({});
    const r = await qualityCheck({ ...x, clip: bad }, { ...g.opts, critic: vision() });
    expect(r.fixed.some((f) => f.sceneIndex === 3)).toBe(false);
    expect(r.fixesUsed.sc4).toBeUndefined();
    const soft = structuredClone(x.clip);
    soft.scenes[3]!.effects![0]!.amount = 0.2;
    expect(applyFix(note('plastic', 3, 'ai'), { ...x, clip: soft })).toBeUndefined();
  });

  it('stiff: gives each line its own start, or asks when it cannot', () => {
    const x = flawed();
    const f = applyFix(note('stiff', 0, 'check'), x)!;
    const starts = x.stiff.map((id) => f.clip.scenes[0]!.layers.find((l) => l.id === id)!.start);
    expect(new Set(starts).size).toBe(2);
    const crowded = structuredClone(x.clip);
    const first = crowded.scenes[0]!.layers.find((l) => l.id === x.stiff[0])!;
    crowded.scenes[0]!.layers.push({ ...structuredClone(first), id: 'third', start: starts[1] });
    crowded.scenes[0]!.layers.push({ ...structuredClone(first), id: 'fourth', start: starts[1] });
    expect(applyFix(note('stiff', 0, 'check'), { ...x, clip: crowded })).toBeUndefined();
  });

  it('a call that never answers stops at 30 s and shows the busy state', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException('timed out', 'TimeoutError')), ms);
      return c.signal;
    });
    try {
      const fetch = vi.fn(
        (_u: unknown, init?: RequestInit) =>
          new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))),
      );
      const p = qualityCheck(made(), { ai: 'cloud', provider: 'groq', model: 'openai/gpt-oss-120b', key: 'gsk_test', fetch: fetch as never, critic: vision() });
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(30_000);
      const r = await p;
      expect(timeout).toHaveBeenCalledWith(30_000);
      expect(r.passes.map((q) => q.state)).toEqual(['provider-busy', 'provider-busy', 'provider-busy']);
    } finally {
      timeout.mockRestore();
      spy.mockRestore();
      vi.useRealTimers();
    }
  });
});
