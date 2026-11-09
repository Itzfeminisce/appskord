import { describe, expect, it } from 'vitest';
import { splitUnits, staggeredMs, typeMs } from '../src/choreo';
import { ease, FEEL } from '../src/curves';
import { frameAt } from '../src/scene';
import {
  axisCoords,
  axisSteps,
  fillScale,
  fitScale,
  fontAxes,
  layoutUnits,
  safeArea,
  wrapLines,
  measureWith,
  unitCount,
  boxRect,
  placeInside,
  safeRect,
  slotArea,
  unitPose,
  unitProgress,
  type AxisFont,
} from '../src/type';
import type { SceneV3 } from '../src/types';

const mono = (s: string): number => s.length * 10;

describe('kinetic type splitting', () => {
  const text = 'Opens at seven on Elm Street\nand stays until the last cup';
  for (const unit of ['letter', 'word', 'line'] as const) {
    it(`lays out the same ${unit}s choreo splits`, () => {
      expect(layoutUnits(text, unit, mono, 40).map((b) => b.text)).toEqual(splitUnits(text, unit));
    });
  }

  it('places letters along the line, centred, skipping spaces', () => {
    const boxes = layoutUnits('Go on', 'letter', mono, 40);
    expect(boxes.map((b) => [b.text, b.x])).toEqual([
      ['G', -25],
      ['o', -15],
      ['o', 5],
      ['n', 15],
    ]);
  });

  it('puts each line one line height lower', () => {
    expect(layoutUnits('Good coffee,\nfast', 'word', mono, 40).map((b) => [b.text, b.line, b.y])).toEqual([
      ['Good', 0, 0],
      ['coffee,', 0, 0],
      ['fast', 1, 40],
    ]);
  });

  it('staggers unit progress 40 ms a letter on the curve', () => {
    const p = unitProgress(3, 'letter', 340, 300, FEEL.snappy.curve);
    expect(p[0]).toBe(1);
    expect(p[1]).toBeCloseTo(1, 10);
    expect(p[2]).toBeCloseTo(ease(FEEL.snappy.curve)(260 / 300), 10);
    expect(unitProgress(2, 'line', 0)).toEqual([0, 0]);
  });

  it('fades letters up and masks lines out of their box', () => {
    expect(unitPose('word', 0, 30)).toEqual({ opacity: 0, dy: 10, clip: false });
    expect(unitPose('word', 1, 30)).toEqual({ opacity: 1, dy: 0, clip: false });
    expect(unitPose('line', 0, 30)).toEqual({ opacity: 1, dy: 30, clip: true });
    expect(unitPose('line', 1, 30).dy).toBe(0);
  });

  it('places each word after the previous word and a space, wrapping inside the safe area', () => {
    const area = safeArea(1080, 1920);
    expect(area).toEqual({ width: 1080 * 0.86, height: 1920 * 0.74 });
    // 40 px a character: 23 characters fit the 928.8 px line.
    const wide = (s: string): number => s.length * 40;
    const text = 'Great coffee, before your first meeting.';
    expect(wrapLines(text, wide, area.width)).toEqual(['Great coffee, before', 'your first meeting.']);
    const boxes = layoutUnits(text, 'word', wide, 80, area.width);
    expect(boxes.map((b) => [b.text, b.line, b.x, b.y])).toEqual(
      [
        ['Great', 0, -400],
        ['coffee,', 0, -160],
        ['before', 0, 160],
        ['your', 1, -380],
        ['first', 1, -180],
        ['meeting.', 1, 60],
      ].map(([t, line, x]) => [t, line, x, (line as number) * 80]),
    );
    for (const line of [0, 1]) {
      const row = boxes.filter((b) => b.line === line);
      row.slice(1).forEach((b, i) => expect(b.x).toBe(row[i]!.x + row[i]!.width + wide(' ')));
      expect(-row[0]!.x).toBe(row.at(-1)!.x + row.at(-1)!.width);
      expect(row.at(-1)!.x + row.at(-1)!.width - row[0]!.x).toBeLessThanOrEqual(area.width);
    }
    expect(layoutUnits(text, 'line', wide, 80, area.width).map((b) => b.text)).toEqual(
      wrapLines(text, wide, area.width),
    );
  });

  it('breaks a word wider than the line between graphemes, and shrinks the block to fit the area', () => {
    expect(wrapLines('a Extraordinarily b', mono, 100)).toEqual(['a', 'Extraordin', 'arily b']);
    expect(wrapLines('one\n\n two  three ', mono, Infinity)).toEqual(['one', 'two three']);
    // CJK has no spaces: it still wraps, and an accent or emoji is never split from its letter.
    expect(wrapLines('今日は良い天気ですね', mono, 40)).toEqual(['今日は良', 'い天気で', 'すね']);
    expect(
      wrapLines('e\u0301e\u0301e\u0301 👍🏽👍🏽', (s) => [...new Intl.Segmenter().segment(s)].length * 10, 20),
    ).toEqual(['e\u0301e\u0301', 'e\u0301', '👍🏽👍🏽']);
    expect(fitScale(1858, 160, { width: 929, height: 1421 })).toBe(0.5);
    expect(fitScale(100, 2842, { width: 929, height: 1421 })).toBe(0.5);
    expect(fitScale(0, 0, { width: 929, height: 1421 })).toBe(Infinity);
  });

  it('never makes NaN from a frame with no size', () => {
    for (const [w, h] of [
      [0, 0],
      [1080, 0],
      [0, 1920],
      [NaN, 1],
    ]) {
      const area = safeArea(w!, h!);
      const s = fitScale(400, 80, area);
      expect(Number.isNaN(s)).toBe(false);
      expect(wrapLines('Fresh sourdough today', mono, area.width)).toEqual(['Fresh sourdough today']);
    }
    expect(fitScale(400, 80, { width: 0, height: 0 })).toBe(Infinity);
  });

  it('staggers wrapped lines and broken words as the units choreo counts', () => {
    const text = 'Great coffee, before your first meeting.\nEvery day';
    const wide = (s: string): number => s.length * 40;
    for (const unit of ['letter', 'word', 'line'] as const) {
      const boxes = layoutUnits(text, unit, wide, 80, 400);
      expect(unitCount(boxes)).toBe(splitUnits(text, unit).length);
      expect(new Set(boxes.map((b) => b.line)).size).toBeGreaterThan(2);
    }
    const lines = layoutUnits(text, 'line', wide, 80, 400);
    expect(lines.map((b) => [b.text, b.order])).toEqual([
      ['Great', 0],
      ['coffee,', 0],
      ['before', 0],
      ['your first', 0],
      ['meeting.', 0],
      ['Every day', 1],
    ]);
    // Pieces of one broken word enter as one word.
    expect(layoutUnits('a Extraordinarily b', 'word', mono, 40, 100).map((b) => [b.text, b.order])).toEqual([
      ['a', 0],
      ['Extraordin', 1],
      ['arily', 1],
      ['b', 2],
    ]);
    // So the entrance takes as long as choreo says, however the lines wrap.
    expect(typeMs(text, 'line', 600)).toBe(staggeredMs(600, 2, 120));
    const progress = unitProgress(unitCount(lines), 'line', typeMs(text, 'line', 600), 600);
    expect(lines.every((b) => progress[b.order] === 1)).toBe(true);
  });

  it('scales to fill the frame width between insets', () => {
    expect(fillScale(540, 1080)).toBe(2);
    expect(fillScale(500, 1080, 40)).toBe(2);
    expect(fillScale(0)).toBe(1);
  });
});

const fakeFont = (axes: [string, number, number, number][]): AxisFont & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    tables: {
      fvar: {
        axes: axes.map(([tag, minValue, defaultValue, maxValue]) => ({ tag, minValue, defaultValue, maxValue })),
      },
    },
    getPath: () => ({ commands: [] }),
    getAdvanceWidth: (text, size, options) => {
      calls.push(options?.variation);
      return text.length * size * ((options?.variation?.wdth ?? 100) / 100);
    },
  };
};

describe('layer placement', () => {
  const frame = { width: 1080, height: 1920 };
  const safe = safeRect(1080, 1920);

  it('reads a v2 layout box (fractions, top-left) as a rect around the frame centre', () => {
    expect(safe).toEqual({ x: -540 + 75.6, y: -960 + 192, width: 1080 * 0.86, height: 1920 * 0.74 });
    const kicker = boxRect({ x: 0.07, y: 0.16, w: 0.86, h: 0.04 }, frame);
    const headline = boxRect({ x: 0.07, y: 0.22, w: 0.86, h: 0.44 }, frame);
    const centre = (r: typeof kicker) => r.y + r.height / 2;
    expect(kicker.x + kicker.width / 2).toBeCloseTo(0, 6);
    expect(centre(kicker)).toBeCloseTo(-960 + 0.18 * 1920, 6);
    expect(centre(headline)).toBeCloseTo(-960 + 0.44 * 1920, 6);
    // Separate layers rest apart: the kicker's box ends above the headline's.
    expect(kicker.y + kicker.height).toBeLessThanOrEqual(headline.y + 1e-9);
  });

  it('wraps text to its box and keeps at least one line of height', () => {
    const steps = boxRect({ x: 0.3828, y: 0.3, w: 0.5472, h: 0.13 }, frame);
    expect(slotArea(steps, safe, 60)).toEqual({ width: steps.width, height: steps.height });
    expect(slotArea({ ...steps, height: 10 }, safe, 60).height).toBe(60);
    expect(slotArea({ x: -600, y: 0, width: 1200, height: 4000 }, safe, 60)).toEqual({
      width: safe.width,
      height: safe.height,
    });
  });

  it('moves an off-centre block just inside the safe area, and centres one too big for it', () => {
    expect(placeInside({ x: 0, y: 100 }, { width: 200, height: 100 }, safe)).toEqual({ x: 0, y: 100 });
    const near = placeInside({ x: 500, y: -940 }, { width: 200, height: 100 }, safe);
    expect(near.x + 100).toBeCloseTo(safe.x + safe.width, 6);
    expect(near.y - 50).toBeCloseTo(safe.y, 6);
    const low = placeInside({ x: -500, y: 940 }, { width: 200, height: 100 }, safe);
    expect(low.x - 100).toBeCloseTo(safe.x, 6);
    expect(low.y + 50).toBeCloseTo(safe.y + safe.height, 6);
    expect(placeInside({ x: 300, y: 0 }, { width: 2000, height: 10 }, safe).x).toBeCloseTo(safe.x + safe.width / 2, 6);
    expect(placeInside({ x: 5, y: 6 }, { width: 10, height: 10 }, safeRect(0, 0))).toEqual({ x: 5, y: 6 });
  });
});

describe('variable axes', () => {
  const archivo = fakeFont([
    ['wght', 100, 400, 900],
    ['wdth', 62, 100, 125],
  ]);

  it('reads the font axes', () => {
    expect(fontAxes(archivo)).toEqual([
      { tag: 'wght', min: 100, default: 400, max: 900 },
      { tag: 'wdth', min: 62, default: 100, max: 125 },
    ]);
    expect(fontAxes({ ...archivo, tables: {} })).toEqual([]);
  });

  it('clamps to MotionV3 ranges and to the font, skipping missing axes', () => {
    const axes = fontAxes(archivo);
    expect(axisCoords(1000, 40, axes)).toEqual({ wght: 800, wdth: 62 });
    expect(axisCoords(549.6, 112, axes)).toEqual({ wght: 550, wdth: 112 });
    const weightOnly = fontAxes(fakeFont([['wght', 400, 400, 700]]));
    expect(axisCoords(300, 125, weightOnly)).toEqual({ wght: 400 });
  });

  it('steps the axis strips as drawn', () => {
    expect(axisSteps(300, 800, 5)).toEqual([300, 425, 550, 675, 800]);
    expect(axisSteps(62, 125, 2)).toEqual([62, 125]);
  });

  it('follows the weight and width tracks through frameAt', () => {
    const scene: SceneV3 = {
      version: 3,
      id: 's',
      templateId: 't',
      ms: 1000,
      camera: { move: 'hold', amount: 0 },
      transition: { kind: 'cut' },
      layers: [
        {
          id: 'shift',
          kind: 'text',
          depth: 'front',
          type: { unit: 'word' },
          tracks: {
            weight: [
              { t: 0, v: 300 },
              { t: 400, v: 800, curve: { kind: 'bezier', p: [0, 0, 1, 1] } },
            ],
            width: [
              { t: 0, v: 62 },
              { t: 400, v: 125, curve: { kind: 'bezier', p: [0, 0, 1, 1] } },
            ],
          },
        },
      ],
    };
    const at = (t: number) => {
      const { weight, width } = frameAt(scene, t).layers[0]!.props;
      return axisCoords(weight, width, fontAxes(archivo));
    };
    expect(at(0)).toEqual({ wght: 300, wdth: 62 });
    expect(at(100).wght).toBeCloseTo(425, 0);
    expect(at(400)).toEqual({ wght: 800, wdth: 125 });
    expect(at(400)).toEqual(at(400));
  });

  it('measures at the axes it is given', () => {
    expect(measureWith(archivo, 10, { wdth: 125 })('WIDE')).toBe(50);
    expect(archivo.calls.at(-1)).toEqual({ wdth: 125 });
  });
});

describe('variable type outlines', () => {
  it('cuts the bundled font into three.js shapes with holes', async () => {
    const { readFileSync } = await import('node:fs');
    const { parse } = await import('opentype.js');
    const { axisShapes, AxisText } = await import('../src/type');
    const buffer = readFileSync(new URL('../src/assets/archivo-black.woff', import.meta.url));
    const font = parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    ) as unknown as AxisFont;
    const shapes = axisShapes(font, 'OA', 100, {});
    expect(shapes).toHaveLength(2);
    expect(shapes.every((s) => s.holes.length >= 1)).toBe(true);
    const text = new AxisText(font, 'OPEN', 100);
    text.update({ weight: 800, opacity: 0.5 });
    expect(text.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(text.material.opacity).toBe(0.5);
  });
});
