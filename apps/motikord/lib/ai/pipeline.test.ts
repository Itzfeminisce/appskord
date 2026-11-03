import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../llm';
import type { Asset, Recipe, Storyboard } from '../types';
import { SCENE_TEMPLATES } from '../templates/scenes';
import { validateRecipe } from '../recipe/validate';
import { applyPatch } from '../patch';
import { AiError } from './errors';
import { SCENE_EXAMPLES, pickExamples } from './examples';
import { allowedTemplates, beatMs, planStoryboard, readStoryboard, sceneCount, StoryboardFailed, type StoryboardInput } from './storyboard';
import { fillScene, readSlots } from './fillScene';
import { criticModel, criticScenes, criticSkip, readCriticNotes } from './critic';
import { regenerateScene, restyle, writeClip, type ClipInput } from './writeRecipe';

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
type Body = { messages: { content: string | { type: string; text?: string }[] }[] };
const text = (c: Body['messages'][number]['content']) => (typeof c === 'string' ? c : c.map((p) => p.text ?? '').join(''));

/** A fake Groq that answers by which call it is: storyboard, fill (by scene number) or critic. */
function fake(r: { storyboard?: (string | Response)[]; fill?: (i: number, last: string) => string | Response; critic?: () => string | Response }) {
  const sent: { kind: string; last: string }[] = [];
  const fetch: FetchLike = vi.fn(async (_u, init) => {
    const body = JSON.parse(String(init?.body)) as Body;
    const system = text(body.messages[0]!.content);
    const last = text(body.messages.at(-1)!.content);
    const kind = system.startsWith('You plan') ? 'storyboard' : system.startsWith('You write the words') ? 'fill' : 'critic';
    sent.push({ kind, last });
    if (kind === 'storyboard') { const n = r.storyboard?.shift(); return typeof n === 'string' ? ok(n) : (n ?? ok('{}')); }
    if (kind === 'fill') { const n = r.fill?.(Number(/Scene (\d+) of/.exec(last)?.[1]) - 1, last) ?? '{}'; return typeof n === 'string' ? ok(n) : n; }
    const n = r.critic?.() ?? '{"notes":[]}';
    return typeof n === 'string' ? ok(n) : n;
  });
  return { fetch, sent, opts: { ai: 'cloud' as const, provider: 'groq' as const, model: 'openai/gpt-oss-120b', key: 'gsk_test', fetch } };
}

const SB = (beats: { template: string; line: string }[]) => `Plan: a hook, then the build.\n${JSON.stringify({ name: 'Shoes', hook: 'Run more', beats })}`;
const FILLS: Record<string, unknown> = {
  kicker: 'This weekend', headline: 'Run for less', statement: 'Every runner is on sale', items: ['Every size', 'Free returns', 'Ends Sunday'],
  cta: 'Shop now', handle: 'stride.shop', title: 'Why now', number: '30%', label: 'off all shoes',
};
const fillAll = () => JSON.stringify({ slots: FILLS });
const sbInput: StoryboardInput = { prompt: 'Shoe sale', type: 'promo', aspect: '9:16', style: 'bold', pace: 'normal', media: 0, logo: false };
const input = (o: Partial<ClipInput> = {}): ClipInput => ({
  prompt: 'Spring shoe sale, 30% off', type: 'promo', aspect: '9:16', assets: [], id: 'c1', style: 'bold', pace: 'normal',
  critic: true, settings: { ai: 'cloud', provider: 'groq', models: {} }, ...o,
});
const FOUR = [{ template: 'title-hook', line: 'Run for less' }, { template: 'big-statement', line: 'Every runner on sale' }, { template: 'list', line: 'Why now' }, { template: 'end-card', line: 'Shop now' }];

describe('storyboard', () => {
  it('counts scenes from the type and pace, and times beats from the template and pace', () => {
    expect(sceneCount('promo', 'normal')).toBe(5);
    expect(sceneCount('promo', 'fast')).toBe(7);
    expect(sceneCount('quote', 'calm')).toBe(2);
    expect(beatMs('list', 'normal')).toBe(4000);
    expect(beatMs('title-hook', 'fast')).toBe(1750);
    expect(beatMs('title-hook', 'calm')).toBe(4500);
  });

  it('offers media and logo templates only when there is media or a logo', () => {
    expect(allowedTemplates({ media: 0, logo: false })).not.toEqual(expect.arrayContaining(['hero']));
    expect(allowedTemplates({ media: 1, logo: false })).toEqual(expect.arrayContaining(['hero', 'split']));
    expect(allowedTemplates({ media: 1, logo: false })).not.toContain('before-after');
    expect(allowedTemplates({ media: 2, logo: true })).toHaveLength(12);
  });

  it('reads beats from the closed list: an unknown or unusable template becomes the closest, lines cut to 10 words', () => {
    const sb = readStoryboard({ name: 'Shoes', beats: [{ template: 'hero', line: 'one two three four five six seven eight nine ten eleven' }, { template: 'spinning-cube', line: 'x' }] }, sbInput)!;
    expect(sb.beats.map((b) => b.template)).toEqual(['title-hook', 'big-statement']);
    expect(sb.beats[0]!.line.split(' ')).toHaveLength(10);
    expect(sb.style).toBe('bold');
    expect(readStoryboard({ beats: [] }, sbInput)).toBeUndefined();
  });

  it('plain words then JSON; bad JSON gets one repair try, then storyboard-failed', async () => {
    const g = fake({ storyboard: ['I think we should…', SB(FOUR)] });
    const r = await planStoryboard(sbInput, g.opts);
    expect(r.storyboard.beats).toHaveLength(4);
    expect(r.plan).toBe('Plan: a hook, then the build.');
    expect(g.sent[1]!.last).toContain('not valid JSON');
    const bad = fake({ storyboard: ['nope', 'still nope'] });
    await expect(planStoryboard(sbInput, bad.opts)).rejects.toBeInstanceOf(StoryboardFailed);
    expect(bad.sent).toHaveLength(2);
  });
});

describe('scene fill', () => {
  it('has a hand-made example for every template and picks 2 or 3, same template first', () => {
    for (const t of SCENE_TEMPLATES) expect(SCENE_EXAMPLES.some((e) => e.template === t.id)).toBe(true);
    const picked = pickExamples('promo', 'list', 'bold');
    expect(picked.length).toBeGreaterThanOrEqual(2);
    expect(picked.length).toBeLessThanOrEqual(3);
    expect(picked[0]).toMatchObject({ template: 'list', type: 'promo', style: 'bold' });
  });

  it('reads slots within the template: items and bars clamped, missing required slots named', () => {
    const list = SCENE_TEMPLATES.find((t) => t.id === 'list')!;
    expect(readSlots({ slots: { title: 'T', items: ['a', 'b', 'c', 'd', 'e', 'f'] } }, list).slots.items).toHaveLength(5);
    expect(readSlots({ slots: { title: 'T', items: ['a'] } }, list).problems).toHaveLength(1);
    const chart = SCENE_TEMPLATES.find((t) => t.id === 'chart')!;
    expect(readSlots({ slots: { title: 'T', bars: [{ label: 'A', value: '3' }, { label: 'B', value: 5 }] } }, chart).slots.bars).toEqual([{ label: 'A', value: 3 }, { label: 'B', value: 5 }]);
  });

  it('asks again once for a garbled scene (scene-retrying), then fails', async () => {
    const storyboard = readStoryboard(JSON.parse(SB(FOUR).split('\n')[1]!), sbInput)!;
    let n = 0;
    const g = fake({ fill: () => (n++ === 0 ? 'garbled' : fillAll()) });
    const onRetry = vi.fn();
    const r = await fillScene({ prompt: 'x', type: 'promo', style: 'bold', storyboard, index: 2 }, g.opts, { onRetry });
    expect(onRetry).toHaveBeenCalledWith(2);
    expect(r.slots.items).toEqual(FILLS.items);
    const bad = fake({ fill: () => '{"slots":{}}' });
    await expect(fillScene({ prompt: 'x', type: 'promo', style: 'bold', storyboard, index: 0 }, bad.opts)).rejects.toBeInstanceOf(AiError);
  });
});

describe('critic', () => {
  it('is skipped when off, on Chrome AI, or when the model cannot see images', () => {
    const groq = (model: string) => ({ ai: 'cloud' as const, provider: 'groq' as const, model });
    expect(criticSkip(false, groq('qwen/qwen3.8-27b'))).toBe('critic-off');
    expect(criticSkip(true, groq('openai/gpt-oss-120b'))).toBe('critic-not-available');
    expect(criticSkip(true, { ...groq('gpt-6.1-sol'), ai: 'local' })).toBe('critic-not-available');
    expect(criticSkip(true, groq('qwen/qwen3.8-27b'))).toBeUndefined();
  });

  it("asks the provider's vision model when the chat model can't see images, and keeps a chat model that can", async () => {
    const scout = 'qwen/qwen3.8-27b';
    const cloud = { ai: 'cloud' as const, provider: 'groq' as const, models: {} };
    expect(await criticModel({ ...cloud, models: { groq: 'openai/gpt-oss-120b' } })).toEqual({ ai: 'cloud', provider: 'groq', model: scout });
    expect(await criticModel({ ...cloud, provider: 'anthropic', models: { anthropic: 'claude-opus-5-5' } })).toMatchObject({ model: 'claude-opus-5-5' });
    expect(await criticModel({ ...cloud, provider: 'openai', models: { openai: 'gpt-3.5-turbo' } })).toMatchObject({ model: 'gpt-3.5-turbo' });
    const listed: FetchLike = async () => new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b', active: true }] }), { status: 200 });
    expect(await criticModel(cloud, { key: 'gsk_test', fetch: listed })).toMatchObject({ model: scout });
  });

  it('writes with the chosen blind model and sends only the frames to the vision model', async () => {
    const g = fake({ storyboard: [SB(FOUR)], fill: fillAll });
    await writeClip(input(), g.opts, { frames: async (_r, t) => t.map(() => 'data:image/jpeg;base64,AAAA') });
    const bodies = vi.mocked(g.fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { model: string; messages: { content: unknown }[] });
    const critic = bodies.filter((b) => JSON.stringify(b.messages[0]!.content).includes('checking small frames'));
    expect(critic.map((b) => b.model)).toEqual(['qwen/qwen3.8-27b']);
    expect(new Set(bodies.filter((b) => !critic.includes(b)).map((b) => b.model))).toEqual(new Set(['openai/gpt-oss-120b']));
  });

  it('looks at 2 to 4 scenes and keeps notes only for scenes it saw', () => {
    const r = (n: number) => ({ scenes: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, durationMs: 3000, slots: { a: 'x '.repeat(i % 3 + 1) } })) }) as unknown as Recipe;
    expect(criticScenes(r(3))).toEqual([0, 1, 2]);
    const six = criticScenes(r(6));
    expect(six).toHaveLength(4);
    expect(six[0]).toBe(0);
    expect(six.at(-1)).toBe(5);
    expect(readCriticNotes({ notes: [{ scene: 1, problem: 'p', fix: 'f' }, { scene: 1, problem: 'q', fix: 'g' }, { scene: 9, problem: 'p', fix: 'f' }] }, [0, 1])).toEqual([{ sceneIndex: 0, problem: 'p', fix: 'f' }]);
  });
});

describe('the v2 pipeline', () => {
  const vision = { model: 'qwen/qwen3.8-27b' };
  const frames = async (_r: Recipe, t: number[]) => t.map(() => 'data:image/jpeg;base64,AAAA');

  it('makes a version 2 recipe, every scene templated, and reports each step', async () => {
    const g = fake({ storyboard: [SB(FOUR)], fill: fillAll });
    const steps: string[] = [];
    const filled: number[] = [];
    const out = await writeClip(input(), g.opts, { frames, onStep: (s) => steps.push(s), onFilled: (n) => filled.push(n) });
    expect(validateRecipe(out.recipe)).toEqual([]);
    expect(out.recipe).toMatchObject({ version: 2, style: 'bold', pace: 'normal' });
    expect(out.recipe.scenes.map((s) => s.template)).toEqual(['title-hook', 'big-statement', 'list', 'end-card']);
    expect(out.recipe.scenes[1]!.transition).toBeDefined();
    expect(steps).toEqual(['plan', 'fill', 'check', 'critic']);
    expect(filled).toEqual([1, 2, 3, 4]);
    expect(out.criticSkipped).toBeUndefined();
  });

  it('runs the critic on a vision model and remakes the scenes it flags, once', async () => {
    const g = fake({
      storyboard: [SB(FOUR)],
      fill: (_i, last) => (last.includes('Change:') ? JSON.stringify({ slots: { ...FILLS, statement: 'All runners on sale' } }) : fillAll()),
      critic: () => JSON.stringify({ notes: [{ scene: 2, problem: 'Too long', fix: 'Shorter statement' }] }),
    });
    const seen = vi.fn();
    const out = await writeClip(input(), { ...g.opts, ...vision }, { frames, onCritic: seen });
    expect(seen).toHaveBeenCalledWith({ scenes: [0, 1, 2, 3], frames: 4 });
    expect(out.critic).toMatchObject({ frames: 4, notes: [{ sceneIndex: 1 }] });
    expect(out.recipe.scenes[1]!.slots!.statement).toBe('All runners on sale');
    expect(g.sent.filter((s) => s.kind === 'critic')).toHaveLength(1);
  });

  it('hands back each making-time fix as an undoable step, in the order of its "Fixed for you" line', async () => {
    const g = fake({
      storyboard: [SB(FOUR)],
      fill: (_i, last) => (last.includes('Change:') ? JSON.stringify({ slots: { ...FILLS, statement: 'All runners on sale' } }) : fillAll()),
      critic: () => JSON.stringify({ notes: [{ scene: 2, problem: 'Too long', fix: 'Shorter statement' }] }),
    });
    const brand = { colours: [{ hex: '#FFFFFF', role: 'text' as const }, { hex: '#FAFAFA', role: 'background' as const }, { hex: '#FFFFFF', role: 'primary' as const }], useForNewClips: true };
    const out = await writeClip(input({ brand, pace: 'fast' }), { ...g.opts, ...vision }, { frames });
    const lines = out.checks.map((c) => c.summary);
    expect(lines.filter((x, i) => lines.indexOf(x) === i)).toEqual(out.fixes);
    expect(out.fixes).toContain('Scene 2 statement recoloured to stand out');
    // Undoing every step newest first, then redoing them oldest first, lands on the clip as made.
    const start = out.checks.reduceRight((r, c) => applyPatch(r, c.inverse).doc, out.recipe);
    expect(out.checks.reduce((r, c) => applyPatch(r, c.patch).doc, start)).toEqual(out.recipe);
  });

  it('a critic that cannot be reached leaves the clip ready without it', async () => {
    const g = fake({ storyboard: [SB(FOUR)], fill: fillAll, critic: () => new Response('{}', { status: 503 }) });
    const out = await writeClip(input(), { ...g.opts, ...vision }, { frames });
    expect(out.criticSkipped).toBe('critic-unreachable');
    expect(out.recipe.scenes).toHaveLength(4);
  });

  it('pauses on the plan and goes on with the edited storyboard, keeping scenes already filled', async () => {
    const g = fake({ storyboard: [SB(FOUR)], fill: fillAll });
    let edited: Storyboard | undefined;
    let calls = 0;
    // Paused after scene 1 was filled: the edit drops two scenes; scene 1 is not filled again.
    const gate = async (sb: Storyboard) => {
      if (++calls < 2 || edited) return sb;
      edited = { ...sb, beats: [sb.beats[0]!, sb.beats[3]!] };
      return edited;
    };
    const out = await writeClip(input(), g.opts, { gate });
    expect(out.recipe.scenes.map((s) => s.template)).toEqual(['title-hook', 'end-card']);
    expect(g.sent.filter((s) => s.kind === 'fill')).toHaveLength(2);
  });

  it('puts attached photos into media slots', async () => {
    const photo: Asset = { id: 'p1', kind: 'image', name: 'a.jpg', mime: 'image/jpeg', bytes: 1, opfsPath: 'media/p1.jpg' };
    const g = fake({ storyboard: [SB([{ template: 'hero', line: 'Built for trails' }, ...FOUR.slice(1)])], fill: fillAll });
    const out = await writeClip(input({ assets: [photo] }), g.opts);
    expect(out.recipe.scenes[0]!.slots!.media).toEqual({ assetId: 'p1' });
    expect(validateRecipe(out.recipe)).toEqual([]);
  });
});

describe('remake and restyle', () => {
  const made = async () => {
    const g = fake({ storyboard: [SB(FOUR)], fill: fillAll });
    return (await writeClip(input(), g.opts)).recipe;
  };

  it('regenerateScene remakes one scene from a request and leaves the rest', async () => {
    const recipe = await made();
    const g = fake({ fill: (_i, last) => (last.includes('Change: Make it louder') ? JSON.stringify({ slots: { statement: 'Every runner, slashed' } }) : '{}') });
    const next = await regenerateScene(recipe, 1, 'Make it louder', g.opts);
    expect(next.scenes[1]!.slots!.statement).toBe('Every runner, slashed');
    expect(next.scenes[0]).toEqual(recipe.scenes[0]);
    await expect(regenerateScene({ ...recipe, scenes: [{ ...recipe.scenes[0]!, template: undefined }] }, 0, undefined, g.opts)).rejects.toBeInstanceOf(AiError);
  });

  it('restyle keeps the words, swaps the look and rescales lengths by pace, with no AI call', async () => {
    const recipe = await made();
    const next = restyle(recipe, 'playful', 'fast');
    expect(next).toMatchObject({ version: 2, style: 'playful', pace: 'fast' });
    expect(next.scenes.map((s) => s.slots)).toEqual(recipe.scenes.map((s) => s.slots));
    expect(next.scenes[0]!.durationMs).toBe(Math.round((recipe.scenes[0]!.durationMs * 1750) / 3000 / 50) * 50);
    expect(next.scenes[0]!.layers[0]).not.toEqual(recipe.scenes[0]!.layers[0]);
    expect(validateRecipe(next)).toEqual([]);
    expect(() => restyle(recipe, 'neon' as never, 'fast')).toThrow();
  });
});
