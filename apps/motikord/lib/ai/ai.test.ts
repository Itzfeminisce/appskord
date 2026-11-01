import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../llm';
import type { Asset, Recipe } from '../types';
import { validateRecipe } from '../recipe/validate';
import { PRESET_IDS } from '../render/presets';
import { LAYOUTS } from '../render/reflow';
import { applyPatch } from '../patch';
import { detectType, guessType } from './detectType';
import { compactRecipe, editRecipe } from './editRecipe';
import { AiError } from './errors';
import { check } from '../checker';
import { CLIP_TYPES } from '../recipe/validate';
import { EXAMPLE_DRAFTS } from './examples';
import { editSystem, planSystem, recipeSystem } from './prompts';
import { addMissingMotion, CALL_BUDGET, designNotes, draftToRecipe, estimateTokens, fitToMax, normaliseColour, parseJsonReply, writeRecipe, type WriteInput } from './writeRecipe';

// The model is chosen once per session; a cached id keeps these tests to their own requests.
beforeEach(() => fakeBrowser.storage.session.set({ groqModel: 'openai/gpt-oss-120b' }));

const KEY = 'gsk_test';
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
type Body = { messages: { role: string; content: string }[]; max_tokens: number };
const isPlan = (b: Body) => b.messages[0]!.content.startsWith('You plan');
const PLAN = JSON.stringify({ name: 'Spring run', hook: 'Lighter feet', scenes: [
  { ms: 3000, headline: 'Run lighter this spring', support: '', visual: 'pink circle', layout: 'center', bg: '#111114', accent: '#F472B6', motion: 'pop-in bouncy, pulse, fade-out' },
  { ms: 3000, headline: 'Thirty percent off', support: 'This weekend only', visual: 'card', layout: 'top', bg: '#F472B6', accent: '#111114', motion: 'slide-in, slide-out' },
] });
/** A fake Groq: plan requests get `plan`; recipe requests get each content in turn. Records recipe bodies and plan bodies. */
function groq(...contents: string[]) {
  return groqWith(PLAN, ...contents);
}
function groqWith(plan: string, ...contents: string[]) {
  const bodies: Body[] = [];
  const plans: Body[] = [];
  const fetch: FetchLike = vi.fn(async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    if (isPlan(body)) { plans.push(body); return reply(plan); }
    bodies.push(body);
    const next = contents.shift();
    if (next === undefined) throw new Error('no more replies');
    return reply(next);
  });
  return { fetch, bodies, plans, opts: { ai: 'cloud' as const, key: KEY, fetch } };
}

const photo: Asset = { id: 'own-1', kind: 'image', name: 'Shoes', mime: 'image/jpeg', bytes: 10, width: 800, height: 600, opfsPath: 'media/own-1.jpg' };
const title = (extra: Record<string, unknown> = {}) => ({
  id: 't1', name: 'Title', type: 'text', role: 'title', text: 'Spring sale', font: 'Geist', sizePx: 96, weight: 700, colour: '#FFFFFF',
  align: 'center', lineHeight: 1.1, startMs: 0, endMs: 4000, box: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, opacity: 1,
  in: { preset: 'rise-in', feel: 'smooth', durationMs: 600 }, ...extra,
});
// Three more short scenes after the one under test, so a promo draft is not sent back as too thin.
const more = ['Run lighter', 'Thirty percent off', 'Shop this weekend'].map((t, i) => ({
  id: `s${i + 2}`, durationMs: 3000, background: '#111114', layout: 'top', layers: [title({ id: `f${i + 2}`, text: t, endMs: 3000 })],
}));
const draft = (scene: Record<string, unknown> = {}, layers: unknown[] = [title()]) =>
  JSON.stringify({ name: 'Spring sale', scenes: [{ id: 's1', durationMs: 4000, background: '#111114', layout: 'center', layers, ...scene }, ...more] });
const oneScene = (layers: unknown[] = [title()]) =>
  JSON.stringify({ name: 'Spring sale', scenes: [{ id: 's1', durationMs: 4000, background: '#111114', layout: 'center', layers }] });
const input: WriteInput = { prompt: 'A spring shoe sale', type: 'promo', aspect: '9:16', assets: [photo], id: 'clip-1' };

describe('prompts', () => {
  it('list every preset id and layout and nothing invented', () => {
    const text = recipeSystem(input) + editSystem();
    for (const id of PRESET_IDS) expect(text).toContain(id);
    for (const l of LAYOUTS) expect(text).toContain(l);
    expect(recipeSystem(input)).toContain('"own-1"');
    expect(recipeSystem({ ...input, assets: [] })).toContain('use no image or video layers');
  });

  it('keep every call within the free-tier budget for every type, with brand and media', () => {
    const brand = { colours: ['#BE185D', '#111114', '#FFFFFF'], headingFont: 'Inter', bodyFont: 'Inter' };
    for (const type of CLIP_TYPES) {
      const i = { ...input, type, brand, prompt: 'x'.repeat(400) };
      const plan = [{ role: 'system' as const, content: planSystem(i) }, { role: 'user' as const, content: i.prompt }];
      const recipe = [{ role: 'system' as const, content: recipeSystem(i) }, { role: 'user' as const, content: `Idea: ${i.prompt}\nDesign plan: ${PLAN.repeat(2)}` }];
      expect(estimateTokens(plan) + 900).toBeLessThanOrEqual(CALL_BUDGET);
      expect(estimateTokens(recipe) + 4000).toBeLessThanOrEqual(CALL_BUDGET);
    }
  });

  it('ask for a fresh plan, not the prompt split up', () => {
    const text = planSystem(input);
    expect(text).toContain('Never copy the idea');
    expect(text).toContain('4 to 7 scenes');
    expect(planSystem({ ...input, type: 'quote' })).toContain('1 to 3 scenes');
    expect(recipeSystem(input)).toContain('Example reply');
  });

  it('ship examples that are valid, clean and well designed', () => {
    for (const [name, ex] of Object.entries(EXAMPLE_DRAFTS)) {
      const type = name === 'SHORT' ? 'quote' : 'promo';
      const r = draftToRecipe(ex, { ...input, type, assets: [] }, 'ex') as Recipe;
      expect(validateRecipe(r)).toEqual([]);
      expect(check(r).map((i) => i.id)).toEqual([]);
      expect(designNotes(r, input.prompt)).toEqual([]);
      for (const s of r.scenes) for (const l of s.layers) if (l.type === 'text') expect(l.in && l.out).toBeTruthy();
    }
  });
});

describe('detectType', () => {
  it('asks the model and returns its type', async () => {
    const g = groq('{"type":"Quote"}');
    expect(await detectType('Steve Jobs: stay hungry', { ...g.opts, settings: {} })).toEqual({ type: 'quote', by: 'groq' });
    expect(g.bodies[0]!.messages[1]!.content).toBe('Steve Jobs: stay hungry');
  });

  it('skips the call when Settings has a default type', async () => {
    const g = groq();
    expect(await detectType('anything', { ...g.opts, settings: { defaultType: 'chart' } })).toEqual({ type: 'chart', by: 'settings' });
    expect(g.fetch).not.toHaveBeenCalled();
  });

  it('falls back to a local guess on an unknown answer', async () => {
    const g = groq('{"type":"meme"}');
    expect(await detectType('Revenue grew 40% this year', { ...g.opts, settings: {} })).toEqual({ type: 'chart', by: 'guess' });
    expect(guessType('How to brew coffee in 3 steps')).toBe('explainer');
  });

  it('falls back to a local guess when the call fails, but stays cancelled on cancel', async () => {
    const busy: FetchLike = async () => new Response('{}', { status: 429 });
    expect(await detectType('Revenue grew 40%', { ai: 'cloud', key: KEY, fetch: busy, settings: {} })).toEqual({ type: 'chart', by: 'guess' });
    const ac = new AbortController(); ac.abort();
    const aborted: FetchLike = async () => { throw new DOMException('x', 'AbortError'); };
    await expect(detectType('x', { ai: 'cloud', key: KEY, fetch: aborted, signal: ac.signal, settings: {} })).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('writeRecipe', () => {
  it('turns a draft into a valid recipe with our id, type, size and assets', async () => {
    const g = groq('```json\n' + draft() + '\n```');
    const out = await writeRecipe(input, g.opts);
    expect(validateRecipe(out.recipe)).toEqual([]);
    expect(out.recipe).toMatchObject({ version: 1, id: 'clip-1', type: 'promo', aspect: '9:16', prompt: 'A spring shoe sale' });
    expect(out.recipe.assets['own-1']).toEqual(photo);
    expect(out).toMatchObject({ by: 'groq', notices: [], checkerClean: true, issues: [] });
    expect(g.bodies).toHaveLength(1);
  });

  it('plans first, then writes the recipe from the plan', async () => {
    const g = groq(draft());
    await writeRecipe(input, g.opts);
    expect(g.plans).toHaveLength(1);
    expect(g.plans[0]!.max_tokens).toBe(900);
    expect(g.plans[0]!.messages[1]!.content).toBe('A spring shoe sale');
    const user = g.bodies[0]!.messages[1]!.content;
    expect(user).toContain('Idea: A spring shoe sale');
    expect(user).toContain('Run lighter this spring');
  });

  it('writes the recipe without a plan when the plan is not usable', async () => {
    const g = groqWith('no plan here', draft());
    const out = await writeRecipe(input, g.opts);
    expect(validateRecipe(out.recipe)).toEqual([]);
    expect(g.bodies[0]!.messages[1]!.content).toBe('Idea: A spring shoe sale');
  });

  it('sends a flat reply back once with a critique, and keeps the better one', async () => {
    const prompt = 'A big spring shoe sale today';
    const flat = oneScene([title({ text: prompt, sizePx: 72, box: { x: 0.1, y: 0.4, w: 0.8, h: 0.24 } })]);
    const g = groq(flat, draft());
    const out = await writeRecipe({ ...input, prompt }, g.opts);
    expect(g.bodies).toHaveLength(2);
    const critique = g.bodies[1]!.messages.at(-1)!.content;
    expect(critique).toContain('Use 4 to 7 scenes');
    expect(critique).toContain('copies the prompt');
    expect(out.recipe.scenes).toHaveLength(4);
  });

  it('flags a title pasted from the prompt, but not a quote', () => {
    const r = { type: 'social', scenes: [{ layers: [{ type: 'text', role: 'title', text: 'We are hiring a product designer' }] }] } as unknown as Recipe;
    expect(designNotes(r, "We're hiring: we are hiring a product designer, remote").join(' ')).toContain('copies the prompt');
    expect(designNotes({ ...r, type: 'quote' }, 'We are hiring a product designer')).toEqual([]);
  });

  it('keeps the first valid recipe when the critique try fails', async () => {
    const g = groq(oneScene());
    const out = await writeRecipe(input, g.opts);
    expect(g.bodies).toHaveLength(2);
    expect(out.recipe.scenes).toHaveLength(1);
    expect(validateRecipe(out.recipe)).toEqual([]);
  });

  it('adds in and out motion to text that has none, and fits the asked length', async () => {
    const g = groq(draft());
    const out = await writeRecipe({ ...input, lengthMs: 20000 }, g.opts);
    expect(out.recipe.scenes.reduce((t, s) => t + s.durationMs, 0)).toBeGreaterThan(19000);
    for (const s of out.recipe.scenes) for (const l of s.layers) expect(l.in && l.out).toBeTruthy();
    const bare = addMissingMotion(JSON.parse(JSON.stringify(out.recipe)));
    expect(bare.scenes[0]!.layers[0]!.out).toBeDefined();
  });

  it('normalises colours, preset names and missing defaults', async () => {
    const l = { id: 't1', type: 'text', role: 'title', text: 'Hi', box: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, colour: 'white', in: { preset: 'fade' } };
    const g = groq(draft({ background: 'rgb(17, 17, 20)', layout: 'Center' }, [l]));
    const { recipe } = await writeRecipe(input, g.opts);
    const t = recipe.scenes[0]!.layers[0]!;
    expect(recipe.scenes[0]!.background).toBe('#111114');
    expect(t).toMatchObject({ colour: '#FFFFFF', in: { preset: 'fade-in', feel: 'smooth', durationMs: 600 }, endMs: 4000, opacity: 1 });
    expect(normaliseColour('#abc')).toBe('#AABBCC');
    expect(normaliseColour('rgba(0,0,0,0)')).toBe('transparent');
    expect(parseJsonReply('Sure! {"a":1} done')).toEqual({ a: 1 });
  });

  it('retries once with the problems, then succeeds', async () => {
    const bad = draft({ layout: 'diagonal' }, [title({ in: { preset: 'zoom-in', feel: 'smooth', durationMs: 600 } })]);
    const g = groq(bad, draft());
    const out = await writeRecipe(input, g.opts);
    expect(validateRecipe(out.recipe)).toEqual([]);
    const retry = g.bodies[1]!.messages.at(-1)!.content;
    expect(retry).toContain('layout must be one of');
    expect(retry).toContain('"zoom-in" is not a known in preset');
  });

  it('fails with making-failed after the retry also fails', async () => {
    const invented = draft({}, [{ id: 'm1', name: 'Photo', type: 'image', assetId: 'stock-99', fit: 'cover', startMs: 0, endMs: 4000, box: { x: 0, y: 0, w: 1, h: 1 }, opacity: 1 }]);
    const g = groq('not json at all', invented);
    const err = await writeRecipe(input, g.opts).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ code: 'invalid-reply', state: 'making-failed' });
    expect(err.detail.problems.join(' ')).toContain('not in the assets list');
    expect(g.bodies).toHaveLength(2);
  });

  it('asks again, shorter, when Groq cannot write JSON even without JSON mode, then succeeds', async () => {
    const jv = () => new Response(JSON.stringify({ error: { message: 'x', type: 'invalid_request_error', code: 'json_validate_failed' } }), { status: 400 });
    const responses = [jv(), jv(), reply(draft())];
    const bodies: Body[] = [];
    const fetch: FetchLike = vi.fn(async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Body;
      if (isPlan(body)) return reply(PLAN);
      bodies.push(body); return responses.shift()!;
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await writeRecipe(input, { ai: 'cloud', key: KEY, fetch });
    spy.mockRestore();
    expect(validateRecipe(result.recipe)).toEqual([]);
    expect(bodies[2]!.messages.at(-1)!.content).toMatch(/fewer scenes/);
    // Prompt plus output budget stays within one free-tier call.
    expect(bodies[0]!.max_tokens).toBeLessThanOrEqual(4000);
    expect(estimateTokens(bodies[0]!.messages as never) + bodies[0]!.max_tokens).toBeLessThanOrEqual(CALL_BUDGET);
  });

  it('fitToMax keeps every layer at least 1 ms and every scene at least 1 ms', () => {
    const scenes = [
      { ...(JSON.parse(draft({ id: 's1', durationMs: 59990 }, [title({ startMs: 0, endMs: 59990 })])).scenes[0]) },
      { ...(JSON.parse(draft({ id: 's2', durationMs: 20 }, [title({ id: 't2', startMs: 5, endMs: 7 })])).scenes[0]) },
      { ...(JSON.parse(draft({ id: 's3', durationMs: 10000 }, [title({ id: 't3', startMs: 100, endMs: 101 })])).scenes[0]) },
    ];
    const out = fitToMax({ scenes } as unknown as Recipe);
    expect(out.scenes.reduce((t, s) => t + s.durationMs, 0)).toBeLessThanOrEqual(60000);
    for (const s of out.scenes) {
      expect(s.durationMs).toBeGreaterThanOrEqual(1);
      for (const l of s.layers) { expect(l.endMs).toBeGreaterThanOrEqual(l.startMs + 1); expect(l.endMs).toBeLessThanOrEqual(s.durationMs); }
    }
  });

  it('cuts a clip over 60 seconds to fit and says too-long', async () => {
    const scenes = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, durationMs: 20000, background: '#111114', layout: 'center', layers: [title({ id: `t${i}`, endMs: 20000 })] }));
    const g = groq(JSON.stringify({ name: 'Long', scenes }));
    const out = await writeRecipe(input, g.opts);
    expect(out.notices).toEqual(['too-long']);
    expect(out.recipe.scenes.reduce((t, s) => t + s.durationMs, 0)).toBeLessThanOrEqual(60000);
    expect(validateRecipe(out.recipe)).toEqual([]);
  });

  it('applies checker fixes and reports the reply was not clean', async () => {
    const g = groq(draft({}, [title({ text: 'A very long headline that will never fit at this size on a phone', sizePx: 200 })]));
    const out = await writeRecipe(input, g.opts);
    expect(out.checkerClean).toBe(false);
    expect((out.recipe.scenes[0]!.layers[0] as { sizePx: number }).sizePx).toBeLessThan(200);
  });

  it('maps network failures without retrying', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(writeRecipe(input, { ai: 'cloud', key: KEY, fetch })).rejects.toMatchObject({ state: 'offline' });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(writeRecipe(input, { ai: 'cloud', key: KEY, fetch: async () => new Response('', { status: 500 }) })).rejects.toMatchObject({ state: 'provider-down' });
  });
});

async function made(): Promise<Recipe> {
  return (await writeRecipe({ ...input, type: 'quote' }, groq(oneScene()).opts)).recipe;
}

describe('editRecipe', () => {
  it('sends a compact recipe and applies the ops with an inverse', async () => {
    const recipe = await made();
    const g = groq('{"ops":[{"op":"replace","path":"/scenes/0/layers/0/colour","value":"yellow"},{"op":"replace","path":"/scenes/0/background","value":"#000"}]}');
    const out = await editRecipe(recipe, 'make the title yellow on black', g.opts);
    expect(out.recipe.scenes[0]!.layers[0]).toMatchObject({ colour: '#FACC15' });
    expect(out.recipe.scenes[0]!.background).toBe('#000000');
    expect(applyPatch(out.recipe, out.inverse).doc).toEqual(recipe);
    const sent = g.bodies[0]!.messages[1]!.content;
    expect(sent).toContain('make the title yellow on black');
    expect(sent).not.toContain('opfsPath');
    expect(compactRecipe(recipe)).not.toContain('media/own-1.jpg');
  });

  it('rejects changes to assets, retries once, then fails with prompt-failed', async () => {
    const recipe = await made();
    const bad = '{"ops":[{"op":"add","path":"/assets/new","value":{}}]}';
    const g = groq(bad, 'console.log(1)');
    const err = await editRecipe(recipe, 'add a stock photo', g.opts).catch((e) => e);
    expect(err).toMatchObject({ code: 'invalid-reply', state: 'prompt-failed' });
    expect(g.bodies[1]!.messages.at(-1)!.content).toContain('path must start with');
  });

  it('retries a patch that does not apply, then succeeds', async () => {
    const recipe = await made();
    const g = groq('{"ops":[{"op":"replace","path":"/scenes/7/name","value":"x"}]}', '{"ops":[{"op":"replace","path":"/name","value":"Summer sale"}]}');
    const out = await editRecipe(recipe, 'rename it', g.opts);
    expect(out.recipe.name).toBe('Summer sale');
    expect(out.ops).toEqual([{ op: 'replace', path: '/name', value: 'Summer sale' }]);
  });

  it('refuses a change past 60 seconds without retrying', async () => {
    const recipe = await made();
    const g = groq('{"ops":[{"op":"replace","path":"/scenes/0/durationMs","value":72000}]}');
    const err = await editRecipe(recipe, 'make it 72 seconds', g.opts).catch((e) => e);
    expect(err).toMatchObject({ code: 'change-too-long', state: 'change-too-long', detail: { totalMs: 72000 } });
    expect(g.bodies).toHaveLength(1);
  });

  it('maps a busy Groq to provider-busy', async () => {
    const recipe = await made();
    await expect(editRecipe(recipe, 'x', { ai: 'cloud', key: KEY, fetch: async () => new Response('', { status: 429 }) })).rejects.toMatchObject({ state: 'provider-busy' });
  });
});
