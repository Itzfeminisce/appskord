import { describe, expect, it } from 'vitest';
import { FEEL } from '@appskord/motion/curves';
import { validateClip } from '@appskord/motion/recipe';
import { addEffect } from './EffectsDialog';
import { cameraSummary, keyTimes, moveKey, parseMs, parseRange, readMotion, writeMotion } from './edits';
import { sampleClip } from './fixture';
import { STAGGER_MS, staggeredMs } from '@appskord/motion/choreo';
import { editLayer, editScene, goBackTo, initV3, layerName, posterMs, redoV3, sceneTitle, undoV3, type V3State } from './model';
import { setMotion } from './MotionTab';
import { setTransition } from './TransitionDialog';

const at = (n: number) => ({ at: n, id: `c${n}` });
const st0 = (): V3State => initV3(sampleClip());
const headline = (st: V3State) => st.clip.v3.scenes[0]!.layers.find((l) => l.slotId === 'headline')!;

describe('recipe edits land in Changes and undo', () => {
  it('a camera edit writes the scene through validateScene and undoes', () => {
    const st = st0();
    const before = structuredClone(st.clip.v3.scenes[0]);
    const a = editScene(st, 0, (s) => { s.camera = { move: 'push-in', amount: 0.04 }; }, { summary: cameraSummary('push-in', 0.04), ...at(2000) });
    expect(a.clip.v3.scenes[0]!.camera.move).toBe('push-in');
    expect(a.clip.history.at(-1)).toMatchObject({ summary: 'Camera: Push in 4%', by: 'hand', id: 'c2000' });
    expect(a.clip.history).toHaveLength(st.clip.history.length + 1);
    const b = undoV3(a);
    expect(b.clip.v3.scenes[0]).toEqual(before);
    expect(b.future).toHaveLength(1);
    expect(redoV3(b).clip.v3.scenes[0]!.camera.move).toBe('push-in');
  });

  it('an edit the recipe check refuses changes nothing and says why', () => {
    const st = st0();
    const out = editScene(st, 0, (s) => { s.camera.focus = 'nope'; }, { summary: 'x' });
    expect(out.clip).toBe(st.clip);
    expect(out.errors?.[0]).toMatch(/camera\.focus/);
  });

  it('slider drags on one control merge into one change', () => {
    let st = st0();
    for (const [n, amount] of [[10, 0.1], [20, 0.2], [30, 0.3]] as const)
      st = editScene(st, 0, (s) => { s.camera.amount = amount; }, { summary: cameraSummary(s0(st), amount), mergeKey: 'cam', at: 5000 + n, id: `m${n}` });
    expect(st.clip.history).toHaveLength(2);
    expect(undoV3(st).clip.v3.scenes[0]!.camera.amount).toBe(sampleClip().v3.scenes[0]!.camera.amount);
  });

  it('Go back here undoes every later change and keeps them to come forward', () => {
    let st = st0();
    st = editScene(st, 0, (s) => { s.depthShadows = true; }, { summary: 'Depth shadows', ...at(1) });
    st = editScene(st, 0, (s) => { s.depthBlur = 'soft'; }, { summary: 'Depth blur: Soft', ...at(2) });
    st = editScene(st, 1, (s) => { s.camera.move = 'hold'; }, { summary: 'Camera: Hold', ...at(3) });
    const back = goBackTo(st, 'c1');
    expect(back.clip.history.map((c) => c.id)).toEqual(['restyle-1', 'c1']);
    expect(back.future).toHaveLength(2);
    expect(back.clip.v3.scenes[0]!.depthShadows).toBe(true);
    expect(back.clip.v3.scenes[0]!.depthBlur).toBeUndefined();
  });
});

const s0 = (st: V3State) => st.clip.v3.scenes[0]!.camera.move;

describe('motion tab edits', () => {
  it('reads and writes comes in, feel, timing, type moves, hold and out', () => {
    const st = st0();
    const s = st.clip.v3.scenes[0]!;
    const l = headline(st);
    const spec = { ...readMotion(s, l), comesIn: 'letter' as const, curve: FEEL.bouncy.curve, ms: 700, weight: [400, 700] as [number, number], hold: 'drift' as const, out: 'fade' as const };
    const next = writeMotion(s, l, spec);
    expect(next.type).toEqual({ unit: 'letter' });
    const back = readMotion(s, next);
    expect(back).toMatchObject({ comesIn: 'letter', ms: 700, weight: [400, 700], hold: 'drift', out: 'fade' });
    expect(back.curve).toEqual(FEEL.bouncy.curve);
    expect(readMotion(s, writeMotion(s, l, { ...spec, hold: 'float', out: 'mask' }))).toMatchObject({ hold: 'float', out: 'mask' });
  });

  it('Carry into next scene links the next scene and passes the clip check; turning it off unlinks', () => {
    let st = st0();
    const l = headline(st);
    const spec = readMotion(st.clip.v3.scenes[0]!, l);
    st = setMotion(st, l.id, { ...spec, out: 'carry' }, 'Headline: Carry into next scene');
    expect(st.errors).toBeUndefined();
    const [a, b] = st.clip.v3.scenes;
    const id = a!.layers.find((x) => x.id === l.id)!.carry!;
    expect(a!.transition).toEqual({ kind: 'carry', carry: [id] });
    expect(b!.layers.some((x) => x.carry === id)).toBe(true);
    expect(validateClip(st.clip.v3).ok).toBe(true);
    st = setMotion(st, l.id, { ...spec, out: 'none' }, 'Headline: Carry into next scene');
    expect(st.clip.v3.scenes[0]!.transition.carry).toBeUndefined();
    expect(validateClip(st.clip.v3).ok).toBe(true);
  });

  it('moves a keyframe on the timeline, kept between its neighbours', () => {
    const st = st0();
    const l = headline(st);
    const times = keyTimes(l);
    const last = times.at(-1)!;
    const moved = moveKey(l, last, last + 200);
    expect(keyTimes(moved)).toContain(last + 200);
    const clamped = moveKey(l, last, -500);
    for (const t of Object.values(clamped.tracks)) for (let i = 1; i < t!.length; i++) expect(t![i]!.t).toBeGreaterThan(t![i - 1]!.t);
    const out = editLayer(st, l.id, (x) => moveKey(x, last, last + 200), { summary: 'k' });
    expect(out.errors).toBeUndefined();
    expect(keyTimes(headline(out))).toContain(last + 200);
  });

  it('keeps the last keyframe inside the scene', () => {
    const st = st0();
    const s = st.clip.v3.scenes[0]!;
    const l = { ...headline(st), start: 100 };
    const last = keyTimes(l).at(-1)!;
    expect(keyTimes(moveKey(l, last, s.ms * 10, s.ms)).at(-1)).toBe(s.ms - 100);
  });

  it('parses the timing and type fields', () => {
    expect(parseMs('0.15 s')).toBe(150);
    expect(parseMs('40 ms')).toBe(40);
    expect(parseMs('soon')).toBeUndefined();
    expect(parseRange('400 → 700')).toEqual([400, 700]);
    expect(parseRange('85')).toEqual([85, 85]);
  });
});

describe('effects and transitions', () => {
  it('adds an effect to a layer, a scene or the whole clip', () => {
    const st = st0();
    const l = headline(st);
    const a = addEffect(st, { effect: 'glow', amount: 0.6, colour: 'glow', scope: 'layer', layerId: l.id, sceneId: 's1' }, 'Headline');
    expect(a.clip.history.at(-1)!.summary).toBe('Glow added to Headline');
    expect(a.clip.v3.scenes[0]!.effects?.at(-1)).toMatchObject({ effect: 'glow', layerId: l.id });
    const b = addEffect(st, { effect: 'blur-in', amount: 0.7, scope: 'layer', layerId: l.id, sceneId: 's1' }, 'Headline');
    expect(headline(b).tracks.blur?.[0]?.v).toBeGreaterThan(0);
    const c = addEffect(st, { effect: 'grain', amount: 0.2, scope: 'clip' }, 'Clip');
    expect(c.clip.v3.effects).toEqual([{ effect: 'grain', amount: 0.2, scope: 'clip' }]);
    expect(undoV3(c).clip.v3.effects).toBeUndefined();
  });

  it('sets a cut, carries across it, and uses one for every cut', () => {
    let st = st0();
    st = setTransition(st, 0, 'carry', false);
    expect(st.clip.v3.scenes[0]!.transition.kind).toBe('carry');
    expect(validateClip(st.clip.v3).ok).toBe(true);
    st = setTransition(st, 1, 'push', true);
    expect(st.clip.v3.scenes.slice(0, -1).every((s) => s.transition.kind === 'push')).toBe(true);
    expect(st.clip.history.at(-1)!.summary).toBe('Transition into scene 3: Push');
  });
});

describe('names', () => {
  it('names layers and scenes from the words', () => {
    const st = st0();
    expect(layerName(st.clip, 0, headline(st))).toBeTruthy();
    expect(sceneTitle(st.clip, 0)).not.toBe('');
  });
});

describe('the paused stage at a scene start', () => {
  it('shows the template key frame, or the moment the last layer has come in', () => {
    const scene = sampleClip().v3.scenes[0]!;
    expect(posterMs(scene)).toBe(900);
    const untemplated = { ...scene, templateId: 'none' };
    expect(posterMs(untemplated)).toBeGreaterThan(0);
    expect(posterMs({ ...untemplated, ms: 100 })).toBe(99);
  });

  it('waits for kinetic type to finish its staggered units, counted as choreo counts them', () => {
    const base = sampleClip().v3.scenes[0]!;
    const text = { id: 'words', kind: 'text' as const, depth: 'front' as const, type: { unit: 'line' as const }, start: 0, tracks: { opacity: [{ t: 0, v: 0 }, { t: 100, v: 1 }] } };
    const scene = { ...base, templateId: 'none', ms: 20_000, layers: [text] };
    expect(posterMs(scene)).toBe(100);
    // Two hard lines, however many lines they wrap into: 600 ms each, 120 ms apart.
    const lines = 'A long first line that wraps on a narrow frame\nsecond';
    expect(posterMs(scene, () => lines)).toBe(staggeredMs(FEEL.smooth.ms, 2, STAGGER_MS.line));
  });
});
