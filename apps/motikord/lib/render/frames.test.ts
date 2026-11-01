import { describe, expect, it } from 'vitest';
import type { Recipe } from '../types';
import { FRAME_LONG_SIDE, frameSize, renderFrames, type CanvasFactory } from './frames';

/** A canvas whose 2D context accepts every call and draws nothing; it turns into a tiny JPEG blob. */
const fakeCanvas = (drawn: number[]): CanvasFactory => (width, height) => {
  const canvas = { width, height, getContext: () => ctx, convertToBlob: async (o?: { type?: string }) => new Blob([new Uint8Array([255, 216, 255])], { type: o?.type }) };
  const noop = () => undefined;
  const ctx: unknown = new Proxy({ canvas }, {
    get: (t, k) => (k === 'canvas' ? t.canvas : k === 'measureText' ? () => ({ width: 10 }) : k === 'fillRect' ? () => drawn.push(1) : noop),
    set: () => true,
  });
  return canvas as unknown as ReturnType<CanvasFactory>;
};

const recipe = (aspect: Recipe['aspect']): Recipe => ({
  version: 2, id: 'r', name: 'R', type: 'social', aspect, assets: {},
  scenes: [{ id: 's1', durationMs: 3000, background: '#101010', layout: 'center', layers: [] }, { id: 's2', durationMs: 3000, background: '#FAFAFA', layout: 'center', layers: [] }],
});

describe('critic frames', () => {
  it('are 512 px on the long side for every size', () => {
    expect(frameSize('9:16')).toEqual({ width: 288, height: FRAME_LONG_SIDE });
    expect(frameSize('1:1')).toEqual({ width: 512, height: 512 });
    expect(frameSize('16:9')).toEqual({ width: 512, height: 288 });
  });

  it('draws each time offscreen and returns JPEG data URLs', async () => {
    const drawn: number[] = [];
    const urls = await renderFrames(recipe('16:9'), [1000, 4000], { canvas: fakeCanvas(drawn) });
    expect(urls).toEqual(['data:image/jpeg;base64,/9j/', 'data:image/jpeg;base64,/9j/']);
    expect(drawn.length).toBe(2);
  });
});
