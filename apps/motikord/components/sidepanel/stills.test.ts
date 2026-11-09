// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serveRenderPort } from '../../lib/v3/renderChannel';

const sent: { type: string; contents?: Record<string, unknown> }[] = [];
const handoffs: { targetOrigin: string; ports: number }[] = [];

import { sampleClip } from '../editor/fixture';
import { sceneContents } from '../../lib/v3/text';
import { clipContents, clipFrames, renderStill, setRenderers } from './stills';

afterEach(() => { sent.splice(0); setRenderers({}); });
// The hidden render frame never loads in happy-dom: stand in for its load event, and for the render page serving the port it is handed.
const loadFrame = () => setTimeout(() => {
  const frame = document.querySelector('iframe')!;
  Object.defineProperty(frame, 'contentWindow', { configurable: true, value: {
    postMessage: (_data: unknown, targetOrigin: string, transfer: MessagePort[]) => {
      handoffs.push({ targetOrigin, ports: transfer.length });
      serveRenderPort(transfer[0]!, {
        still: async (m) => { sent.push(m); return 'data:image/jpeg;base64,AA'; },
        frames: async (m) => { sent.push(m); return m.times.map(() => 'data:image/jpeg;base64,AA'); },
      });
    },
  } });
  frame.dispatchEvent(new Event('load'));
}, 0);

describe('side panel stills', () => {
  it('reads each text layer’s words and layout box from the v2 scene', () => {
    const clip = sampleClip();
    const contents = sceneContents(clip.v3.scenes[0]!, clip.recipe.scenes[0], '9:16');
    expect(Object.values(contents).some((c) => !!c.text && !!c.box)).toBe(true);
    expect(Object.keys(clipContents(clip.v3, clip.recipe, '9:16')).every((k) => /^\d+:/.test(k))).toBe(true);
  });

  it('asks the render page for a still in a hidden frame, never drawing in the panel', async () => {
    const clip = sampleClip();
    loadFrame();
    const url = await renderStill(clip.v3.scenes[0]!, 900, { width: 96, height: 170 }, { contents: { a: { text: 'Hi' } } });
    expect(url).toMatch(/^data:image\/jpeg/);
    expect(sent[0]).toMatchObject({ type: 'still', contents: { a: { text: 'Hi' } } });
    // Only this panel's frame gets the port, posted to the extension's own origin.
    expect(handoffs).toEqual([{ targetOrigin: new URL(browser.runtime.getURL('/render.html')).origin, ports: 1 }]);
    expect(document.querySelector('iframe')?.getAttribute('src')).toMatch(/render\.html$/);
    const frames = await clipFrames(clip.recipe)(clip.v3, [0, 500]);
    expect(frames).toHaveLength(2);
    expect(sent[1]!.type).toBe('frames');
  });

  it('falls back to words when the still cannot be drawn', async () => {
    setRenderers({ still: async () => { throw new Error('no GPU'); } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await renderStill(sampleClip().v3.scenes[0]!, 0, { width: 1, height: 1 })).toBeUndefined();
  });
});
