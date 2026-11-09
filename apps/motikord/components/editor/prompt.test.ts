import { describe, expect, it } from 'vitest';
import { validateClip } from '@appskord/motion/recipe';
import type { PromptEdit } from '../../lib/editor/applyPrompt';
import { applyPatch } from '../../lib/patch';
import type { PatchOp } from '../../lib/types';
import { sampleClip } from './fixture';
import { initV3 } from './model';
import { FEEL } from '@appskord/motion/curves';
import { readMotion, writeMotion } from './edits';
import { feelNear } from './curves';
import { applyPromptV3, doneLine, promptChanged, promptStep, recipeOps, setSizeV3, syncScenes, underRecipe } from './prompt';

const clip = sampleClip();
const answer = (ops: PatchOp[]): PromptEdit => ({
  edit: { ops, summary: 'Slower' },
  by: 'groq',
  detail: '',
  recipe: applyPatch(clip.recipe, ops).doc,
});

describe('v3 prompt edits', () => {
  it('moves recipe ops under /recipe', () => {
    expect(underRecipe([{ op: 'replace', path: '/name', value: 'x' }, { op: 'move', from: '/scenes/0', path: '/scenes/1' }])).toEqual([
      { op: 'replace', path: '/recipe/name', value: 'x' },
      { op: 'move', from: '/recipe/scenes/0', path: '/recipe/scenes/1' },
    ]);
  });

  it('leaves the v3 scenes alone when only words change', () => {
    const ops: PatchOp[] = [{ op: 'replace', path: '/name', value: 'New name' }];
    expect(recipeOps(clip, answer(ops).recipe, ops)).toEqual(underRecipe(ops));
  });

  it('retimes a scene and keeps its motion', () => {
    const ms = clip.recipe.scenes[0]!.durationMs + 1000;
    const out = applyPromptV3(initV3(clip), answer([{ op: 'replace', path: '/scenes/0/durationMs', value: ms }]));
    expect(out.clip.v3.scenes[0]!.ms).toBe(ms);
    expect(out.clip.v3.scenes[0]!.layers).toEqual(clip.v3.scenes[0]!.layers);
    expect(out.clip.recipe.scenes[0]!.durationMs).toBe(ms);
    expect(out.clip.history.at(-1)).toMatchObject({ summary: 'Slower', by: 'groq' });
  });

  it('follows a removed and a swapped scene, and the clip still passes the recipe check', () => {
    const removed = answer([{ op: 'remove', path: '/scenes/1' }]);
    const a = syncScenes(clip, removed.recipe)!;
    expect(a.map((s) => s.id)).toEqual(removed.recipe.scenes.map((s) => s.id));
    const swapped = answer([{ op: 'move', from: '/scenes/2', path: '/scenes/1' }]);
    const b = syncScenes(clip, swapped.recipe)!;
    expect(b.map((s) => s.id)).toEqual(swapped.recipe.scenes.map((s) => s.id));
    expect(validateClip({ ...clip.v3, scenes: b }).ok).toBe(true);
  });

  it('follows a layer reorder and keeps each layer\'s motion', () => {
    const base = structuredClone(clip);
    const ids = new Set(base.recipe.scenes[0]!.layers.map((l) => l.id));
    base.v3.scenes[0]!.layers = base.v3.scenes[0]!.layers.filter((l) => ids.has(l.id));
    base.v3.scenes[0]!.effects = [];
    const old = base.v3.scenes[0]!.layers;
    const ops: PatchOp[] = [{ op: 'move', from: '/scenes/0/layers/0', path: '/scenes/0/layers/1' }];
    const next = applyPatch(base.recipe, ops).doc;
    const out = syncScenes(base, next)!;
    expect(out[0]!.layers.map((l) => l.id)).toEqual(next.scenes[0]!.layers.map((l) => l.id));
    expect(out[0]!.layers.map((l) => l.id)).not.toEqual(old.map((l) => l.id));
    for (const l of out[0]!.layers) expect(l).toEqual(old.find((o) => o.id === l.id));
  });

  it('undoes a prompt edit in one step', () => {
    const st = applyPromptV3(initV3(clip), answer([{ op: 'remove', path: '/scenes/1' }]));
    expect(st.clip.v3.scenes).toHaveLength(clip.v3.scenes.length - 1);
    const back = applyPatch(st.clip, st.clip.history.at(-1)!.inverse).doc;
    expect(back.v3.scenes).toEqual(clip.v3.scenes);
    expect(back.recipe).toEqual(clip.recipe);
  });
});

describe('size switch', () => {
  it('sets the recipe size and reflows the boxes, as one change', () => {
    const to = clip.recipe.aspect === '16:9' ? '1:1' : '16:9';
    const st = setSizeV3(initV3(clip), to);
    expect(st.clip.recipe.aspect).toBe(to);
    expect(st.clip.history.at(-1)!.summary).toBe(`Size ${to}`);
    expect(setSizeV3(st, to)).toBe(st);
  });
});

describe('after a prompt edit (EditPromptV3)', () => {
  const words = (si: number, li: number, text: string) => answer([{ op: 'replace', path: `/scenes/${si}/layers/${li}/text`, value: text }]);

  it('jumps to the first changed scene and selects its first changed layer', () => {
    const second = clip.recipe.scenes[1]!.layers.findIndex((l) => l.type === 'text');
    const out = { ...words(1, second, 'Fake words'), detail: 'The words now read Fake words' };
    const { state, changed } = promptStep(initV3(clip), out);
    expect(state.scene).toBe(1);
    expect(state.layerId).toBe(clip.recipe.scenes[1]!.layers[second]!.id);
    expect(changed).toMatchObject({ scene: 1, layerId: state.layerId, summary: 'The words now read Fake words' });
    expect(changed!.clip).toBe(state.clip);
    expect(doneLine(changed!.summary)).toBe('Done. The words now read Fake words.');
  });

  it('tags the Motion sections whose settings changed', () => {
    const before = clip;
    const s = structuredClone(clip);
    const scene = s.v3.scenes[0]!;
    const i = scene.layers.findIndex((l) => l.slotId === 'headline');
    scene.layers[i] = writeMotion(scene, scene.layers[i]!, { ...readMotion(scene, scene.layers[i]!), comesIn: 'letter', curve: FEEL.smooth.curve });
    const c = promptChanged(before, s, 'x')!;
    expect(c.layerId).toBe(scene.layers[i]!.id);
    expect(c.sections).toEqual(expect.arrayContaining(['Comes in', 'Feel']));
    expect(c.sections).not.toContain('Goes out');
    expect(promptChanged(clip, clip, 'x')).toBeUndefined();
  });

  it('records the feel the changed layer had before the edit', () => {
    const s = structuredClone(clip);
    const scene = s.v3.scenes[0]!;
    const i = scene.layers.findIndex((l) => l.slotId === 'headline');
    const was = feelNear(readMotion(clip.v3.scenes[0]!, clip.v3.scenes[0]!.layers[i]!).curve);
    scene.layers[i] = writeMotion(scene, scene.layers[i]!, { ...readMotion(scene, scene.layers[i]!), curve: { kind: 'bezier', p: [0.7, 0.1, 0.3, 0.95] } });
    expect(promptChanged(clip, s, 'x')!.hadFeel).toBe(was);
  });

  it('keeps a box edit to this size only when the switch is on', () => {
    const r = clip.recipe;
    const box = { ...r.scenes[0]!.layers[0]!.box, x: 0.11 };
    const out = answer([{ op: 'replace', path: '/scenes/0/layers/0/box', value: box }]);
    const st = applyPromptV3(initV3(clip), out, true);
    const l = st.clip.recipe.scenes[0]!.layers[0]!;
    expect(l.boxes?.[r.aspect]).toEqual(box);
    expect(l.box).toEqual(r.scenes[0]!.layers[0]!.box);
  });
});
