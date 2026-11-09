import { describe, expect, it } from 'vitest';
import { splitUnits } from '../src/choreo';
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

  it('keeps a word wider than the line on its own line, and shrinks the block to fit the area', () => {
    expect(wrapLines('a Extraordinarily b', mono, 100)).toEqual(['a', 'Extraordinarily', 'b']);
    expect(wrapLines('one\n\n two  three ', mono, Infinity)).toEqual(['one', 'two three']);
    expect(fitScale(1858, 160, { width: 929, height: 1421 })).toBe(0.5);
    expect(fitScale(100, 2842, { width: 929, height: 1421 })).toBe(0.5);
    expect(fitScale(0, 0, { width: 929, height: 1421 })).toBe(Infinity);
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
