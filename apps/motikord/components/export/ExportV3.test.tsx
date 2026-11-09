// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { updateV3 } from '../settings/store';
import ExportV3, { aboutLine, guessSeconds, type ExportV3Props } from './ExportV3';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unmounts: (() => void)[] = [];
beforeEach(() => fakeBrowser.reset());
afterEach(() => { for (const u of unmounts.splice(0)) u(); });

async function open(props: Partial<ExportV3Props> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<ExportV3 clipSeconds={21} {...props} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  const click = async (text: string) => {
    const el = [...host.querySelectorAll<HTMLElement>('button, [role=radio], input')].find((b) => b.textContent?.trim() === text || b.textContent?.trim().startsWith(text) && b.getAttribute('role') === 'radio' || b.getAttribute('aria-label') === text);
    if (!el) throw new Error(`no "${text}"`);
    await act(async () => { el.click(); });
  };
  return { host, click };
}

describe('ExportV3', () => {
  it('shows the frame copy and the export line verbatim', async () => {
    const { host } = await open({ hasCaptions: true, onExport: () => undefined });
    for (const text of [
      'Export', 'Format', 'MP4', 'Plays everywhere', 'WebM', 'Smaller files, for the web', 'GIF', 'Short loops for chats and docs. No sound.',
      'Transparent WebM', 'No background, for other editors', 'Lottie', 'Moving vectors for apps and sites',
      'Sizes', '9:16', 'Stories, Reels, Shorts', '1:1', 'Feeds and posts', '16:9', 'YouTube, slides, websites',
      'Frame rate', '60 fps', 'This computer can', '30 fps', 'Finishing', 'Motion blur, soft light, fine grain and a gentle grade on every export.',
      'Captions', 'Auto captions are on for this clip', 'Burn into the video', 'Separate .srt file', 'Off',
      'Export renders every frame at full quality. A slower computer takes longer, never looks worse.',
      'About 1 min 20 s for 3 sizes on this computer', 'Export 3 videos',
    ]) expect(host.textContent, text).toContain(text);
  });

  it('hides the captions choice when the clip has no captions', async () => {
    expect((await open()).host.textContent).not.toContain('Burn into the video');
  });

  it('takes frame rate and finishing from the saved settings', async () => {
    await updateV3({ fps: 30, finishing: false });
    const { host } = await open();
    expect(host.querySelector('[role=radio][aria-checked=true]:not([aria-label])')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[role=switch]')!.checked).toBe(false);
    expect([...host.querySelectorAll('[role=radiogroup][aria-label="Frame rate"] [role=radio]')].map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  });

  it('exports what was chosen', async () => {
    const onExport = vi.fn();
    const { click } = await open({ hasCaptions: true, onExport });
    await click('GIF');
    await click('1:1');
    await click('30 fps');
    await click('Separate .srt file');
    await click('Export 2 videos');
    expect(onExport).toHaveBeenCalledWith({ kind: 'gif', aspects: ['9:16', '16:9'], fps: 30, finishing: true, captions: 'srt' });
  });

  it('shows progress and Cancel while a run is going', async () => {
    const onCancel = vi.fn();
    const { host, click } = await open({ onExport: () => undefined, progress: { index: 1, total: 3, aspect: '9:16', frame: 640, frames: 1080, finishing: true }, onCancel });
    expect(host.querySelector('[role=status][aria-label="Export progress"]')!.textContent).toBe('Exporting 1 of 3 · 9:16 · frame 640 of 1080 · Finishing onCancel');
    expect(host.querySelector('[role=progressbar]')!.getAttribute('aria-valuenow')).toBe('640');
    await click('Cancel');
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows the 30 fps fallback with its way back to 60', async () => {
    const again = vi.fn();
    const { host, click } = await open({ fallback30: true, onExport60Anyway: again });
    expect(host.textContent).toContain('Exporting at 30 fps');
    expect(host.textContent).toContain('60 fps would take too long on this computer. Every frame is still full quality.');
    await click('Export at 60 anyway');
    expect(again).toHaveBeenCalled();
  });

  it('guesses the time in the frame’s words', () => {
    expect(aboutLine(guessSeconds(21, 3, 60))).toBe('About 1 min 20 s');
    expect(aboutLine(40)).toBe('About 40 s');
    expect(aboutLine(120)).toBe('About 2 min');
  });
});
