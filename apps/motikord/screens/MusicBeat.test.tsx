// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const commit = vi.fn(); const close = vi.fn();
const recipe = { scenes: [{ id: 's1', durationMs: 3000, layers: [] }, { id: 's2', durationMs: 2000, layers: [] }], assets: { a: { name: 'Sunny morning', durationMs: 30000 } }, music: { assetId: 'a', volume: 0.5, fadeInMs: 0, fadeOutMs: 0 }, beats: [], mood: 'calm' };
vi.mock('./MediaSearch', () => ({ DialogShell: (p: { children: unknown }) => <div>{p.children as never}</div>, CloseIcon: () => null, openMediaTab: vi.fn(), usePreview: () => ({ toggle: vi.fn(), playing: undefined }), useStoredClip: () => ({ recipe, commit, close }) }));
vi.mock('../entrypoints/editor/router', () => ({ useRouter: () => ({ navigate: vi.fn(), route: { params: {} } }) }));
vi.mock('../lib/makeClip', () => ({ useSettings: () => ({ beatSync: true }) }));
vi.mock('../lib/media', () => ({ getMedia: vi.fn(), putMedia: vi.fn() }));

describe('BeatSync popover parts', () => {
  it('renders track row, mood chips, scene strip, legend and Done', async () => {
    const { default: Music } = await import('./Music');
    const el = document.createElement('div'); document.body.append(el);
    act(() => createRoot(el).render(<Music />));
    const t = el.textContent ?? '';
    for (const w of ['Sunny morning', 'Change', 'Mood', 'Upbeat', 'Calm', 'Warm', 'Dramatic', 'No music', 'Beat', 'Cut snapped to beat', '0:00 – 0:05', 'Done']) expect(t).toContain(w);
    expect(el.querySelector('[aria-label=Scenes]')?.children.length).toBe(2);
    // One now-playing card: the track list and the search links wait behind "Change".
    expect(el.querySelector('[aria-label="Music track"]')).toBeNull();
    expect(t).not.toContain('Search free music');
    const btn = (n: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === n)!;
    act(() => btn('Warm').click());
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ ops: [{ op: 'replace', path: '/mood', value: 'warm' }] }));
    act(() => btn('Change').click());
    expect(el.querySelector('[aria-label="Music track"]')).not.toBeNull();
    expect(el.textContent).toContain('Search free music');
    act(() => btn('Done').click());
    expect(el.querySelector('[aria-label="Music track"]')).toBeNull();
    act(() => btn('Done').click()); expect(close).toHaveBeenCalled();
  });
});
