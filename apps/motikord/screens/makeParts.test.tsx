import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { beatPreview, ScenePreview } from './makeParts';

describe('ScenePreview', () => {
  const recipe = beatPreview({ template: 'list', line: 'classic, rye and seeded', ms: 3000 }, 'bold', '9:16', 'Our loaves')!;
  const html = renderToStaticMarkup(<ScenePreview recipe={recipe} index={0} width={96} height={170} />);
  it('draws the scene as a readable card: kicker, heavy headline and marked items', () => {
    for (const t of ['List', 'Our loaves', 'Classic', 'Rye', 'Seeded']) expect(html).toContain(t);
    expect(html).toContain('font-size:15px');
    expect(html).not.toContain('<canvas');
  });
  it('shows the bold pack as a thin footer band, not a slab', () => {
    expect(html).toMatch(/bottom:0;height:22px;background:#FACC15/);
  });
  it('numbers the items on a Steps scene', () => {
    const steps = beatPreview({ template: 'steps', line: 'pick loaves, choose a time and collect warm', ms: 3000 }, 'bold', '9:16', 'Order ahead')!;
    const out = renderToStaticMarkup(<ScenePreview recipe={steps} index={0} width={44} height={78} />);
    expect(out).toContain('Order ahead');
    expect(out).not.toContain('<canvas');
  });
});
