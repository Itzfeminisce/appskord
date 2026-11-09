// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { testRecipe } from '../../lib/pipeline/v3/testClip';
import type { Clip } from '../../lib/types';
import { mount } from '../../test/mountRouter';
import { press } from './mountPanel';

const hoisted = vi.hoisted(() => ({ clips: [] as unknown[], sent: [] as unknown[] }));
vi.mock('../../lib/db', async (orig) => ({ ...(await orig<typeof import('../../lib/db')>()), listClips: async () => hoisted.clips, getBrandKit: async () => undefined }));
vi.mock('../../lib/messages', async (orig) => ({ ...(await orig<typeof import('../../lib/messages')>()), send: async (m: unknown) => { hoisted.sent.push(m); return undefined; }, onMessage: () => () => undefined }));

const clip = (id: string, name: string, extra: object = {}, at = Date.now()): Clip => ({
  id, recipe: { ...testRecipe(), id, name }, history: [], createdAt: at, updatedAt: at, ...extra,
}) as Clip;
const v3 = { version: 3, scenes: [], lookGuideId: 'pack-studio', packId: 'studio', fps: 30, finish: { on: true, blur: 0, light: 0, grain: 0, grade: 0 } };

describe('LibraryV3', () => {
  beforeEach(() => {
    const now = Date.now();
    hoisted.sent.length = 0;
    hoisted.clips = [
      clip('a', 'Fieldnote 2.0 launch', { v3 }, now),
      clip('b', 'Morning shift promo', { v3, v2Version: testRecipe() }, now - 1000),
      clip('c', 'Oat latte is back', {}, now - 2000),
      clip('d', 'Q3 in numbers', {}, now - 3000),
    ];
  });

  it('shows the frame copy and marks v2 clips', async () => {
    const { host } = await mount(sidepanel, 'LibraryV3');
    for (const text of ['Your clips', '4 clips', '15 s', 'All', 'v3', 'v2 look', 'Restyled · v2 version in Changes', 'Edited today', 'Clips stay on this computer. A v2 clip keeps its look until you restyle it.'])
      expect(host.textContent, text).toContain(text);
    expect(host.querySelector('[role=group][aria-label=Show]')).not.toBeNull();
    const rows = [...host.querySelectorAll('ul > li')];
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.textContent!.includes('v2 look')).map((r) => r.textContent!.includes('Restyle with v3 motion'))).toEqual([true, true]);
    expect(host.querySelectorAll('ul > li button[aria-label^="Open"]')).toHaveLength(4);
    expect([...host.querySelectorAll('ul > li')].filter((r) => r.textContent!.includes('Restyle with v3 motion'))).toHaveLength(2);
  });

  it('filters to v3 or v2 clips', async () => {
    const { host } = await mount(sidepanel, 'LibraryV3');
    await press(host, 'v2 look');
    expect([...host.querySelectorAll('ul > li')].map((r) => r.querySelector('[aria-label^="Open"]')!.getAttribute('aria-label'))).toEqual(['Open Oat latte is back', 'Open Q3 in numbers']);
    await press(host, 'v3');
    expect(host.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('opens a clip, and a v2 clip’s Restyle with v3 motion opens it in the editor', async () => {
    const { host } = await mount(sidepanel, 'LibraryV3');
    await press(host, 'Open Fieldnote 2.0 launch');
    await press(host, 'Restyle with v3 motion');
    expect(hoisted.sent).toEqual([{ type: 'editor/open', clipId: 'a' }, { type: 'editor/open', clipId: 'c' }]);
  });

  it('Back returns Home', async () => {
    const view = await mount(sidepanel, 'LibraryV3');
    await press(view.host, 'Back');
    expect(view.router.route.screen).toBe('HomeV3');
  });
});
