// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boneLayerId } from '@appskord/motion/rigs';
import { EditorV3 } from './EditorV3';
import { sampleClip } from './fixture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const unmounts: (() => void)[] = [];
afterEach(() => { for (const u of unmounts.splice(0)) u(); vi.restoreAllMocks(); });

async function open(layerId: string, clip = sampleClip()) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await act(async () => { root.render(<EditorV3 clip={clip} initial={{ layerId, tab: 'layer' }} />); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  const button = (text: string) => [...host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.trim() === text);
  const click = async (el: Element | undefined) => {
    expect(el).toBeTruthy();
    await act(async () => { (el as HTMLElement).click(); });
  };
  return { host, button, click };
}

describe('Rig panel', () => {
  it('auto rigs a shape, keys a move into a bone and turns on follow-through', async () => {
    const v = await open('glass');
    expect(v.host.textContent).toContain('Rigs work on shapes and SVGs you add. Photos can’t be rigged.');
    expect(v.button('Draw bones')!.hasAttribute('disabled')).toBe(true);
    await v.click(v.button('Auto rig from shape'));
    expect(v.button('Auto rig from shape')!.getAttribute('aria-pressed')).toBe('true');
    const text = v.host.textContent!;
    for (const s of ['Add bones', 'Auto rig found 4', 'Bones', 'Body', 'root · 3 joints', 'Arm left', 'Lid', '1 joint', 'Moves', 'for Body', 'Squash and stretch', '40%', 'Follow-through', 'Arms and lid settle a beat after the body stops'])
      expect(text, s).toContain(s);
    await v.click([...v.host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Arm right')));
    expect(v.host.textContent).toContain('for Arm right');
    await v.click(v.button('Wave'));
    expect(v.host.textContent).toContain('2 joints · Wave');
    expect(v.button('Wave')!.getAttribute('aria-pressed')).toBe('true');
    for (const m of ['Hop', 'Nod', 'Lean', 'Idle breathe']) expect(v.button(m), m).toBeTruthy();
    expect(boneLayerId('glass', 'arm-right')).toBe('glass~bone~arm-right');
  });

  it('shows only the note on a photo', async () => {
    const clip = sampleClip();
    const glass = clip.v3.scenes[0]!.layers.find((l) => l.id === 'glass')!;
    glass.kind = 'media';
    const v = await open('glass', clip);
    expect(v.host.textContent).toContain('Photos can’t be rigged.');
    expect(v.button('Auto rig from shape')).toBeUndefined();
  });
});
