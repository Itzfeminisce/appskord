// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportingCard, ExportingPill, resetExport, setExport, type DoneItem } from './Exporting';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((c) => c()); act(() => resetExport()); });

function render(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(el));
  cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}

const item: DoneItem = { key: 'k', name: 'LinkedIn 30s.mp4', file: new Blob(['x']), size: 6_200_000, label: '“LinkedIn 30s” · 0:30 · 1080p', folder: null };

describe('Exporting', () => {
  it('shows the pill, progress and Done list while an export runs', () => {
    const cancel = vi.fn();
    act(() => setExport({ running: { title: 'Exporting “Full” · 1080p', done: 62, total: 100, lengthMs: 348_000, started: performance.now(), cancel }, done: [item] }));
    const pill = render(<ExportingPill />);
    expect(pill.textContent).toBe('Exporting 62%');
    const card = render(<ExportingCard />);
    const text = card.textContent ?? '';
    for (const s of ['Exporting “Full” · 1080p', 'Cancel', '3:35 of 5:48', 'Done', 'LinkedIn 30s.mp4', 'Saved · 6.2 MB', 'Show', 'Copy link',
      'Keep this tab open until it finishes. Edits you make now go into your next export.']) expect(text).toContain(s);
    act(() => card.querySelector('button')!.click());
    expect(cancel).toHaveBeenCalled();
  });

  it('shows export-failed, drive-uploading and drive-failed', () => {
    act(() => setExport({
      failed: { pct: 62, memory: true, retry: vi.fn() },
      upload: { pct: 48, left: 'About 1 min left.', cancel: vi.fn() },
      uploadFailed: { said: 'quota exceeded', item },
    }));
    const text = render(<ExportingCard />).textContent ?? '';
    for (const s of ['Export stopped at 62%', 'Chrome ran out of memory. Close other tabs or use Fast.', 'Try again', 'Try with Fast',
      'Uploading to Drive · 48%', 'About 1 min left. You can keep editing.',
      "Couldn't upload to Drive", 'The video is saved on this computer. Google said: quota exceeded.', 'Show in folder']) expect(text).toContain(s);
  });

  it('hides the pill when nothing runs', () => {
    expect(render(<ExportingPill />).textContent).toBe('');
  });
});
