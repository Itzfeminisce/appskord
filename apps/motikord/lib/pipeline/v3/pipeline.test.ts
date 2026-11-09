import { describe, expect, it, vi } from 'vitest';
import { estimateTokens } from '@appskord/llm';
import { validateClip, validateScene } from '@appskord/motion/recipe';
import { CALL_BUDGET } from '../../ai/writeRecipe';
import { getPackV3 } from '../../look/packs';
import type { Recipe } from '../../types';
import { animateLayer } from './animateLayer';
import { allApproved, approve, approveAll, drawKeyFrames, footer, redraw, tryAnother } from './keyFrames';
import { addMotion, continuity } from './motion';
import { KEY_FRAMES, MAKING_MOTION, stateCopy } from './states';
import { fakeGroq, LOOK, PACK, testRecipe } from './testClip';

/** Scene `i` with two layers sharing an id, which no scene recipe allows. */
function broken(recipe: Recipe, i: number): Recipe {
  const r = structuredClone(recipe);
  const s = r.scenes[i]!;
  s.layers.push({ ...s.layers[0]! });
  return r;
}

describe('Check the key frames', () => {
  it('draws one still per scene in the look with no AI call', () => {
    const net = vi.spyOn(globalThis, 'fetch');
    const seen: string[] = [];
    const board = drawKeyFrames(testRecipe(), LOOK, PACK, (d, n) => seen.push(KEY_FRAMES.count(d, n)));
    expect(net).not.toHaveBeenCalled();
    expect(seen).toEqual(['1 of 5', '2 of 5', '3 of 5', '4 of 5', '5 of 5']);
    expect(board.lookGuideId).toBe('look-morning');
    expect(board.frames.map((f) => f.status)).toEqual(Array(5).fill('waiting'));
    expect(board.frames[0]).toMatchObject({ name: 'Title hook', words: 'Fieldnote 2.0. Notes that find you.', atMs: 900 });
    for (const f of board.frames) {
      expect(validateScene(f.still).ok).toBe(true);
      expect(f.still!.keyFrameApproved).toBe(false);
      for (const l of f.still!.layers) for (const tr of Object.values(l.tracks)) expect(tr).toHaveLength(1);
    }
  });

  it('approves per scene and counts what is left', () => {
    let board = drawKeyFrames(testRecipe(), LOOK, PACK);
    for (const i of [0, 1, 2]) board = approve(board, i);
    expect(footer(board)).toEqual({ line: 'Approve 2 more to add the motion', count: '3/5' });
    expect(allApproved(board)).toBe(false);
    board = approveAll(board);
    expect(footer(board)).toEqual({ count: '5/5' });
    expect(board.frames[0]!.status).toBe('approved');
  });

  it('Try another picks the next camera habit, the same every time', () => {
    const recipe = testRecipe();
    const board = drawKeyFrames(recipe, LOOK, PACK);
    const a = tryAnother(board, recipe, LOOK, PACK, 1);
    const b = tryAnother(board, recipe, LOOK, PACK, 1);
    expect(a.frames[1]!.variant).toBe(1);
    expect(a.frames[1]!.status).toBe('waiting');
    expect(a.frames[1]!.still!.camera).toEqual(b.frames[1]!.still!.camera);
    expect(a.frames[1]!.still!.camera.move).not.toBe(board.frames[1]!.still!.camera.move);
    const c = tryAnother(a, recipe, LOOK, PACK, 1);
    expect(c.frames[1]!.still!.camera.move).not.toBe(a.frames[1]!.still!.camera.move);
    expect(validateScene(c.frames[1]!.still).ok).toBe(true);
    expect(a.frames[0]).toBe(board.frames[0]);
  });

  it('keyframe-failed: one scene fails, the others are kept, Try again draws just that one', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = broken(testRecipe(), 2);
    let board = drawKeyFrames(bad, LOOK, PACK);
    expect(board.frames.map((f) => f.status)).toEqual(['waiting', 'waiting', 'failed', 'waiting', 'waiting']);
    expect(board.frames[2]!.still).toBeUndefined();
    expect(stateCopy('keyframe-failed', { scene: 3 })).toEqual({
      id: 'keyframe-failed',
      title: 'Scene 3’s key frame couldn’t be drawn',
      line: 'Your other key frames are kept. Try again to draw just this one.',
      action: 'Try again',
    });
    expect(approve(board, 2).frames[2]!.status).toBe('failed');
    board = redraw(board, testRecipe(), LOOK, PACK, 2);
    expect(board.frames[2]!.status).toBe('waiting');
    expect(spy).toHaveBeenCalledWith('Motikord: could not draw key frame', expect.any(Error));
    spy.mockRestore();
  });

  it('keyframes-waiting: motion waits until every key frame is approved', () => {
    const recipe = testRecipe();
    const board = approve(drawKeyFrames(recipe, LOOK, PACK), 0);
    expect(addMotion({ recipe, board, look: LOOK, pack: PACK })).toEqual({ ok: false, state: 'keyframes-waiting' });
    expect(stateCopy('keyframes-waiting').title).toBe('Drawing your key frames…');
  });
});

describe('Add the motion', () => {
  it('fills motion from the template beats in the look guide feel, and the clip validates', () => {
    const recipe = testRecipe();
    const bouncy = { ...LOOK, feel: 'bouncy' as const };
    const board = approveAll(drawKeyFrames(recipe, bouncy, PACK));
    const progress: string[] = [];
    const r = addMotion({ recipe, board, look: bouncy, pack: PACK, fps: 60, onScene: (i, n) => progress.push(MAKING_MOTION.adding(i, n)) });
    if (!r.ok) throw new Error(r.state);
    expect(progress[2]).toBe('Adding motion to scene 3 of 5');
    expect(validateClip(r.clip).ok).toBe(true);
    expect(r.clip).toMatchObject({ fps: 60, lookGuideId: 'look-morning', packId: 'studio' });
    expect(r.clip.scenes.every((s) => s.keyFrameApproved)).toBe(true);
    const tracks = r.clip.scenes.flatMap((s) => s.layers.flatMap((l) => Object.values(l.tracks)));
    expect(tracks.some((t) => t.length > 1)).toBe(true);
    // Layers with no curve of their own take the look's feel: a spring.
    const headline = r.clip.scenes[0]!.layers.find((l) => l.slotId === 'headline')!;
    expect(headline.tracks.opacity!.at(-1)!.curve).toMatchObject({ kind: 'spring' });
  });

  it('keeps a Try another camera through to the motion', () => {
    const recipe = testRecipe();
    let board = drawKeyFrames(recipe, LOOK, PACK);
    board = approveAll(tryAnother(board, recipe, LOOK, PACK, 3));
    const r = addMotion({ recipe, board, look: LOOK, pack: PACK });
    if (!r.ok) throw new Error(r.state);
    expect(r.clip.scenes[3]!.camera).toEqual(board.frames[3]!.still!.camera);
  });

  it('continuity: carries the same words into the next scene, and only in packs that carry', () => {
    const recipe = testRecipe();
    const scenes = drawKeyFrames(recipe, LOOK, PACK).frames.map((f) => structuredClone(f.still!));
    for (const s of scenes) for (const l of s.layers) delete l.carry;
    // Scene 3's number and scene 4's title say the same thing.
    const num = recipe.scenes[2]!.layers.find((l) => l.type === 'text')!;
    const title = recipe.scenes[3]!.layers.find((l) => l.type === 'text')!;
    if (num.type === 'text' && title.type === 'text') title.text = num.text;
    const { scenes: linked, carries } = continuity(scenes, recipe, PACK);
    const c = carries.find((x) => x.from === 2)!;
    expect(c).toMatchObject({ layerId: num.id, toLayerId: title.id, why: num.id === title.id ? 'same-layer' : 'same-text' });
    expect(linked[2]!.transition).toEqual({ kind: 'carry', carry: [c.carry] });
    expect(linked[3]!.layers.find((l) => l.id === title.id)!.carry).toBe(c.carry);
    for (const s of linked) for (const id of s.transition.carry ?? []) expect(linked[linked.indexOf(s) + 1]!.layers.some((l) => l.carry === id)).toBe(true);
    const bold = getPackV3('bold');
    expect(bold.transitions).not.toContain('carry');
    expect(continuity(scenes, recipe, bold).carries).toEqual([]);
  });

  it('motion-failed: stops at the scene that fails, keeps the ones before, and carries on from there', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recipe = testRecipe();
    const board = approveAll(drawKeyFrames(recipe, LOOK, PACK));
    const r = addMotion({ recipe: broken(recipe, 3), board, look: LOOK, pack: PACK });
    expect(r).toMatchObject({ ok: false, state: 'motion-failed', sceneIndex: 3 });
    if (r.ok || r.state !== 'motion-failed') throw new Error('expected motion-failed');
    expect(r.done).toHaveLength(3);
    expect(stateCopy('motion-failed', { scene: r.sceneIndex + 1 })).toMatchObject({
      title: 'Adding motion stopped at scene 4',
      line: 'Your approved key frames are kept. Try again to carry on from scene 4.',
    });
    const seen: number[] = [];
    const again = addMotion({ recipe, board, look: LOOK, pack: PACK, done: r.done, onScene: (i) => seen.push(i) });
    expect(again.ok).toBe(true);
    expect(seen).toEqual([4, 5]);
    spy.mockRestore();
  });
});

describe('Animate this layer', () => {
  const setup = () => {
    const recipe = testRecipe();
    const r = addMotion({ recipe, board: approveAll(drawKeyFrames(recipe, LOOK, PACK)), look: LOOK, pack: PACK });
    if (!r.ok) throw new Error(r.state);
    const scene = r.clip.scenes[0]!;
    const layer = scene.layers.find((l) => l.slotId === 'headline')!;
    const v2 = recipe.scenes[0]!.layers.find((l) => l.id === layer.id);
    return { scene, layer, v2 };
  };
  const PER_LETTER = JSON.stringify({
    tracks: { opacity: [{ t: 0, v: 0 }, { t: 400, v: 1, curve: { kind: 'spring', bounce: 50, ms: 700 } }], y: [{ t: 0, v: -200 }, { t: 800, v: 0, curve: { kind: 'spring', bounce: 50, ms: 700 } }] },
    unit: 'letter',
  });

  it('sends only the layer settings, never its words or media, and validates the tracks', async () => {
    const { scene, layer, v2 } = setup();
    const g = fakeGroq({ animate: PER_LETTER });
    const r = await animateLayer({ scene, layerId: layer.id, words: 'Drop and settle', name: 'Headline', v2 }, g.opts);
    if (!r.ok) throw new Error(r.state);
    expect(r.title).toBe('Headline animated');
    expect(r.line).toBe('Per letter, Bouncy, 0.8 s.');
    expect(r.layer.type).toEqual({ unit: 'letter' });
    expect(validateScene(r.scene).ok).toBe(true);
    expect(r.scene.layers.filter((l) => l.id !== layer.id)).toEqual(scene.layers.filter((l) => l.id !== layer.id));
    const raw = g.sent[0]!.raw;
    expect(raw).toContain('Drop and settle');
    expect(raw).not.toContain('Notes that find you');
    expect(raw).not.toMatch(/assetId|data:|blob:/);
    expect(estimateTokens(g.sent[0]!.body.messages as never) + g.sent[0]!.body.max_tokens).toBeLessThanOrEqual(CALL_BUDGET);
    expect(r.tokens).toBeLessThan(CALL_BUDGET);
  });

  it('never sends a media layer’s asset', async () => {
    const recipe = testRecipe();
    const media = { id: 'pic', kind: 'media' as const, depth: 'back' as const, tracks: { opacity: [{ t: 0, v: 1 }] } };
    const scene = { ...setup().scene, layers: [...setup().scene.layers, media] };
    const v2 = { id: 'pic', name: 'Photo', type: 'image' as const, assetId: 'img-secret', fit: 'cover' as const, startMs: 0, endMs: 3000, box: { x: 0, y: 0, w: 1, h: 1 }, opacity: 1 };
    const g = fakeGroq({ animate: JSON.stringify({ tracks: { scale: [{ t: 0, v: 1.1 }, { t: 3000, v: 1 }] } }) });
    const r = await animateLayer({ scene, layerId: 'pic', words: 'Slow zoom out', name: 'Photo', v2 }, g.opts);
    expect(r.ok).toBe(true);
    expect(g.sent[0]!.raw).not.toContain('img-secret');
    expect(recipe.assets).toEqual({});
  });

  it('animate-layer-unclear: a reply that is not motion, or tracks that fail the recipe check', async () => {
    const { scene, layer, v2 } = setup();
    for (const reply of ['{}', JSON.stringify({ tracks: { wobble: [{ t: 0, v: 1 }] } }), JSON.stringify({ tracks: { y: [{ t: 500, v: 0 }, { t: 100, v: 1 }] } })]) {
      const g = fakeGroq({ animate: reply });
      const r = await animateLayer({ scene, layerId: layer.id, words: 'Make it dance', name: 'Headline', v2 }, g.opts);
      expect(r).toMatchObject({
        ok: false,
        state: 'animate-layer-unclear',
        copy: { title: 'Motikord couldn’t turn those words into motion', action: 'Try other words' },
      });
    }
  });

  it('animate-layer-failed: the provider did not answer, and the layer is unchanged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { scene, layer, v2 } = setup();
    const g = fakeGroq({ animate: () => new Response('{"error":{"message":"down"}}', { status: 503 }) });
    const r = await animateLayer({ scene, layerId: layer.id, words: 'Drop and settle', name: 'Headline', v2 }, g.opts);
    expect(r).toMatchObject({
      ok: false,
      state: 'animate-layer-failed',
      copy: { title: 'Groq didn’t answer', line: 'Your layer is unchanged. Try again to send the same words.', action: 'Try again' },
    });
    spy.mockRestore();
  });
});
