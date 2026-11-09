// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from '@appskord/platform/router';
import { sampleClip } from '../../components/editor/fixture';
import type { Clip } from '../../lib/types';

const clips = new Map<string, Clip>();
vi.mock('../../lib/db', async (orig) => ({ ...(await orig<object>()), getClip: async (id: string) => clips.get(id), putClip: async () => undefined }));
vi.mock('../../lib/look/store', async (orig) => ({ ...(await orig<object>()), getLook: async () => undefined }));
vi.mock('../../screens/editor/Editor', async (orig) => ({ ...(await orig<object>()), default: () => <p>v2 editor</p> }));

import { editor } from './router';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unmounts: (() => void)[] = [];
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { for (const u of unmounts.splice(0)) u(); vi.restoreAllMocks(); });

const seen: { screen?: string } = {};
function Probe() { seen.screen = editor.useRouter().route.screen; return null; }

async function openEditor(clipId: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <editor.RouterProvider initial={{ screen: 'Editor', params: { clipId } }} history={createMemoryHistory({ initialEntries: ['/'] })}>
        <editor.Outlet />
        <Probe />
      </editor.RouterProvider>,
    );
  });
  // The v3 editor is a lazy chunk: wait for either editor to show.
  for (let i = 0; i < 100 && !host.textContent; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}

describe('Editor route', () => {
  it('opens a v3 clip in the v3 editor', async () => {
    const v3 = sampleClip();
    clips.set(v3.id, v3);
    const host = await openEditor(v3.id);
    expect([...host.querySelectorAll('[aria-label="Edit"] [role="tab"]')].map((e) => e.textContent)).toEqual(['Scene', 'Layer', 'Motion', 'Changes']);
    expect(host.textContent).not.toContain('v2 editor');
  });

  it('opens a v2 clip in the v2 editor unchanged', async () => {
    const { v3: _v3, v2Version: _v2, ...v2 } = sampleClip();
    clips.set('v2-clip', { ...v2, id: 'v2-clip' });
    const host = await openEditor('v2-clip');
    expect(host.textContent).toBe('v2 editor');
  });

  it('sends a v3 clip’s Export to ExportV3 and Check to the v3 quality check', async () => {
    const v3 = sampleClip();
    clips.set(v3.id, v3);
    for (const [label, screen] of [['Export', 'ExportV3'], ['Check', 'CriticV3']] as const) {
      const host = await openEditor(v3.id);
      const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label))!;
      await act(async () => { button.click(); });
      expect(seen.screen).toBe(screen);
    }
  });
});
