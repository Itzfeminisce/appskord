import { describe, expect, it, vi } from 'vitest';

// No WebGL in unit tests: the renderer is a fake that records what it was asked to draw.
const calls: { made: string[]; rendered: [string, number][]; disposed: string[]; texts: string[]; gl: number } = { made: [], rendered: [], disposed: [], texts: [], gl: 0 };
vi.mock('@appskord/motion/renderer', () => ({
  createCanvasRenderer: () => ({ forceContextLoss: () => { calls.gl++; }, dispose: () => undefined }),
  V3Renderer: class {
    three = { children: [{ children: [], _isSyncing: false }] };
    constructor(readonly scene: { id: string; layers: { kind: string; id: string }[] }, o: { content: (l: unknown) => { text?: string } | undefined }) {
      calls.made.push(scene.id);
      for (const l of scene.layers) if (l.kind === 'text') calls.texts.push(o.content(l)?.text ?? '');
    }
    attach() {}
    render(t: number) { calls.rendered.push([this.scene.id, t]); }
    dispose() { calls.disposed.push(this.scene.id); }
  },
}));

import { sampleClip } from '../../components/editor/fixture';
import { ClipDrawer, sceneAt, textReady } from './frames';
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
});
