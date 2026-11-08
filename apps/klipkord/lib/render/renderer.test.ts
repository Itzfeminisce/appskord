import { describe, expect, it, vi } from 'vitest';
import type { RenderPlan } from '../project/types';
import { canvas2dBackend, sourceOf } from './canvas2d';
import { box } from './layers/geometry';
import { layerOrder } from './layers/order';
import type { Picture, Scene } from './layers/scene';
import { FRAME } from './plan';
import { createRenderer, type FrameProvider } from './renderer';
import { fake2d, fakeFrame } from './testing';

function plan(change: Partial<RenderPlan> = {}): RenderPlan {
  return {
    out: 500, rec: 500, fade: 0,
    background: { kind: 'colour', value: '#112233' },
    screen: { source: 'screen', t: 500, crop: { x: 0, y: 0, w: 1, h: 1 }, dest: { x: 48, y: 48, w: 1824, h: 984 }, radius: 16, shadow: 24 },
    overlays: [], cards: [],
    ...change,
  };
}

function scene(p: RenderPlan, pics: Partial<Scene> = {}): Scene {
  return {
    plan: p, frame: FRAME['16:9'], width: 960, height: 540, scale: { x: 0.5, y: 0.5 },
    screen: fakeFrame(), camera: null, media: null, background: null, mask: null, layers: layerOrder(p, !!pics.drawCard), ...pics,
  };
}

function canvas(ctx = fake2d()) {
  return { width: 960, height: 540, getContext: (type: string) => (type === '2d' ? ctx.ctx : null) } as unknown as OffscreenCanvas;
}

const scratch = () => {
  const made: ReturnType<typeof fake2d>[] = [];
  const make = (w: number, h: number) => {
    const f = fake2d();
    made.push(f);
    return { width: w, height: h, getContext: () => f.ctx };
  };
  return { made, make };
};

describe('Canvas 2D backend', () => {
  it('fills the background, shadows the screen and draws its crop into the scaled box', () => {
    const f = fake2d();
    const p = plan({ screen: { ...plan().screen!, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } } });
    canvas2dBackend(f.ctx).draw(scene(p));
    expect(f.calls).toContainEqual(['fillStyle=', '#112233']);
    expect(f.calls).toContainEqual(['fillRect', 0, 0, 960, 540]);
    expect(f.calls).toContainEqual(['shadowBlur=', 12]);
    const image = f.calls.find((c) => c[0] === 'drawImage')!;
    expect(image.slice(2)).toEqual([480, 270, 960, 540, 24, 24, 912, 492]);
    expect(f.names().indexOf('fillRect')).toBeLessThan(f.names().indexOf('drawImage'));
  });

  it('draws a gradient background once per size, and a blurred screen past the edges', () => {
    const f = fake2d();
    const backend = canvas2dBackend(f.ctx);
    const p = plan({ background: { kind: 'gradient', value: 'ember' } });
    backend.draw(scene(p));
    backend.draw(scene(p));
    expect(f.calls.filter((c) => c[0] === 'createLinearGradient')).toHaveLength(1);
    expect(f.calls.filter((c) => c[0] === 'addColorStop')).toEqual([['addColorStop', 0, '#7C2D12'], ['addColorStop', 0.5, '#C2410C'], ['addColorStop', 1, '#FDBA74']]);

    const g = fake2d();
    const screen = fakeFrame();
    canvas2dBackend(g.ctx).draw(scene(plan({ background: { kind: 'blurred', value: '' } }), { screen, background: screen }));
    expect(g.calls).toContainEqual(['filter=', 'blur(20px)']);
    expect(g.calls.find((c) => c[0] === 'drawImage')!.slice(6)).toEqual([-40, -40, 1040, 620]);
  });

  it('mirrors and masks the camera into its round box at its alpha', () => {
    const f = fake2d();
    const p = plan({
      screen: undefined,
      camera: { source: 'camera', t: 0, dest: { x: 40, y: 651, w: 389, h: 389 }, shape: 'round', mirror: true, blur: { on: false, mode: 'blur', colour: '#000' }, alpha: 0.5 },
    });
    canvas2dBackend(f.ctx).draw(scene(p, { screen: null, camera: fakeFrame(640, 480) }));
    expect(f.calls).toContainEqual(['globalAlpha=', 0.5]);
    expect(f.calls).toContainEqual(['scale', -1, 1]);
    expect(f.calls).toContainEqual(['clip']);
    // 4:3 camera into a square: the middle three quarters of its width.
    expect(f.calls.find((c) => c[0] === 'drawImage')!.slice(2, 5)).toEqual([80, 0, 480]);
  });

  it('puts the person over the blurred camera when a mask is given, and draws plain without one', () => {
    const blur = { on: true, mode: 'colour' as const, colour: '#1C1917' };
    const p = plan({ screen: undefined, camera: { source: 'camera', t: 0, dest: { x: 0, y: 0, w: 200, h: 200 }, shape: 'rounded', mirror: false, blur, alpha: 1 } });
    const s = scratch();
    const f = fake2d();
    canvas2dBackend(f.ctx, s.make).draw(scene(p, { screen: null, camera: fakeFrame(), mask: fakeFrame() }));
    expect(s.made).toHaveLength(2);
    expect(s.made[0]!.calls).toContainEqual(['fillStyle=', '#1C1917']);
    expect(s.made[1]!.calls).toContainEqual(['globalCompositeOperation=', 'destination-in']);

    const plain = scratch();
    canvas2dBackend(fake2d().ctx, plain.make).draw(scene(p, { screen: null, camera: fakeFrame(), mask: null }));
    expect(plain.made).toHaveLength(0);
  });

  it('pixelates through a small canvas, blurs with a filter and fills solid boxes', () => {
    const base = { id: 'o', kind: 'blur' as const, at: 0, end: 1000, box: { x: 0, y: 0, w: 0.5, h: 0.5 }, motion: 'none' as const };
    const s = scratch();
    const f = fake2d();
    const p = plan({
      overlays: [
        { ...base, blur: { mode: 'pixelate', amount: 0, follow: false } },
        { ...base, blur: { mode: 'blur', amount: 1, follow: false } },
        { ...base, blur: { mode: 'solid', amount: 1, follow: false } },
      ],
    });
    canvas2dBackend(f.ctx, s.make).draw(scene(p));
    expect(s.made).toHaveLength(1);
    expect(f.calls).toContainEqual(['imageSmoothingEnabled=', false]);
    expect(f.calls).toContainEqual(['filter=', 'blur(16px)']);
    expect(f.calls).toContainEqual(['fillStyle=', '#111114']);
  });

  it('draws vector layers in frame px, calls the card hook and fades last', () => {
    const f = fake2d();
    const drawCard = vi.fn();
    const p = plan({
      fade: 0.25, cursor: { x: 100, y: 100, size: 1, click: 0 },
      cards: [{ id: 'c', template: 'title', at: 0, ms: 1000, slots: {}, pack: 'clean' }],
      captions: { words: [{ text: 'Hello', on: true }], style: { style: 'bold', position: 'bottom', size: 48, show: true } },
    });
    canvas2dBackend(f.ctx).draw(scene(p, { drawCard }));
    const [ctx, card, info] = drawCard.mock.calls[0]!;
    expect(ctx).toBe(f.ctx);
    expect([card, info]).toEqual([p.cards[0], { frame: FRAME['16:9'], out: 500, scale: 0.5 }]);
    expect(f.calls).toContainEqual(['setTransform', 0.5, 0, 0, 0.5, 0, 0]);
    expect(f.calls).toContainEqual(['fillText', 'Hello', expect.any(Number), expect.any(Number)]);
    expect(f.calls.at(-1)).toEqual(['fillRect', 0, 0, 960, 540]);
    expect(f.calls.at(-2)).toEqual(['fillStyle=', 'rgba(0,0,0,0.25)']);
  });

  it('maps a part of the screen box back to its part of the picture', () => {
    const out = sourceOf({ x: 0.5, y: 0, w: 0.5, h: 1 }, { x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 0, w: 50, h: 50 }, box());
    expect(out).toEqual({ x: 0.75, y: 0, w: 0.25, h: 0.5 });
  });
});

describe('createRenderer', () => {
  it('falls back to Canvas 2D without WebGL2 and asks once per source', async () => {
    const frame = vi.fn(async () => fakeFrame());
    const r = createRenderer(canvas(), { frame }, { backend: 'webgl2' });
    expect(r.backend).toBe('canvas2d');
    await r.render(plan({ background: { kind: 'blurred', value: '' } }), '16:9');
    expect(frame).toHaveBeenCalledTimes(1);
    expect(frame).toHaveBeenCalledWith('screen', 500);
  });

  it('keeps the last frame while a newer one is on its way, and closes every frame it replaces or holds', async () => {
    const first = fakeFrame();
    const second = fakeFrame();
    const queue: (Picture | null)[] = [first, null, second];
    const f = fake2d();
    const r = createRenderer(canvas(f), { frame: async () => queue.shift() ?? null }, { backend: 'canvas2d' });
    await r.render(plan(), '16:9');
    await r.render(plan(), '16:9');
    expect(first.closed).toBe(false);
    expect(f.calls.filter((c) => c[0] === 'drawImage').map((c) => c[1])).toEqual([first, first]);
    await r.render(plan(), '16:9');
    expect(first.closed).toBe(true);
    r.dispose();
    expect(second.closed).toBe(true);
  });

  it('keeps the held frame when the new one has the same timestamp, closing the new one', async () => {
    const first = fakeFrame(1920, 1080, 40_000);
    const again = fakeFrame(1920, 1080, 40_000);
    const queue: Picture[] = [first, again];
    const f = fake2d();
    const r = createRenderer(canvas(f), { frame: async () => queue.shift() ?? null }, { backend: 'canvas2d' });
    await r.render(plan(), '16:9');
    await r.render(plan(), '16:9');
    expect(again.closed).toBe(true);
    expect(first.closed).toBe(false);
    expect(f.calls.filter((c) => c[0] === 'drawImage').map((c) => c[1])).toEqual([first, first]);
    r.dispose();
    expect(first.closed).toBe(true);
  });

  it('asks the camera mask hook only when "Blur behind you" is on', async () => {
    const cameraMask = vi.fn(() => null);
    const provider: FrameProvider = { frame: async () => fakeFrame() };
    const r = createRenderer(canvas(), provider, { backend: 'canvas2d', hooks: { cameraMask } });
    const camera = { source: 'camera', t: 0, dest: { x: 0, y: 0, w: 200, h: 200 }, shape: 'round' as const, mirror: false, blur: { on: false, mode: 'blur' as const, colour: '#000' }, alpha: 1 };
    await r.render(plan({ camera }), '16:9');
    expect(cameraMask).not.toHaveBeenCalled();
    await r.render(plan({ camera: { ...camera, blur: { ...camera.blur, on: true } } }), '16:9');
    expect(cameraMask).toHaveBeenCalledWith(expect.anything(), 'camera', 0);
  });

  it('runs renders one after another and resizes the canvas', async () => {
    const order: number[] = [];
    let n = 0;
    const r = createRenderer(canvas(), { frame: async () => { const i = n++; order.push(i); return fakeFrame(); } }, { backend: 'canvas2d' });
    await Promise.all([r.render(plan(), '16:9'), r.render(plan(), '16:9')]);
    expect(order).toEqual([0, 1]);
    const c = canvas();
    createRenderer(c, { frame: async () => null }, { backend: 'canvas2d' }).resize(640.4, 360);
    expect([c.width, c.height]).toEqual([640, 360]);
  });
});
