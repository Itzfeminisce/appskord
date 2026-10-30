import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Item } from './Credits';
import type { Asset } from '../lib/types';

describe('Credits row for a web page picture', () => {
  const asset: Asset = { id: 'p', kind: 'image', name: 'Bakery', mime: 'image/jpeg', bytes: 1, opfsPath: 'media/p.jpg', credit: { title: 'Bakery counter', author: 'Bakery Site', source: 'page', url: 'https://bakery.example/counter', licence: 'page' } };
  const html = renderToStaticMarkup(<Item row={{ asset, credit: asset.credit!, need: 'optional', source: 'bakery.example', licence: 'Web page' }} />);
  it('shows the title, the site and the amber check line with the optional pill', () => {
    expect(html).toContain('Bakery counter');
    expect(html).toContain('From Bakery Site');
    expect(html).toContain('Check you may use it.');
    expect(html).toContain('var(--warning-ink)');
    expect(html).toContain('Credit optional');
  });
  it('names no licence and never says needed', () => {
    expect(html).not.toContain('Web page');
    expect(html).not.toContain('Credit needed');
  });
});
