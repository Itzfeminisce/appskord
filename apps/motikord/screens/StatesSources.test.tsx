import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LICENCE_TAG } from '../lib/media/licence';
import { FORMAT_NAME } from '../lib/media/sources/parsers';
import { searchingLine } from '../lib/media/sources/search';
import { MediaSearching } from './StatesMedia';
import { CustomOk, SourceRemoved } from './StatesSources';

describe('Media sources frame copy', () => {
  it('words the Free media progress line for one, two and many sources', () => {
    expect(searchingLine(['Openverse'])).toBe('Searching Openverse…');
    expect(searchingLine(['Openverse', 'Pexels'])).toBe('Searching Openverse and Pexels…');
    expect(searchingLine(['Openverse', 'Pexels', 'NASA Image Library', 'ccMixter', 'Bakery'])).toBe('Searching Openverse, Pexels and 3 more…');
    expect(renderToStaticMarkup(<MediaSearching names={['Pexels']} />)).toContain('Searching Pexels…');
  });
  it('names each format as the frame does', () => {
    expect(Object.values(FORMAT_NAME)).toEqual(['the Openverse API', 'a WordPress media library', 'a Wikimedia or MediaWiki site', 'a Pexels-style API', 'a Pixabay-style API', 'a list of media links']);
  });
  it('tags an item with no licence "Licence unknown" and says so in the test line', () => {
    expect(LICENCE_TAG.unknown).toBe('Licence unknown');
    const html = renderToStaticMarkup(<CustomOk n={24} kind="image" format={FORMAT_NAME.wordpress} licenceKnown={false} thumbs={[]} />);
    expect(html).toContain('Read as a WordPress media library. Licences aren’t listed, so each item is marked “Licence unknown”.');
  });
  it('shows the removed card with Undo', () => {
    const html = renderToStaticMarkup(<SourceRemoved source="Bakery" />);
    for (const t of ['Bakery removed', 'Media you already added from it stays in your clips.', 'Undo']) expect(html).toContain(t);
  });
});
