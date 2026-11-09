// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chartOptionsOf } from '@appskord/motion/charts';
import { devSampleV2 } from '../../lib/editor/v2';
import { restyle, type RestyledClip } from '../../lib/restyle/restyle';
import { expandScene } from '../../lib/templates/expand';
import { getPack } from '../../lib/templates/scenes';
import { chartData, setChart } from './DataScenes';
import { EditorV3 } from './EditorV3';
import { initV3, undoV3 } from './model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEEK = [
  { label: 'Mon', value: 120 },
  { label: 'Tue', value: 180 },
  { label: 'Wed', value: 240 },
  { label: 'Thu', value: 210 },
  { label: 'Fri', value: 300 },
];

/** The sample clip with scene 3 as the Chart template on the frames' week of cups. */
function chartClip(): RestyledClip {
  const recipe = devSampleV2('clip-1');
  recipe.name = 'Morning shift';
  recipe.scenes[2] = expandScene(
    { id: 's3', durationMs: 3500, background: '#FFFFFF', layout: 'center', layers: [], template: 'chart', slots: { title: 'Cups sold by day', bars: WEEK, note: 'Friday is the new Monday.' } },
    getPack('bold')!,
  );
  return restyle({ id: 'clip-1', recipe, history: [], createdAt: 1, updatedAt: 1 }, { now: 1000, changeId: 'restyle-1' });
}

const unmounts: (() => void)[] = [];
afterEach(() => { for (const u of unmounts.splice(0)) u(); vi.restoreAllMocks(); });

async function open(clip: RestyledClip, scene = 2) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await act(async () => { root.render(<EditorV3 clip={clip} initial={{ scene, layerId: clip.v3.scenes[scene]!.layers[0]!.id, tab: 'data' }} />); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  const all = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
  const click = async (el: Element | undefined) => {
    expect(el).toBeTruthy();
    await act(async () => { (el as HTMLElement).click(); });
  };
  return { host, all, click, button: (text: string) => all('button').find((b) => b.textContent?.trim() === text) };
}

describe('data scene edits', () => {
  it('finds the chart rows in the v2 slot and its chart layer', () => {
    const clip = chartClip();
    const data = chartData(clip, 2)!;
    expect(data.rows).toEqual(WEEK);
    expect(data.slot).toBe('bars');
    expect(data.v2).toHaveLength(1);
    expect(chartData(clip, 0)).toBeUndefined();
  });

  it('writes rows and chart layers as one undoable change', () => {
    const st = { ...initV3(chartClip(), 2) };
    const rows = [...WEEK.slice(0, 4), { label: 'Fri', value: 114 }];
    const next = setChart(st, rows, { show: 'line', clone: true, countUp: true, staggerMs: 60 }, { summary: 'Chart: row 5', at: 5 });
    expect(next.errors).toBeUndefined();
    expect(next.clip.recipe.scenes[2]!.slots!.bars).toEqual(rows);
    expect(chartData(next.clip, 2)!.rows).toEqual(rows);
    const v3 = next.clip.v3.scenes[2]!;
    expect(chartOptionsOf(chartData(next.clip, 2)!.base.id, v3.layers)).toEqual({ show: 'line', clone: true, countUp: true, staggerMs: 60 });
    expect(v3.layers.filter((l) => l.id.includes('~card~'))).toHaveLength(5);
    const back = undoV3(next);
    expect(back.clip.recipe.scenes[2]!.slots!.bars).toEqual(WEEK);
    expect(back.clip.v3.scenes[2]).toEqual(st.clip.v3.scenes[2]);
  });
});

describe('Data tab', () => {
  it('shows the frame: rows, Show as, Clone each row, Count up and Stagger', async () => {
    const v = await open(chartClip());
    expect(v.all('[role="tab"]').map((e) => e.textContent)).toEqual(['Scene', 'Layer', 'Motion', 'Data', 'Changes']);
    const text = v.host.querySelector('[role="tabpanel"]')!.textContent!;
    for (const s of ['Chart', '“Cups sold by day”', 'Morning shift · 5 rows', 'Label', 'Value', 'Add row', 'Paste from a spreadsheet', 'Show as', 'Clone each row', 'Each row becomes its own animated card', 'Count up', 'Stagger'])
      expect(text, s).toContain(s);
    expect(v.all('[role="tabpanel"] [role="radio"]').map((e) => e.textContent)).toEqual(['Bars', 'Line', 'Dots', 'Counter grid']);
    expect(v.host.querySelector<HTMLInputElement>('[aria-label="Row 3 value"]')!.value).toBe('240');
    expect(v.host.querySelector<HTMLInputElement>('[aria-label="Stagger"]')!.value).toBe('60 ms');
  });

  it('redraws the chart from Show as, a switch, a typed number and a pasted table', async () => {
    const v = await open(chartClip());
    await v.click(v.all('[role="radio"]').find((e) => e.textContent === 'Counter grid'));
    expect(v.all('[role="tabpanel"] [role="radio"][aria-checked="true"]')[0]!.textContent).toBe('Counter grid');
    await v.click(v.host.querySelector('[role="switch"][aria-label="Count up"]')!);
    expect(v.host.querySelector('[role="switch"][aria-label="Count up"]')!.getAttribute('aria-checked')).toBe('false');
    const value = v.host.querySelector<HTMLInputElement>('[aria-label="Row 4 value"]')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(value, '172');
      value.dispatchEvent(new Event('input', { bubbles: true }));
      value.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(v.host.querySelector<HTMLInputElement>('[aria-label="Row 4 value"]')!.value).toBe('172');
    vi.stubGlobal('navigator', { clipboard: { readText: () => Promise.resolve('Day\tCups\nSat\t90\nSun\t60') } });
    await v.click(v.button('Paste from a spreadsheet'));
    expect(v.host.textContent).toContain('Morning shift · 2 rows');
    expect(v.host.querySelector<HTMLInputElement>('[aria-label="Row 1 label"]')!.value).toBe('Sat');
    await v.click(v.button('Add row'));
    expect(v.host.textContent).toContain('Morning shift · 3 rows');
    await v.click(v.host.querySelector('[aria-label="Remove row 3"]')!);
    expect(v.host.textContent).toContain('Morning shift · 2 rows');
    vi.unstubAllGlobals();
  });

  it('has no Data tab on a scene without a chart', async () => {
    const v = await open(chartClip(), 0);
    expect(v.all('[role="tab"]').map((e) => e.textContent)).toEqual(['Scene', 'Layer', 'Motion', 'Changes']);
  });
});
