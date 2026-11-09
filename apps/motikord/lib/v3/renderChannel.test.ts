import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleClip } from '../../components/editor/fixture';
import { clampSize, isPortHandoff, ownEntry, PX_MAX, RENDER_PORT, renderClient, serveRenderPort, TEXT_MAX, validContents, type RenderHandlers } from './renderChannel';

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
    expect(await ask({ type: 'still', scene, atMs: 0, size: { width: 9000, height: 10 }, contents: {} })).toMatch(/^data:image/);
    expect(seen).toEqual([{ width: 2160, height: 64 }]);
    await expect(ask({ type: 'still', scene, atMs: 0, size: { width: -1, height: 10 }, contents: {} })).rejects.toThrow(/positive/);
    await expect(ask({ type: 'frames', clip: sampleClip().v3, times: [0], contents: {} })).rejects.toThrow(/typeset/);
    expect(seen).toHaveLength(1);
  });

  it('keeps only well-formed layer contents, so hostile numbers never become geometry', async () => {
    const hostile = JSON.parse('{"__proto__": {"text": "polluted"}, "constructor": 5, "a": {"text": 42, "fontSize": 1e308, "radius": -3, "size": {"w": "9", "h": 10}, "box": {"x": 3, "y": 0, "w": 0.5, "h": 0.5}, "color": "' + 'x'.repeat(500) + '", "shape": "star", "align": "middle", "valign": 1}, "b": [1], "c": null}');
    hostile.d = { text: 'y'.repeat(TEXT_MAX * 3), fontSize: Infinity, size: { w: 99_999, h: 10 }, box: { x: -0.1, y: 0.2, w: 2, h: Number.NaN }, stroke: '#fff', shape: 'circle' };
    hostile.e = { text: 'ok', align: 'left', valign: 'top', fontSize: 80, radius: 40, size: { w: 540, h: 192 }, box: { x: -1, y: 2, w: 0, h: 2 }, color: '#123456', shape: 'rect' };
    const c = validContents(hostile);
    expect(Object.keys(c).sort()).toEqual(['__proto__', 'a', 'd', 'e']);
    expect(Object.getPrototypeOf(c)).toBeNull();
    expect(c.a).toEqual({});
    expect(c.d).toEqual({ text: 'y'.repeat(TEXT_MAX), stroke: '#fff', shape: 'circle' });
    expect(c.e).toEqual(hostile.e);
    expect(validContents({ x: { fontSize: PX_MAX + 1, radius: PX_MAX } })).toEqual({ x: { radius: PX_MAX } });
    for (const bad of [null, 'x', 7, [{}]]) expect(Object.keys(validContents(bad))).toEqual([]);
    expect(({} as Record<string, unknown>).text).toBeUndefined();
    expect(ownEntry({ a: 1 } as Record<string, number>, 'constructor')).toBeUndefined();
    expect(ownEntry({} as Record<string, number>, '__proto__')).toBeUndefined();

    const seen: unknown[] = [];
    const ask = pair({
      still: async (r) => { seen.push(r.contents); return 'data:image/jpeg;base64,AA'; },
      frames: async (r) => { seen.push(r.contents); return []; },
    });
    const scene = sampleClip().v3.scenes[0]!;
    await ask({ type: 'still', scene, atMs: 0, size: { width: 96, height: 170 }, contents: { t: { fontSize: -1, text: 'hi' } } });
    await ask({ type: 'frames', clip: sampleClip().v3, times: [0], contents: { '0:t': { box: { x: Infinity, y: 0, w: 1, h: 1 } }, bad: 'str' } as never });
    expect(seen.map((x) => ({ ...(x as object) }))).toEqual([{ t: { text: 'hi' } }, { '0:t': {} }]);
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
