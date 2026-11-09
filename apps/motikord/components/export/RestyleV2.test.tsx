// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getV3 } from '../settings/store';
import RestyleV2 from './RestyleV2';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unmounts: (() => void)[] = [];
beforeEach(() => { fakeBrowser.reset(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { for (const u of unmounts.splice(0)) u(); vi.restoreAllMocks(); });

async function open(onRestyle?: (o: { packId: never; keyFramesFirst: boolean }) => Promise<void> | void) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  await act(async () => { root.render(<RestyleV2 name="Morning shift" meta="21 s · 9:16 · Bold" packId="bold" onRestyle={onRestyle as never} onClose={onClose} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  const click = async (text: string) => {
    const el = [...host.querySelectorAll<HTMLElement>('button, [role=radio]')].find((b) => b.textContent?.trim() === text || b.textContent?.trim() === `Aa${text}`);
    if (!el) throw new Error(`no "${text}"`);
    await act(async () => { el.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  };
  return { host, click, onClose };
}

describe('RestyleV2', () => {
  it('shows the frame copy', async () => {
    const { host } = await open();
    for (const text of [
      'Restyle with v3 motion', 'Same words, scenes and media. New motion, depth and finish.', 'Morning shift', 'v2', '21 s · 9:16 · Bold',
      'Before · v2 Bold', 'After · v3 Bold', 'Pack', 'Keep Bold, or pick another of the 8.',
      'Clean', 'Bold', 'Playful', 'Corporate', 'Studio', 'Kinetic', 'Gloss', 'Soft',
      'What changes', 'Motion', 'Camera', 'Depth', 'Finish', 'What stays', 'Words', 'Scenes', 'Media', 'Timing',
      'Show me each key frame first', 'One still per scene in your look. Approve them, then Motikord adds the motion. No AI cost.',
      'Your v2 version stays in', 'Changes', 'Not now', 'Restyle',
    ]) expect(host.textContent, text).toContain(text);
  });

  it('restyles with the picked pack and the saved key-frames switch', async () => {
    const onRestyle = vi.fn();
    const { click } = await open(onRestyle);
    await click('Studio');
    await click('Restyle');
    expect(onRestyle).toHaveBeenCalledWith({ packId: 'studio', keyFramesFirst: true });
  });

  it('turning key frames first off is saved and passed on', async () => {
    const onRestyle = vi.fn();
    const { host, click } = await open(onRestyle);
    await act(async () => { host.querySelector<HTMLInputElement>('input[role=switch]')!.click(); });
    await click('Restyle');
    expect(onRestyle).toHaveBeenCalledWith({ packId: 'bold', keyFramesFirst: false });
    expect((await getV3()).keyFramesFirst).toBe(false);
  });

  it('shows restyle-failed when it fails, and Try again runs it again', async () => {
    const onRestyle = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(undefined);
    const { host, click } = await open(onRestyle);
    await click('Restyle');
    expect(host.textContent).toContain('Restyle didn’t finish');
    expect(host.textContent).toContain('Your v2 clip is unchanged. Try again to restyle it with v3 motion.');
    await click('Try again');
    expect(onRestyle).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain('Restyle didn’t finish');
  });

  it('Not now closes', async () => {
    const { click, onClose } = await open();
    await click('Not now');
    expect(onClose).toHaveBeenCalled();
  });
});
