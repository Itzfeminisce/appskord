import { describe, expect, it } from 'vitest';
import { validateClip, validateLookGuide, validateScene } from '../src/recipe';
import { clip, scene } from './fixture';

const errors = (x: unknown) => {
  const r = validateScene(x);
  return r.ok ? [] : r.errors;
};

describe('v3 recipe validator', () => {
  it('accepts a good scene and clip', () => {
    expect(validateScene(scene())).toEqual({ ok: true, value: scene() });
    expect(validateClip(clip()).ok).toBe(true);
  });

  it('rejects unknown ids naming the key and the fix', () => {
    const s = scene() as unknown as { layers: Record<string, unknown>[]; camera: Record<string, unknown> };
    (s.layers[0] as Record<string, unknown>).kind = 'blob';
    (s.layers[1] as Record<string, unknown>).depth = 'far';
    s.camera.move = 'zoom';
    s.camera.focus = 'nope';
    const es = errors(s);
    expect(es).toContain(
      'layers[0].kind: "blob" is not a layer kind. Use one of text, shape, path, media, lottie, icon, particles, chart, model.',
    );
    expect(es).toContain('layers[1].depth: "far" is not a depth. Use one of front, middle, back.');
    expect(es).toContain(
      'camera.move: "zoom" is not a camera move. Use one of push-in, pull-out, pan, orbit, rack-focus, hold.',
    );
    expect(es).toContain(
      'camera.focus: "nope" is not a layer id in this scene. Use a layer id from layers, or remove it.',
    );
  });

  it('rejects unknown tracks and fields, bad keys and curves, duplicate ids', () => {
    const s = scene() as unknown as { layers: { id: string; tracks: Record<string, unknown>; [k: string]: unknown }[] };
    const l0 = s.layers[0] as (typeof s.layers)[number];
    l0.tracks.colour = [{ t: 0, v: 1 }];
    l0.glow = true;
    l0.tracks.x = [
      { t: 100, v: 0 },
      { t: 50, v: 1, curve: { kind: 'spring', bounce: 200, ms: 700 } },
    ];
    (s.layers[1] as (typeof s.layers)[number]).id = 'kicker';
    const es = errors(s);
    expect(
      es.some((e) => e.startsWith('layers[0].tracks.colour: is not an animatable property. Use one of x, y')),
    ).toBe(true);
    expect(es.some((e) => e.startsWith('layers[0].glow: is not a recipe field. Remove it'))).toBe(true);
    expect(es).toContain(
      'layers[0].tracks.x[1].t: is not after the key before it. Sort keys by t, each later than the last.',
    );
    expect(es).toContain(
      'layers[0].tracks.x[1].curve.bounce: must be a number from 0 to 95. Set it to a number in that range.',
    );
    expect(es).toContain('layers[1].id: "kicker" is used twice. Give every layer its own id.');
  });

  it('sends v2 recipes to the v2 loader', () => {
    expect(errors({ ...scene(), version: 2 })[0]).toBe(
      'version: is not 3. Set version to 3, or load it as a v2 scene through @appskord/scenes.',
    );
  });

  it('checks clips: fps, finish and carries into the next scene', () => {
    const c = clip() as unknown as Record<string, unknown> & { scenes: { layers: { carry?: string }[] }[] };
    c.fps = 24;
    (c.finish as Record<string, unknown>).grain = 2;
    delete (c.scenes[1] as (typeof c.scenes)[number]).layers[1]?.carry;
    const r = validateClip(c);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContain('fps: 24 is not a supported frame rate. Use 30 or 60.');
    expect(r.errors).toContain('finish.grain: must be a number from 0 to 1. Set it to a number in that range.');
    expect(r.errors).toContain(
      'scenes[0].transition.carry[0]: "word" has no matching layer in the next scene. Set that carry id on a layer in the next scene, or remove it.',
    );
  });

  it('checks look guides', () => {
    const guide = {
      id: 'g1',
      name: 'Studio',
      palette: ['#101010', '#f4f1ea'],
      type: { display: 'Archivo', text: 'Inter' },
      feel: 'smooth',
      light: 'left',
      texture: 0.3,
      camera: 'push-in',
    };
    expect(validateLookGuide(guide).ok).toBe(true);
    const r = validateLookGuide({ ...guide, feel: 'wobbly' });
    expect(r.ok ? [] : r.errors).toEqual([
      'feel: "wobbly" is not a motion feel. Use one of smooth, snappy, bouncy, steady, floaty.',
    ]);
  });
});
