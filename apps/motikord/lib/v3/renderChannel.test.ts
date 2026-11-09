import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleClip } from '../../components/editor/fixture';
import { clampSize, isPortHandoff, RENDER_PORT, renderClient, serveRenderPort, type RenderHandlers } from './renderChannel';

const ports: MessagePort[] = [];
afterEach(() => { ports.splice(0).forEach((p) => p.close()); vi.restoreAllMocks(); });
function pair(h: RenderHandlers) {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveRenderPort(port2, h);
  return renderClient(port1);
}

describe('render channel', () => {
  it('holds a still to 64..2160 a side and turns away sizes that are not positive and finite', () => {
    expect(clampSize({ width: 96, height: 170 })).toEqual({ width: 96, height: 170 });
    expect(clampSize({ width: 1, height: 99_999 })).toEqual({ width: 64, height: 2160 });
    for (const bad of [{ width: 0, height: 10 }, { width: -5, height: 10 }, { width: Number.NaN, height: 10 }, { width: Infinity, height: 10 }, { width: 10 }, undefined])
      expect(clampSize(bad as never)).toBeUndefined();
  });

  it('answers the panel over its own port, with the size clamped, and turns a draw error into a rejection', async () => {
    const seen: { width: number; height: number }[] = [];
    const ask = pair({
      still: async (r) => { seen.push(r.size); return 'data:image/jpeg;base64,AA'; },
      frames: async () => { throw new Error('text did not typeset'); },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scene = sampleClip().v3.scenes[0]!;
    expect(await ask({ type: 'still', scene, atMs: 0, size: { width: 9000, height: 10 }, texts: {} })).toMatch(/^data:image/);
    expect(seen).toEqual([{ width: 2160, height: 64 }]);
    await expect(ask({ type: 'still', scene, atMs: 0, size: { width: -1, height: 10 }, texts: {} })).rejects.toThrow(/positive/);
    await expect(ask({ type: 'frames', clip: sampleClip().v3, times: [0], texts: {} })).rejects.toThrow(/typeset/);
    expect(seen).toHaveLength(1);
  });

  it('takes a port only from its parent, on the extension’s own origin', () => {
    const parent = {};
    const self = { origin: 'chrome-extension://abc', parent, window: {} };
    const ok = { origin: 'chrome-extension://abc', source: parent, data: { type: RENDER_PORT }, ports: [{}] } as never;
    expect(isPortHandoff(ok, self)).toBe(true);
    expect(isPortHandoff({ ...(ok as object), origin: 'https://example.com' } as never, self)).toBe(false);
    expect(isPortHandoff({ ...(ok as object), source: {} } as never, self)).toBe(false);
    expect(isPortHandoff({ ...(ok as object), ports: [] } as never, self)).toBe(false);
    expect(isPortHandoff(ok, { ...self, window: parent })).toBe(false);
  });
});
