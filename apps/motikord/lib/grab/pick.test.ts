import { describe, expect, it } from 'vitest';
import { classifyElement, extractPick, grabBlocked, hoverLabel, dataUrlBytes, MAX_IMAGE_BYTES, pageCredit, parseNumber, pickedLabel, tableToChart, type ElementInfo } from './pick';

const el = (over: Partial<ElementInfo>): ElementInfo => ({ tag: 'div', text: '', childElements: 0, hint: '', insideHeader: false, width: 300, height: 100, ...over });

describe('classifyElement', () => {
  it('knows each kind of element', () => {
    expect(classifyElement(el({ tag: 'h1', text: 'Fresh sourdough' }))).toBe('headline');
    expect(classifyElement(el({ tag: 'div', role: 'heading', text: 'Title' }))).toBe('headline');
    expect(classifyElement(el({ tag: 'blockquote', text: 'Best bread in town' }))).toBe('quote');
    expect(classifyElement(el({ tag: 'p', text: 'Slow-fermented for 36 hours.' }))).toBe('text');
    expect(classifyElement(el({ tag: 'img', src: 'https://x.test/loaf.jpg', width: 340, height: 300 }))).toBe('image');
    expect(classifyElement(el({ tag: 'table', rows: [['Year', 'Sales'], ['2024', '10']] }))).toBe('table');
  });
  it('calls a picture a logo by its name or by where it sits', () => {
    expect(classifyElement(el({ tag: 'img', hint: 'site-logo.svg', width: 120, height: 40 }))).toBe('logo');
    expect(classifyElement(el({ tag: 'img', insideHeader: true, width: 160, height: 60 }))).toBe('logo');
    expect(classifyElement(el({ tag: 'svg', hint: 'brand', width: 100, height: 100 }))).toBe('logo');
    expect(classifyElement(el({ tag: 'img', insideHeader: true, width: 900, height: 500 }))).toBe('image');
    expect(classifyElement(el({ tag: 'img', hint: 'site-logo', width: 34, height: 34 }))).toBe('logo');
    expect(classifyElement(el({ tag: 'img', hint: 'site-logo', width: 8, height: 8 }))).toBeUndefined();
  });
  it('ignores what is not worth picking', () => {
    expect(classifyElement(el({ tag: 'img', width: 12, height: 12 }))).toBeUndefined();
    expect(classifyElement(el({ tag: 'h2', text: '   ' }))).toBeUndefined();
    expect(classifyElement(el({ tag: 'div', childElements: 3, text: 'A wrapper with a lot of words inside it' }))).toBeUndefined();
    expect(classifyElement(el({ tag: 'span', text: 'Order' }))).toBeUndefined();
    expect(classifyElement(el({ tag: 'span', text: 'Order before 10 pm for pickup' }))).toBe('text');
    expect(classifyElement(el({ tag: 'table', rows: [] }))).toBeUndefined();
  });
  it('words the labels as the frame does', () => {
    expect(hoverLabel('text')).toBe('Text · Click to add');
    expect(pickedLabel('headline')).toBe('Headline · Picked');
  });
});

describe('extractPick', () => {
  it('takes the words of a headline with spaces squashed', () => {
    expect(extractPick(el({ tag: 'h1', text: '  Fresh\n  sourdough,   every morning ' }), 'headline', 'p1')).toEqual({ id: 'p1', kind: 'headline', text: 'Fresh sourdough, every morning' });
  });
  it('names a picture by its alt text, its file or its role', () => {
    expect(extractPick(el({ tag: 'img', alt: 'Loaf photo', src: 'https://x.test/a/b.jpg', width: 340.4, height: 300 }), 'image', 'p2')).toMatchObject({ name: 'Loaf photo', src: 'https://x.test/a/b.jpg', width: 340 });
    expect(extractPick(el({ tag: 'img', src: 'https://x.test/a/loaf%20one.jpg' }), 'image', 'p3').name).toBe('loaf one.jpg');
    expect(extractPick(el({ tag: 'svg' }), 'logo', 'p4').name).toBe('Site logo');
  });
  it('keeps a table’s cells and names it by its caption or header', () => {
    const rows = [[' Year ', 'Sales'], ['', ''], ['2024', ' 10 ']];
    expect(extractPick(el({ tag: 'table', rows, caption: 'Yearly sales' }), 'table', 'p5')).toMatchObject({ name: 'Yearly sales', rows: [['Year', 'Sales'], ['2024', '10']] });
    expect(extractPick(el({ tag: 'table', rows }), 'table', 'p6').name).toBe('Year, Sales');
  });
});

describe('tables as charts', () => {
  it('reads numbers with money, commas and percent signs', () => {
    expect(parseNumber('$1,200.50')).toBe(1200.5);
    expect(parseNumber(' 12% ')).toBe(12);
    expect(parseNumber('−4')).toBe(-4);
    expect(parseNumber('about 4')).toBeUndefined();
    expect(parseNumber('')).toBeUndefined();
  });
  it('turns a headed table into labelled values', () => {
    expect(tableToChart([['Year', 'Sales'], ['2023', '10'], ['2024', '$25']])).toEqual([{ label: '2023', value: 10 }, { label: '2024', value: 25 }]);
  });
  it('uses the words column as labels and the first all-number column as values', () => {
    expect(tableToChart([['Loaf', 'Note', 'Sold'], ['Rye', 'new', '1,200'], ['Spelt', 'old', '800']])).toEqual([{ label: 'Rye', value: 1200 }, { label: 'Spelt', value: 800 }]);
  });
  it('numbers the rows when there is no words column', () => {
    expect(tableToChart([['3', '4'], ['5', '6']])).toEqual([{ label: '1', value: 3 }, { label: '2', value: 5 }]);
  });
  it('is undefined when the table is not numeric', () => {
    expect(tableToChart([['Name', 'Role'], ['Ada', 'Chef']])).toBeUndefined();
    expect(tableToChart([['Only one column'], ['x']])).toBeUndefined();
    expect(tableToChart([['A', 'B'], ['x', '1'], ['y', 'n/a']])).toBeUndefined();
  });
  it('keeps the first eight rows', () => {
    const rows = [['n', 'v'], ...Array.from({ length: 12 }, (_, i) => [`r${i}`, String(i)])];
    expect(tableToChart(rows)).toHaveLength(8);
  });
});

describe('pages and credits', () => {
  it('refuses Chrome’s own pages, the Web Store and PDFs', () => {
    for (const url of ['chrome://extensions', 'chrome-extension://abc/x.html', 'https://chromewebstore.google.com/detail/x', 'https://chrome.google.com/webstore/detail/x', 'https://x.test/paper.PDF', 'about:blank', 'file:///tmp/a.html', 'not a url'])
      expect(grabBlocked(url), url).toBe(true);
    for (const url of ['https://example.com/a', 'http://localhost:8000/', undefined]) expect(grabBlocked(url), String(url)).toBe(false);
  });
  it('credits a picture to the page', () => {
    const page = { title: 'Northside Bakery · Sourdough', url: 'https://example-bakery.com/sourdough', site: 'Northside Bakery' };
    expect(pageCredit(page, { id: 'p', kind: 'image' })).toEqual({ title: 'Northside Bakery · Sourdough', author: 'Northside Bakery', source: 'page', url: page.url, licence: 'page' });
  });
  it('counts the bytes a data URL holds', () => {
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/svg+xml,<svg/>')).toBe(6);
    expect(dataUrlBytes(`data:image/png;base64,${'A'.repeat(16_100_000)}`)).toBeGreaterThan(MAX_IMAGE_BYTES);
  });
});
