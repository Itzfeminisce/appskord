import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../llm';
import type { Asset, Recipe } from '../types';
import { validateRecipe } from '../recipe/validate';
import { PRESET_IDS } from '../render/presets';
import { LAYOUTS } from '../render/reflow';
import { applyPatch } from '../patch';
import { detectType, guessType } from './detectType';
import { compactRecipe, editRecipe } from './editRecipe';
import { AiError } from './errors';
import { editSystem, recipeSystem } from './prompts';
import { normaliseColour, parseJsonReply, writeRecipe, type WriteInput } from './writeRecipe';

const KEY = 'gsk_test';
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
/** A fake Groq that answers with each content in turn and records the request bodies. */
function groq(...contents: string[]) {
  const bodies: { messages: { role: string; content: string }[] }[] = [];
  const fetch: FetchLike = vi.fn(async (_u: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = contents.shift();
    if (next === undefined) throw new Error('no more replies');
    return reply(next);
  });
  return { fetch, bodies, opts: { ai: 'cloud' as const, key: KEY, fetch } };
}

const photo: Asset = { id: 'own-1', kind: 'image', name: 'Shoes', mime: 'image/jpeg', bytes: 10, width: 800, height: 600, opfsPath: 'media/own-1.jpg' };
const title = (extra: Record<string, unknown> = {}) => ({
  id: 't1', name: 'Title', type: 'text', role: 'title', text: 'Spring sale', font: 'Geist', sizePx: 96, weight: 700, colour: '#FFFFFF',
  align: 'center', lineHeight: 1.1, startMs: 0, endMs: 4000, box: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, opacity: 1,
  in: { preset: 'rise-in', feel: 'smooth', durationMs: 600 }, ...extra,
});
const draft = (scene: Record<string, unknown> = {}, layers: unknown[] = [title()]) =>
  JSON.stringify({ name: 'Spring sale', scenes: [{ id: 's1', durationMs: 4000, background: '#111114', layout: 'center', layers, ...scene }] });
const input: WriteInput = { prompt: 'A spring shoe sale', type: 'promo', aspect: '9:16', assets: [photo], id: 'clip-1' };

describe('prompts', () => {
  it('list every preset id and layout and nothing invented', () => {
    const text = recipeSystem(input) + editSystem();
    for (const id of PRESET_IDS) expect(text).toContain(id);
    for (const l of LAYOUTS) expect(text).toContain(l);
    expect(recipeSystem(input)).toContain('"own-1"');
    expect(recipeSystem({ ...input, assets: [] })).toContain('use no image or video layers');
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

  it('throws a typed error when Groq is busy', async () => {
    const fetch: FetchLike = async () => new Response('{}', { status: 429 });
    await expect(detectType('x', { ai: 'cloud', key: KEY, fetch, settings: {} })).rejects.toMatchObject({ state: 'groq-busy' });
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
    await expect(writeRecipe(input, { ai: 'cloud', key: KEY, fetch: async () => new Response('', { status: 500 }) })).rejects.toMatchObject({ state: 'groq-down' });
  });
});

async function made(): Promise<Recipe> {
  return (await writeRecipe(input, groq(draft()).opts)).recipe;
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

  it('maps a busy Groq to groq-busy', async () => {
    const recipe = await made();
    await expect(editRecipe(recipe, 'x', { ai: 'cloud', key: KEY, fetch: async () => new Response('', { status: 429 }) })).rejects.toMatchObject({ state: 'groq-busy' });
  });
});
