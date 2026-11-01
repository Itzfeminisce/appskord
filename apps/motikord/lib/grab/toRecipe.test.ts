import { describe, expect, it } from 'vitest';
import { validateRecipe } from '../recipe/validate';
import type { PageInfo, Pick } from './pick';
import { dataUrlToBlob, picksToAssets, picksToPrompt, picksToRecipe, withPicks } from './toRecipe';

const page: PageInfo = { title: 'Northside Bakery · Sourdough', url: 'https://example-bakery.com/sourdough', site: 'Northside Bakery' };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const picks: Pick[] = [
  { id: 'p1', kind: 'headline', text: 'Fresh sourdough, every morning' },
  { id: 'p2', kind: 'image', name: 'Loaf photo', dataUrl: PNG, width: 340, height: 300 },
  { id: 'p3', kind: 'logo', name: 'Site logo', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
  { id: 'p4', kind: 'quote', text: 'Best bread in town' },
  { id: 'p5', kind: 'table', name: 'Sales', rows: [['Year', 'Sold'], ['2023', '10'], ['2024', '25']] },
  { id: 'p6', kind: 'table', name: 'Team', rows: [['Name', 'Role'], ['Ada', 'Chef']] },
  { id: 'p7', kind: 'text', text: 'Order before 10 pm.' },
  { id: 'p8', kind: 'image', name: 'Broken', failed: true },
];
let n = 0;
const deps = () => { const stored: Record<string, Blob> = {}; return { stored, put: async (path: string, data: Blob) => { stored[path] = data; }, id: () => `a${++n}` }; };

describe('picksToPrompt', () => {
  it('puts words, chart data and attached pictures under the page name', () => {
    const text = picksToPrompt(picks, page);
    expect(text).toContain('From the page "Northside Bakery · Sourdough":');
    expect(text).toContain('Headline: Fresh sourdough, every morning');
    expect(text).toContain('Quote: Best bread in town');
    expect(text).toContain('Chart data (Sales): 2023 10, 2024 25');
    expect(text).toContain('Table (Team): Name | Role; Ada | Chef');
    expect(text).toContain('Pictures from the page, attached: Image "Loaf photo", Logo "Site logo"');
  });
  it('adds nothing when nothing was picked, and keeps your own words first', () => {
    expect(picksToPrompt([], page)).toBe('');
    expect(withPicks('A promo', [], page)).toBe('A promo');
    expect(withPicks('A promo', picks.slice(0, 1), page).startsWith('A promo\n\nFrom the page')).toBe(true);
  });
});

describe('picksToAssets', () => {
  it('stores each readable picture with a page credit and skips the others', async () => {
    const d = deps();
    const { assets, byPick, skipped } = await picksToAssets(picks, page, d);
    expect(assets.map((a) => a.kind)).toEqual(['image', 'logo']);
    expect(skipped.map((p) => p.id)).toEqual(['p8']);
    expect(byPick.p2).toBe(assets[0]);
    expect(assets[0]).toMatchObject({ name: 'Loaf photo', mime: 'image/png', width: 340, height: 300, credit: { source: 'page', url: page.url, title: page.title, author: 'Northside Bakery', licence: 'page' } });
    expect(assets[0]!.opfsPath).toMatch(/^media\/a\d+\.png$/);
    expect(assets[1]!.opfsPath).toMatch(/\.svg$/);
    expect(d.stored[assets[0]!.opfsPath]!.size).toBe(assets[0]!.bytes);
  });
  it('credits to the page with licence page', async () => {
    const { assets } = await picksToAssets(picks.slice(1, 2), page, deps());
    expect(assets[0]!.credit).toEqual({ title: page.title, author: 'Northside Bakery', source: 'page', url: page.url, licence: 'page' });
  });
  it('refuses anything that is not an image', () => {
    expect(dataUrlToBlob('data:text/html;base64,PGI+')).toBeUndefined();
    expect(dataUrlToBlob('https://x.test/a.png')).toBeUndefined();
    expect(dataUrlToBlob(PNG)?.type).toBe('image/png');
  });
});

describe('picksToRecipe', () => {
  it('makes one valid scene per pick, with charts for numeric tables', async () => {
    const { byPick } = await picksToAssets(picks, page, deps());
    const recipe = picksToRecipe(picks, byPick, { id: 'clip-g', name: 'From the page', aspect: '9:16' });
    expect(validateRecipe(recipe)).toEqual([]);
    expect(recipe.scenes).toHaveLength(7);
    const layers = recipe.scenes.flatMap((s) => s.layers);
    expect(layers.filter((l) => l.type === 'chart')).toHaveLength(1);
    expect(layers.find((l) => l.type === 'chart')).toMatchObject({ values: [{ label: '2023', value: 10 }, { label: '2024', value: 25 }] });
    expect(layers.filter((l) => l.type === 'image')).toHaveLength(2);
    expect(layers.find((l) => l.type === 'text')).toMatchObject({ text: 'Fresh sourdough, every morning', role: 'title' });
    expect(Object.values(recipe.assets).every((a) => a.credit?.source === 'page')).toBe(true);
    expect(recipe.type).toBe('chart');
  });
  it('picks a type from what was picked', () => {
    expect(picksToRecipe([picks[3]!], {}, { id: 'c', name: 'n', aspect: '1:1' }).type).toBe('quote');
    expect(picksToRecipe([picks[0]!, picks[6]!], {}, { id: 'c', name: 'n', aspect: '1:1' }).type).toBe('explainer');
  });
});
