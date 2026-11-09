// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { CLIP_TEMPLATES_V3 as TEMPLATES } from '../../lib/templates/v3/clips';
import { mount, settle } from '../../test/mountRouter';
import { press } from './mountPanel';

const made = vi.hoisted(() => ({ opened: [] as string[], saves: 0, sendFails: false }));
vi.mock('../../lib/makeClip', async (orig) => ({ ...(await orig<typeof import('../../lib/makeClip')>()), makeFromTemplateV3: async (t: { id: string }) => { made.opened.push(t.id); made.saves++; return { id: `copy-${t.id}` }; } }));
vi.mock('../../lib/messages', async (orig) => ({ ...(await orig<typeof import('../../lib/messages')>()), send: async () => { if (made.sendFails) throw new Error('no editor'); } }));

describe('TemplatesListV3', () => {
  it('shows the frame copy and one card per template', async () => {
    const { host } = await mount(sidepanel, 'TemplatesListV3');
    for (const text of [
      'Templates', 'Each keeps its look. Your brand kit swaps in colours, fonts and logo.', 'All', 'Promo', 'Quote', 'Chart reveal', 'Explainer',
      'Logo intro', 'Captions', 'Social post', 'STYLE · ANY', 'New in v3', '12 templates', 'Tap one to open your own copy',
    ]) expect(host.textContent, text).toContain(text);
    const cards = [...host.querySelectorAll('ul button')].map((b) => b.getAttribute('aria-label'));
    expect(cards).toEqual([
      'Fieldnote launch, Promo template, 5 scenes, 18 seconds, Studio style. Open your own copy',
      'Customer quote, Quote template, 3 scenes, 12 seconds, Soft style. Open your own copy',
      'Growth chart, Chart reveal template, 4 scenes, 15 seconds, Kinetic style. Open your own copy',
      'Logo pop, Logo intro template, 2 scenes, 6 seconds, Gloss style. Open your own copy',
      'How it works, Explainer template, 4 scenes, 20 seconds, Clean style. Open your own copy',
      'Morning shift drop, Social post template, 3 scenes, 10 seconds, Bold style. Open your own copy',
      'Say it out loud, Captions template, 4 scenes, 15 seconds, Kinetic style. Open your own copy',
      'Quarterly results, Chart reveal template, 5 scenes, 20 seconds, Corporate style. Open your own copy',
      'Glow up, Promo template, 3 scenes, 12 seconds, Playful style. Open your own copy',
      'Three tips, Explainer template, 5 scenes, 20 seconds, Bold style. Open your own copy',
      'Weekend pop-up, Social post template, 4 scenes, 14 seconds, Soft style. Open your own copy',
      'Brand story, Logo intro template, 3 scenes, 10 seconds, Studio style. Open your own copy',
    ]);
    for (const text of ['5 scenes · 18 s', '2 scenes · 6 s', '4 scenes · 14 s']) expect(host.textContent).toContain(text);
    expect([...host.querySelectorAll('[role=group][aria-label=Style] button')].map((b) => b.getAttribute('title')))
      .toEqual(['Clean', 'Bold', 'Playful', 'Corporate', 'Studio', 'Kinetic', 'Gloss', 'Soft']);
    expect(host.querySelectorAll('ul button')).toHaveLength(TEMPLATES.length);
    expect(host.querySelector('[aria-label="Studio (new)"]')).not.toBeNull();
  });

  it('filters by type and says how many are left', async () => {
    const { host } = await mount(sidepanel, 'TemplatesListV3');
    await press(host, 'Quote');
    const n = TEMPLATES.filter((t) => t.type === 'quote').length;
    expect(host.textContent).toContain(`${n} templates`);
    expect(n).toBe(1);
    expect(host.querySelectorAll('ul button')).toHaveLength(n);
    await press(host, 'Chart reveal');
    await press(host, 'Corporate');
    expect(host.textContent).toContain('STYLE · CORPORATE');
    expect([...host.querySelectorAll('ul button')].map((b) => b.getAttribute('aria-label')?.split(',')[0])).toEqual(['Quarterly results']);
  });

  it('a tap makes your own copy and opens it', async () => {
    const { host } = await mount(sidepanel, 'TemplatesListV3');
    await press(host, new RegExp(`^${TEMPLATES[0]!.name}, `));
    expect(made.opened).toEqual([TEMPLATES[0]!.id]);
  });

  it('shows an alert when opening fails and retries with the saved copy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    made.saves = 0; made.sendFails = true;
    const { host } = await mount(sidepanel, 'TemplatesListV3');
    await press(host, new RegExp(`^${TEMPLATES[1]!.name}, `));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Couldn’t make your copy.');
    made.sendFails = false;
    await press(host, 'Try again');
    expect(made.saves).toBe(1);
    expect(host.querySelector('[role=alert]')).toBeNull();
  });

  it('Back returns to Home', async () => {
    const view = await mount(sidepanel, 'HomeV3');
    act(() => view.router.navigate('TemplatesListV3'));
    await settle();
    await press(view.host, 'Back');
    expect(view.router.route.screen).toBe('HomeV3');
  });
});
