import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Layer, Recipe, Scene } from '../types';

// HANDOFF Performance: preview at 30 fps for a 3-scene, 10-layer clip at 720p. Runs in real Chromium when one is installed.
const PLAYWRIGHT = [process.env.MOTIKORD_PLAYWRIGHT, '/opt/node-tools/node_modules/playwright/index.mjs'].find((p) => p && existsSync(p));
const TARGET_FPS = 30;

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const m = (preset: string, feel: 'smooth' | 'snappy' | 'bouncy' | 'steady', durationMs: number) => ({ preset, feel, durationMs });

function benchScene(n: number): Scene {
  const base = { startMs: 0, endMs: 5000, opacity: 1 };
  const layers: Layer[] = [
    { ...base, id: `bg${n}`, name: 'Background', type: 'image', assetId: 'bg', fit: 'cover', box: box(0, 0, 1, 1), in: m('fade-in', 'smooth', 600) },
    { ...base, id: `ph${n}`, name: 'Photo', type: 'image', assetId: 'photo', fit: 'contain', box: box(0.55, 0.15, 0.38, 0.5), in: m('slide-in', 'snappy', 700), during: m('bounce', 'smooth', 1600) },
    { ...base, id: `card${n}`, name: 'Card', type: 'shape', shape: 'rect', fill: '#111114', radius: 32, box: box(0.06, 0.12, 0.45, 0.5), in: m('grow-in', 'bouncy', 600) },
    { ...base, id: `dot${n}`, name: 'Dot', type: 'shape', shape: 'circle', fill: '#BE185D', box: box(0.8, 0.7, 0.1, 0.18), in: m('pop-in', 'bouncy', 500), out: m('fade-out', 'smooth', 400) },
    { ...base, id: `rule${n}`, name: 'Rule', type: 'shape', shape: 'line', fill: '#FFFFFF', box: box(0.08, 0.62, 0.4, 0.006), in: m('wipe-in', 'smooth', 800) },
    { ...base, id: `glow${n}`, name: 'Glow', type: 'shape', shape: 'rect', fill: '#FDF2F8', radius: 12, box: box(0.6, 0.72, 0.15, 0.08), during: m('bounce', 'steady', 900) },
    { ...base, id: `title${n}`, name: 'Title', type: 'text', role: 'title', text: `Spring sale ${n + 1}`, font: 'Geist', sizePx: 96, weight: 700, colour: '#FFFFFF', align: 'left', lineHeight: 1.1, box: box(0.08, 0.16, 0.4, 0.22), in: m('rise-in', 'smooth', 600), out: m('fade-out', 'smooth', 400) },
    { ...base, id: `body${n}`, name: 'Body', type: 'text', role: 'body', text: 'Everything in the shop is made on your computer this week only', font: 'Geist', sizePx: 40, weight: 400, colour: '#E8E8EB', align: 'left', lineHeight: 1.3, box: box(0.08, 0.4, 0.4, 0.2), in: m('blur-in', 'smooth', 700) },
    { ...base, id: `cap${n}`, name: 'Caption', type: 'text', role: 'caption', text: 'Ends Sunday', font: 'Geist', sizePx: 36, weight: 600, colour: '#FFFFFF', align: 'center', lineHeight: 1.2, background: '#BE185D', box: box(0.08, 0.72, 0.25, 0.1), in: m('type-on', 'steady', 1200) },
    { ...base, id: `chart${n}`, name: 'Chart', type: 'chart', chart: 'bar', colour: '#FFFFFF', values: [{ label: 'Mon', value: 3 }, { label: 'Tue', value: 5 }, { label: 'Wed', value: 4 }, { label: 'Thu', value: 8 }], box: box(0.55, 0.68, 0.2, 0.25), in: m('fade-in', 'smooth', 800) },
  ];
  return { id: `s${n}`, durationMs: 5000, background: '#1F1F24', layout: n === 1 ? 'split' : 'center', layers };
}

const asset = (id: string) => ({ id, kind: 'image' as const, name: id, mime: 'image/png', bytes: 1, width: 1920, height: 1080, opfsPath: id });
const benchRecipe: Recipe = { version: 1, id: 'bench', name: 'Bench', type: 'promo', aspect: '16:9', scenes: [0, 1, 2].map(benchScene), assets: { bg: asset('bg'), photo: asset('photo') } };

async function bundle(): Promise<string> {
  const { rolldown } = await import('rolldown');
  const dir = __dirname;
  const b = await rolldown({
    input: 'bench-entry',
    plugins: [{
      name: 'bench-entry',
      resolveId: (id) => (id === 'bench-entry' ? id : null),
      load: (id) => (id === 'bench-entry' ? `export { drawFrame } from ${JSON.stringify(join(dir, 'drawFrame.ts'))}; export { MediaCache } from ${JSON.stringify(join(dir, 'cache.ts'))};` : null),
    }],
  });
  const { output } = await b.generate({ format: 'iife', name: 'R' });
  return output[0].code;
}

describe.skipIf(!PLAYWRIGHT)('render bench', () => {
  it(`draws 3 scenes and 10 layers at 720p at ${TARGET_FPS} fps or better`, async () => {
    const { chromium } = await import(/* @vite-ignore */ PLAYWRIGHT!);
    const browser = await chromium.launch({ args: ['--headless=new'] });
    try {
      const page = await browser.newPage();
      await page.addScriptTag({ content: await bundle() });
      const r: { drawMs: number; p95: number; fps: number } = await page.evaluate(async (recipe: Recipe) => {
        const { drawFrame, MediaCache } = (globalThis as unknown as { R: typeof import('./drawFrame') & typeof import('./cache') }).R;
        const picture = (hue: number) => {
          const c = new OffscreenCanvas(1920, 1080);
          const g = c.getContext('2d')!;
          const grad = g.createLinearGradient(0, 0, 1920, 1080);
          grad.addColorStop(0, `hsl(${hue} 70% 40%)`);
          grad.addColorStop(1, `hsl(${hue + 80} 70% 20%)`);
          g.fillStyle = grad;
          g.fillRect(0, 0, 1920, 1080);
          return c.transferToImageBitmap();
        };
        const cache = new MediaCache();
        cache.setImage('bg', picture(200));
        cache.setImage('photo', picture(20));
        const canvas = new OffscreenCanvas(1280, 720);
        const ctx = canvas.getContext('2d')!;
        const frames = 15 * 30;
        // The 1 px read forces the GPU to finish each frame, so the time includes rasterising it.
        const one = (i: number) => { drawFrame(ctx, recipe, '16:9', (i * 1000) / 30, cache); ctx.getImageData(0, 0, 1, 1); };
        for (let i = 0; i < 30; i++) one(i);
        const times: number[] = [];
        for (let i = 0; i < frames; i++) { const t0 = performance.now(); one(i); times.push(performance.now() - t0); }
        const drawMs = times.reduce((a, b) => a + b, 0) / frames;
        const p95 = [...times].sort((a, b) => a - b)[Math.floor(frames * 0.95)]!;
        return { drawMs, p95, fps: 1000 / drawMs };
      }, benchRecipe);
      console.log(`Motikord bench: 720p, 3 scenes x 10 layers: ${r.drawMs.toFixed(2)} ms a frame (p95 ${r.p95.toFixed(2)} ms), ${r.fps.toFixed(0)} fps`);
      expect(r.fps).toBeGreaterThanOrEqual(TARGET_FPS);
      expect(r.p95).toBeLessThan(1000 / TARGET_FPS);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
