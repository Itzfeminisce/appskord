import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from './llm';
import { closeDB, deleteClip, getClip, listClips, putClip } from './db';
import { canMake, createRunner, draft, failureFor, makeClip, makeFromTemplate, promptFor, type RunnerDeps } from './makeClip';
import { AiError } from './ai/errors';
import { DEFAULT_SETTINGS } from './settings';
import { TEMPLATES } from './templates';
import { validateRecipe } from './recipe/validate';
import type { Asset, Clip, Settings } from './types';

const KEY = 'gsk_test';
const settings: Settings = { ...DEFAULT_SETTINGS, keySource: 'paste', onboarded: true };
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const scene = (ms = 4000) => ({
  id: 's1', durationMs: ms, background: '#111114', layout: 'center',
  layers: [{ id: 't1', name: 'Title', type: 'text', role: 'title', text: 'Fresh sourdough', font: 'Geist', sizePx: 96, weight: 700, colour: '#FFFFFF', align: 'center', lineHeight: 1.1, startMs: 0, endMs: ms, box: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, opacity: 1 }],
});
const recipeJson = (ms = 4000) => JSON.stringify({ name: 'Sourdough', scenes: [scene(ms)] });
/** A fake Groq: first the type, then the recipe (or whatever `replies` holds). */
const groq = (...replies: (string | Response | Error)[]) => {
  const fetch: FetchLike = vi.fn(async () => {
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'string' ? ok(next) : (next ?? ok('{}'));
  });
  return { fetch, hooks: { ai: 'cloud' as const, key: KEY, fetch, settings } };
};
const photo: Asset = { id: 'p1', kind: 'image', name: 'loaf.jpg', mime: 'image/jpeg', bytes: 5, opfsPath: 'media/p1.jpg' };
const extra: Asset = { id: 'p2', kind: 'image', name: 'other.jpg', mime: 'image/jpeg', bytes: 5, opfsPath: 'media/p2.jpg' };

describe('makeClip', () => {
  it('detects the type, writes the recipe, saves the clip and reports each step', async () => {
    const g = groq('{"type":"promo"}', recipeJson());
    const saved: Clip[] = [];
    const seen: string[] = [];
    const r = await makeClip({ prompt: 'A promo for sourdough', aspect: '9:16', assets: [photo, extra], id: 'c1' }, {
      ...g.hooks, save: async (c) => { saved.push(c); }, now: () => 5,
      onType: (t, by) => seen.push(`type:${t}:${by}`), onRecipe: (rec) => seen.push(`recipe:${rec.scenes.length}`),
    });
    expect(seen).toEqual(['type:promo:groq', 'recipe:1']);
    expect(r.clip).toMatchObject({ id: 'c1', createdAt: 5, history: [] });
    expect(r.clip.recipe).toMatchObject({ type: 'promo', aspect: '9:16', prompt: 'A promo for sourdough' });
    expect(validateRecipe(r.clip.recipe)).toEqual([]);
    expect(Object.keys(r.clip.recipe.assets)).toEqual([]); // neither photo was used by a layer
    expect(saved).toEqual([r.clip]);
    expect(g.fetch).toHaveBeenCalledTimes(2);
  });

  it('skips detection when you chose the type', async () => {
    const g = groq(recipeJson());
    const r = await makeClip({ prompt: 'x', aspect: '1:1', type: 'quote', assets: [] }, { ...g.hooks, save: async () => {} });
    expect(r.type).toBe('quote');
    expect(g.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps used media with no credit, and adds attached music', async () => {
    const song: Asset = { id: 'a1', kind: 'audio', name: 'jingle.mp3', mime: 'audio/mpeg', bytes: 1, opfsPath: 'media/a1.mp3' };
    const withPhoto = JSON.stringify({ name: 'N', scenes: [{ ...scene(), layers: [{ id: 'm1', name: 'Photo', type: 'image', assetId: 'p1', fit: 'cover', startMs: 0, endMs: 4000, box: { x: 0, y: 0, w: 1, h: 1 }, opacity: 1 }] }] });
    const g = groq(withPhoto);
    const r = await makeClip({ prompt: 'x', aspect: '9:16', type: 'promo', assets: [photo, extra, song] }, { ...g.hooks, save: async () => {} });
    expect(Object.keys(r.clip.recipe.assets).sort()).toEqual(['a1', 'p1']);
    expect(r.clip.recipe.assets.p1!.credit).toBeUndefined();
    expect(r.clip.recipe.music?.assetId).toBe('a1');
    expect(validateRecipe(r.clip.recipe)).toEqual([]);
  });

  it('reports a clip cut to 60 seconds as the too-long notice', async () => {
    const g = groq(recipeJson(90_000));
    const r = await makeClip({ prompt: 'x', aspect: '9:16', type: 'promo', assets: [] }, { ...g.hooks, save: async () => {} });
    expect(r.notices).toEqual(['too-long']);
    expect(r.clip.recipe.scenes[0]!.durationMs).toBeLessThanOrEqual(60_000);
  });

  const fails = async (replies: (string | Response | Error)[], s: Settings = settings) => {
    const g = groq(...replies);
    return makeClip({ prompt: 'x', aspect: '9:16', type: 'promo', assets: [] }, { ...g.hooks, settings: s, save: async () => {} }).catch((e: unknown) => e);
  };
  it('maps each failure to its state card', async () => {
    expect(await fails([new TypeError('Failed to fetch')])).toMatchObject({ state: 'offline' });
    expect(await fails([new Response('{}', { status: 429, headers: { 'retry-after': '20' } })])).toMatchObject({ state: 'groq-busy', retryAfterMs: 20_000 });
    expect(await fails([new Response('{}', { status: 503 })])).toMatchObject({ state: 'groq-down' });
    expect(await fails([new Response('{}', { status: 401 })])).toMatchObject({ state: 'groq-down' });
    expect(await fails(['not json', 'still not json'])).toMatchObject({ state: 'making-failed' });
  });

  it('maps a missing key by where the key came from', async () => {
    expect(failureFor(new AiError('no-key', 'make'), { keySource: 'penv-app' }).state).toBe('penv-disconnected');
    expect(failureFor(new AiError('no-key', 'make'), { keySource: 'paste' }).state).toBe('key-needed');
    expect(failureFor(new AiError('no-key', 'make'), { keySource: null }).state).toBe('key-needed');
  });

  it('treats a stopped request as no state at all', async () => {
    const ctl = new AbortController();
    const fetch: FetchLike = async () => { throw new DOMException('aborted', 'AbortError'); };
    ctl.abort();
    const e = await makeClip({ prompt: 'x', aspect: '9:16', type: 'promo', assets: [] }, { ai: 'cloud', key: KEY, fetch, signal: ctl.signal, settings, save: async () => {} }).catch((x: unknown) => x);
    expect(e).toMatchObject({ state: undefined });
  });
});

describe('draft', () => {
  it('needs a prompt or media, and still has a prompt for media alone', () => {
    draft.clear();
    expect(canMake(draft.get())).toBe(false);
    draft.set({ prompt: '  ' });
    expect(canMake(draft.get())).toBe(false);
    draft.set({ attached: [photo] });
    expect(canMake(draft.get())).toBe(true);
    expect(promptFor(draft.get())).toContain('image');
    draft.set({ prompt: 'Hello' });
    expect(promptFor(draft.get())).toBe('Hello');
    draft.clear();
  });
});

describe('library', () => {
  afterEach(async () => { await closeDB(); indexedDB.deleteDatabase('motikord'); });

  it('saves your own copy of a template', async () => {
    const t = TEMPLATES[0]!;
    const clip = await makeFromTemplate(t, { id: 'mine' });
    expect((await getClip('mine'))?.recipe.name).toBe(t.name);
    expect(clip.recipe.id).toBe('mine');
    expect(validateRecipe(clip.recipe)).toEqual([]);
    expect(t.recipe.id).not.toBe('mine');
  });

  it('a prompt ends with a saved clip and the editor opened', async () => {
    const g = groq(recipeJson());
    const opened: string[] = [];
    const runner = createRunner(deps({ opened, hooks: g.hooks }));
    await runner.start({ prompt: 'A promo', attached: [], type: 'promo' });
    expect(runner.get()).toMatchObject({ status: 'done', steps: 4, editorOpen: true });
    expect((await listClips()).map((c) => c.id)).toEqual(['id-1']);
    expect(opened).toEqual(['id-1']);
  });

  it('"Open the editor now" opens early, and the finished clip replaces the placeholder', async () => {
    const g = groq(recipeJson());
    const opened: string[] = [];
    const notified: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: RunnerDeps['make'] = async (i, h) => { await gate; return makeClip(i, h); };
    const runner = createRunner(deps({ opened, notified, hooks: g.hooks, make: slow }));
    const run = runner.start({ prompt: 'A promo', attached: [], type: 'promo' });
    await vi.waitFor(() => expect(runner.get().status).toBe('running'));
    await runner.openNow({ prompt: 'A promo', attached: [] });
    expect(opened).toEqual(['id-1']);
    expect((await getClip('id-1'))?.recipe.scenes[0]!.layers).toEqual([]);
    release();
    await run;
    expect((await getClip('id-1'))?.recipe.scenes[0]!.layers).toHaveLength(1);
    expect(opened).toEqual(['id-1']);
    expect(notified).toEqual(['id-1']);
  });

  it('cancel stops the run, removes an unfinished clip and returns to idle', async () => {
    const opened: string[] = [];
    let seen: AbortSignal | undefined;
    const hang: RunnerDeps['make'] = (_i, h) => new Promise((_res, rej) => { seen = h?.signal; h?.signal?.addEventListener('abort', () => rej(new AiError('cancelled', 'make'))); });
    const runner = createRunner(deps({ opened, make: hang }));
    const run = runner.start({ prompt: 'A promo', attached: [] });
    await vi.waitFor(() => expect(seen).toBeDefined());
    await runner.openNow({ prompt: 'A promo', attached: [] });
    await runner.cancel();
    await run;
    expect(seen!.aborted).toBe(true);
    expect(runner.get().status).toBe('idle');
    expect(await getClip('id-1')).toBeUndefined();
  });

  it('shows groq-access without any AI call when host access is denied', async () => {
    const g = groq();
    const runner = createRunner(deps({ hooks: g.hooks }));
    await runner.start({ prompt: 'A promo', attached: [] }, { access: 'denied' });
    expect(runner.get()).toMatchObject({ status: 'failed', failure: 'groq-access' });
    expect(g.fetch).not.toHaveBeenCalled();
  });

  it('a failed run keeps the draft and says which state', async () => {
    const g = groq(new Response('{}', { status: 429 }));
    const runner = createRunner(deps({ hooks: g.hooks }));
    await runner.start({ prompt: 'A promo', attached: [], type: 'promo' });
    expect(runner.get()).toMatchObject({ status: 'failed', failure: 'groq-busy' });
    expect(await listClips()).toEqual([]);
  });
});

describe('runner review fixes', () => {
  afterEach(async () => { await closeDB(); indexedDB.deleteDatabase('motikord'); });
  const draftA = { prompt: 'A promo', attached: [] as Asset[], type: 'promo' as const };
  const gate = () => { let release!: () => void; const p = new Promise<void>((r) => { release = r; }); return { p, release }; };

  it('cancel on a finished run keeps the clip', async () => {
    const g = groq(recipeJson());
    const runner = createRunner(deps({ hooks: g.hooks }));
    await runner.start(draftA);
    await runner.cancel();
    expect(await getClip('id-1')).toBeDefined();
  });

  it('an editor that fails to open keeps the finished clip', async () => {
    const g = groq(recipeJson());
    const d = deps({ hooks: g.hooks });
    const runner = createRunner({ ...d, openEditor: async () => { throw new Error('no tab'); } });
    await runner.start(draftA);
    expect(await getClip('id-1')).toBeDefined();
  });

  it('a remake reuses the placeholder id and leaves no orphan', async () => {
    const g = groq(recipeJson());
    const opened: string[] = [];
    const notified: string[] = [];
    const hold = gate();
    let calls = 0;
    const make: RunnerDeps['make'] = async (i, h) => { if (calls++ === 0) { await hold.p; throw new AiError('cancelled', 'make'); } return makeClip(i, h); };
    const runner = createRunner(deps({ opened, notified, hooks: g.hooks, make }));
    const first = runner.start(draftA);
    await vi.waitFor(() => expect(runner.get().status).toBe('running'));
    await runner.openNow(draftA);
    const second = runner.start({ ...draftA, type: 'quote' });
    hold.release();
    await Promise.all([first, second]);
    expect((await listClips()).map((c) => c.id)).toEqual(['id-1']);
    expect((await getClip('id-1'))?.recipe.scenes[0]!.layers).toHaveLength(1);
    expect(opened).toEqual(['id-1']);
    expect(notified).toEqual(['id-1']);
  });

  it('counts automatic busy retries', async () => {
    const g = groq(new Response('{}', { status: 429 }), new Response('{}', { status: 429 }));
    const runner = createRunner(deps({ hooks: g.hooks }));
    await runner.start(draftA);
    expect(runner.get().busyRetries).toBe(0);
    await runner.start(draftA, { auto: true });
    expect(runner.get()).toMatchObject({ failure: 'groq-busy', busyRetries: 1 });
    await runner.start(draftA);
    expect(runner.get().busyRetries).toBe(0);
  });

  it('openNow after cancel saves nothing', async () => {
    let started = false;
    const make: RunnerDeps['make'] = (_i, h) => new Promise((_r, rej) => { started = true; h?.signal?.addEventListener('abort', () => rej(new AiError('cancelled', 'make'))); });
    const base = deps({ make });
    const runner = createRunner(base);
    const run = runner.start({ prompt: 'A promo', attached: [] });
    await vi.waitFor(() => expect(started).toBe(true));
    const opening = runner.openNow({ prompt: 'A promo', attached: [] });
    await runner.cancel();
    await opening; await run;
    expect(await getClip('id-1')).toBeUndefined();
    expect(runner.get().status).toBe('idle');
  });

  it('openNow loses to a run that finished meanwhile and never overwrites the real clip', async () => {
    const g = groq(recipeJson());
    const runner = createRunner(deps({ hooks: g.hooks }));
    await runner.start(draftA);
    await runner.openNow({ prompt: 'A promo', attached: [] });
    expect((await getClip('id-1'))?.recipe.scenes[0]!.layers).toHaveLength(1);
  });

  it('a cancelled run saves nothing, even when the signal fires just before the save', async () => {
    const g = groq(recipeJson());
    const ctl = new AbortController();
    const save = vi.fn(async () => undefined);
    await expect(makeClip({ prompt: 'x', aspect: '9:16', type: 'promo', assets: [] }, { ...g.hooks, settings, signal: ctl.signal, save, onRecipe: () => ctl.abort() })).rejects.toMatchObject({ state: undefined });
    expect(save).not.toHaveBeenCalled();
  });
});

function deps(o: { opened?: string[]; notified?: string[]; hooks?: Record<string, unknown>; make?: RunnerDeps['make'] } = {}): RunnerDeps {
  let n = 0;
  const base = o.make ?? makeClip;
  return {
    make: (i, h) => base(i, { ...h, ...o.hooks, signal: h?.signal, onType: h?.onType, onRecipe: h?.onRecipe }),
    openEditor: async (id) => { o.opened?.push(id); },
    notifySaved: async (id) => { o.notified?.push(id); },
    save: putClip,
    remove: deleteClip,
    settings: async () => settings,
    brand: async () => undefined,
    id: () => `id-${++n}`,
  };
}
