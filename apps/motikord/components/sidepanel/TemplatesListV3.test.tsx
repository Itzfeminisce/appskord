// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { TEMPLATES } from '../../lib/templates';
import { mount, settle } from '../../test/mountRouter';
import { press } from './mountPanel';

const made = vi.hoisted(() => ({ opened: [] as string[] }));
vi.mock('../../lib/makeClip', async (orig) => ({ ...(await orig<typeof import('../../lib/makeClip')>()), makeFromTemplate: async (t: { id: string }) => { made.opened.push(t.id); return { id: `copy-${t.id}` }; } }));
vi.mock('../../lib/messages', async (orig) => ({ ...(await orig<typeof import('../../lib/messages')>()), send: async () => undefined }));

describe('TemplatesListV3', () => {
  it('shows the frame copy and one card per template', async () => {
    const { host } = await mount(sidepanel, 'TemplatesListV3');
    for (const text of [
      'Templates', 'Each keeps its look. Your brand kit swaps in colours, fonts and logo.', 'All', 'Promo', 'Quote', 'Chart reveal', 'Explainer',
      'Logo intro', 'Captions', 'Social post', 'STYLE · ANY', 'New in v3', `${TEMPLATES.length} templates`, 'Tap one to open your own copy',
    ]) expect(host.textContent, text).toContain(text);
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
    expect(host.querySelectorAll('ul button')).toHaveLength(n);
  });

  it('a tap makes your own copy and opens it', async () => {
    const { host } = await mount(sidepanel, 'TemplatesListV3');
    await press(host, new RegExp(`^${TEMPLATES[0]!.name}, `));
    expect(made.opened).toEqual([TEMPLATES[0]!.id]);
  });

  it('Back returns to Home', async () => {
    const view = await mount(sidepanel, 'HomeV3');
    act(() => view.router.navigate('TemplatesListV3'));
    await settle();
    await press(view.host, 'Back');
    expect(view.router.route.screen).toBe('HomeV3');
  });
});
