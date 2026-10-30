import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import StatesCreate, { GrabNotAllowed, GrabNothingPicked } from '../../screens/StatesCreate';

describe('Grab state cards', () => {
  it('words grab-not-allowed and grab-nothing-picked as the frame does', () => {
    const a = renderToStaticMarkup(<GrabNotAllowed />);
    expect(a).toContain('Motikord can’t pick from this page');
    expect(a).toContain('Chrome doesn’t let extensions read its own pages or the Web Store. Open another site and try again.');
    const b = renderToStaticMarkup(<GrabNothingPicked />);
    expect(b).toContain('Nothing picked yet');
    expect(b).toContain('Click a headline, image, logo, quote or table on the page.');
  });
  it('lists both on the StatesCreate sheet', () => {
    const sheet = renderToStaticMarkup(<StatesCreate />);
    expect(sheet).toContain('grab-not-allowed · Grab from the page');
    expect(sheet).toContain('grab-nothing-picked · Grab from the page');
  });
});
