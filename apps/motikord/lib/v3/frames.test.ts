import { describe, expect, it, vi } from 'vitest';

// No WebGL in unit tests: the renderer is a fake that records what it was asked to draw.
const calls: { made: string[]; rendered: [string, number][]; disposed: string[]; texts: string[]; gl: number; stuck?: boolean; hang?: boolean } = { made: [], rendered: [], disposed: [], texts: [], gl: 0 };
vi.mock('@appskord/motion/renderer', () => ({
  createCanvasRenderer: () => ({ forceContextLoss: () => { calls.gl++; }, dispose: () => undefined }),
  V3Renderer: class {
    three = { children: [{ children: [], _isSyncing: !!calls.stuck }] };
    constructor(readonly scene: { id: string; layers: { kind: string; id: string }[] }, o: { content: (l: unknown) => { text?: string } | undefined }) {
      calls.made.push(scene.id);
      for (const l of scene.layers) if (l.kind === 'text') calls.texts.push(o.content(l)?.text ?? '');
    }
    attach() {}
    render(t: number) { calls.rendered.push([this.scene.id, t]); }
    async renderReady(t: number) { if (calls.hang) await new Promise(() => undefined); this.render(t); }
    dispose() { calls.disposed.push(this.scene.id); }
  },
}));

import { sampleClip } from '../../components/editor/fixture';
import { ClipDrawer, sceneAt, textReady, TextNotReady } from './frames';
import { sceneLayerText } from './text';

describe('v3 frames', () => {
  it('finds the scene and the time inside it; the very end stays on the last scene', () => {
    const v3 = sampleClip().v3;
    const first = v3.scenes[0]!.ms;
    expect(sceneAt(v3, 0)).toEqual({ index: 0, local: 0 });
    expect(sceneAt(v3, first + 10)).toEqual({ index: 1, local: 10 });
    const total = v3.scenes.reduce((n, s) => n + s.ms, 0);
    expect(sceneAt(v3, total)).toEqual({ index: v3.scenes.length - 1, local: v3.scenes.at(-1)!.ms });
  });

  it('waits for troika to finish typesetting, and gives up after the limit', async () => {
    const node = { children: [{ children: [], _isSyncing: true }] };
    let waits = 0;
    const ready = textReady(node, 1000, async () => { if (++waits === 3) node.children[0]!._isSyncing = false; });
    expect(await ready).toBe(true);
    expect(waits).toBe(3);
    expect(await textReady({ children: [{ children: [], _isSyncing: true }] }, 32, async () => undefined)).toBe(false);
  });

  it('draws the clip scene by scene with each layer’s words, one renderer at a time', async () => {
    const clip = sampleClip();
    const canvas = {} as HTMLCanvasElement;
    const d = new ClipDrawer(clip.v3, (i, l) => sceneLayerText(clip.recipe.scenes[i], l), { width: 1080, height: 1920, quality: 'full', fps: 30 }, canvas);
    const first = clip.v3.scenes[0]!;
    await d.draw(0);
    await d.draw(100);
    await d.draw(first.ms + 50);
    d.dispose();
    expect(calls.made).toEqual([first.id, clip.v3.scenes[1]!.id]);
    expect(calls.rendered).toEqual([[first.id, 0], [first.id, 100], [clip.v3.scenes[1]!.id, 50]]);
    expect(calls.disposed).toEqual([first.id, clip.v3.scenes[1]!.id]);
    expect(calls.gl).toBe(1);
    expect(calls.texts.some((t) => t.length > 0)).toBe(true);
  });

  it('fails the frame rather than drawing blank words when the text never typesets', async () => {
    vi.useFakeTimers();
    calls.stuck = true;
    try {
      const clip = sampleClip();
      const d = new ClipDrawer(clip.v3, () => 'Hi', { width: 64, height: 64, quality: 'full', fps: 30 }, {} as HTMLCanvasElement);
      const before = calls.rendered.length;
      const drawn = d.draw(0);
      const check = expect(drawn).rejects.toBeInstanceOf(TextNotReady);
      await vi.advanceTimersByTimeAsync(10_100);
      await check;
      expect(calls.rendered.length).toBe(before);
      d.dispose();
    } finally {
      calls.stuck = false;
      vi.useRealTimers();
    }
  });

  it('waits for each frame’s text (a count changing mid-scene) and fails the frame when it never typesets', async () => {
    vi.useFakeTimers();
    try {
      const clip = sampleClip();
      const d = new ClipDrawer(clip.v3, () => 'Hi', { width: 64, height: 64, quality: 'full', fps: 30 }, {} as HTMLCanvasElement, 500);
      await d.draw(0);
      const before = calls.rendered.length;
      calls.hang = true;
      const check = expect(d.draw(40)).rejects.toBeInstanceOf(TextNotReady);
      await vi.advanceTimersByTimeAsync(600);
      await check;
      expect(calls.rendered.length).toBe(before);
      d.dispose();
    } finally {
      calls.hang = false;
      vi.useRealTimers();
    }
  });
});
