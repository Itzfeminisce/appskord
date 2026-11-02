import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  drawScene,
  expandSpec,
  loadSceneFonts,
  SAFE_AREA,
  SCENE_FONTS,
  SCENE_TEMPLATES,
  STYLE_PACKS,
  type Aspect,
  type Ctx,
  type SceneCache,
  type SceneSpec,
  type TextLayer,
} from './index';

const ASPECTS: Aspect[] = ['9:16', '1:1', '16:9'];
const SIZES: Record<Aspect, [number, number]> = { '9:16': [540, 960], '1:1': [720, 720], '16:9': [960, 540] };

/** A logging 2D context stand-in, as Motikord's render tests use, that records what is drawn and in which colour. */
function fakeCtx(width: number, height: number) {
  const log: string[] = [];
  let font = '10px sans-serif';
  let fillStyle = '';
  const paint = () => ({ addColorStop: () => undefined });
  const target: Record<string, unknown> = {
    canvas: { width, height },
    measureText: (s: string) => ({ width: s.length * Number(/([\d.]+)px/.exec(font)![1]) * 0.5 }),
    createLinearGradient: paint,
    createRadialGradient: paint,
    createPattern: paint,
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  const ctx = new Proxy(target, {
    get: (t, k) =>
      k in t
        ? t[k as string]
        : (...args: unknown[]) => {
            log.push(`${String(k)}(${args.map(String).join(',')})|${fillStyle}`);
          },
    set: (_t, k, v) => {
      if (k === 'font') font = v;
      if (k === 'fillStyle') fillStyle = typeof v === 'string' ? v : 'paint';
      return true;
    },
  });
  return { ctx: ctx as unknown as Ctx, log };
}

const spec = (style = 'clean'): SceneSpec => ({
  template: 'title-hook',
  slots: { kicker: 'New today', headline: 'Clips that move' },
  look: { style: style as SceneSpec['look']['style'] },
});

describe('template ids', () => {
  it('lists every template file, in frame order', () => {
    const files = readdirSync(join(__dirname, 'templates/scenes')).map((f) => f.replace(/\.json$/, ''));
    expect(SCENE_TEMPLATES.map((t) => t.id).sort()).toEqual(files.sort());
    expect(SCENE_TEMPLATES.map((t) => t.id)).toEqual([
      'title-hook',
      'big-statement',
      'stat-reveal',
      'chart',
      'quote',
      'list',
      'hero',
      'split',
      'before-after',
      'steps',
      'logo-sting',
      'end-card',
    ]);
    expect(STYLE_PACKS.map((p) => p.id)).toEqual(['clean', 'bold', 'playful', 'corporate']);
  });
});

describe('expandSpec', () => {
  it('gives each filled slot a layer with its own box for every size, inside that size’s safe area', () => {
    for (const pack of STYLE_PACKS) {
      const scene = expandSpec(spec(pack.id))!;
      const tpl = SCENE_TEMPLATES.find((t) => t.id === 'title-hook')!;
      const texts = scene.layers.filter((l): l is TextLayer => l.type === 'text');
      expect(texts.map((l) => l.slot)).toEqual(['kicker', 'headline']);
      for (const l of texts) {
        const def = tpl.slots.find((d) => d.id === l.slot)!;
        for (const a of ASPECTS) {
          const b = l.boxes?.[a];
          const s = SAFE_AREA[a];
          expect(b, `${pack.id} ${l.slot} ${a}`).toBeDefined();
          expect(b!.x).toBeGreaterThanOrEqual(s.x - 1e-6);
          expect(b!.y + b!.h).toBeLessThanOrEqual(s.y + s.h + 1e-6);
          // Only the blocks pack squeezes text off its slab; the others keep the template's box.
          if (pack.background.kind !== 'blocks') expect(b).toEqual(def.boxes[a]);
        }
      }
      expect(new Set(ASPECTS.map((a) => JSON.stringify(texts[1]!.boxes![a]))).size).toBeGreaterThan(1);
    }
  });

  it('leaves an unknown template or style undrawn', () => {
    expect(expandSpec({ ...spec(), template: 'nope' as SceneSpec['template'] })).toBeUndefined();
    expect(expandSpec(spec('nope'))).toBeUndefined();
  });
});

describe('drawScene', () => {
  it('draws the background, then the slot text in the pack font and ink, at every size', () => {
    const pack = STYLE_PACKS.find((p) => p.id === 'clean')!;
    for (const a of ASPECTS) {
      const { ctx, log } = fakeCtx(...SIZES[a]);
      drawScene(ctx, spec(), a, 1500, undefined);
      const bg = log.findIndex((c) => c.startsWith('fillRect('));
      const words = log.filter((c) => c.startsWith('fillText('));
      expect(bg).toBeGreaterThanOrEqual(0);
      expect(words.length).toBeGreaterThan(0);
      expect(log.indexOf(words[0]!)).toBeGreaterThan(bg);
      expect(words.some((c) => !c.endsWith(`|${pack.palette.bg}`))).toBe(true);
    }
  });

  it('plays in and out motion: nothing but background at 0 ms, text mid-scene', () => {
    const at = (t: number) => {
      const { ctx, log } = fakeCtx(540, 960);
      drawScene(ctx, spec(), '9:16', t);
      return log.filter((c) => c.startsWith('fillText(')).length;
    };
    expect(at(1500)).toBeGreaterThan(at(0));
  });

  it('asks the host cache whether fonts are ready', () => {
    const asked: string[] = [];
    const cache: SceneCache = {
      image: () => undefined,
      fontReady: (family) => {
        asked.push(family);
        return true;
      },
    };
    drawScene(fakeCtx(720, 720).ctx, spec(), '1:1', 1500, cache);
    expect(asked).toContain(STYLE_PACKS.find((p) => p.id === 'clean')!.fonts.display);
  });
});

describe('fonts', () => {
  it('loads every pack font from the base URL', async () => {
    const urls: string[] = [];
    const added: unknown[] = [];
    class FakeFace {
      constructor(_family: string, src: string) {
        urls.push(src);
      }
      load() {
        return Promise.resolve(this);
      }
    }
    const real = globalThis.FontFace;
    globalThis.FontFace = FakeFace as unknown as typeof FontFace;
    try {
      await loadSceneFonts({ add: (f) => added.push(f) }, 'chrome-extension://abc/');
    } finally {
      globalThis.FontFace = real;
    }
    expect(added).toHaveLength(SCENE_FONTS.length);
    expect(urls[0]).toBe('url(chrome-extension://abc/fonts/inter-latin-400-normal.woff2)');
    for (const p of STYLE_PACKS)
      for (const f of Object.values(p.fonts)) expect(SCENE_FONTS.map((s) => s.family)).toContain(f);
  });
});

describe('renderer', () => {
  it('has no DOM access, so it runs in a worker', () => {
    const dir = join(__dirname, 'render');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/\b(document|window|HTML\w*Element)\b/);
    }
  });
});
