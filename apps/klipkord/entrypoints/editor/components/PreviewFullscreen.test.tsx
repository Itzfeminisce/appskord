// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BAR_HIDE_MS, PreviewFullscreen } from './PreviewFullscreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
const onExit = vi.fn();
const mount = (active = true) => act(() => root.render(<PreviewFullscreen active={active} playing out={27_000} length={348_000} onToggle={() => {}} seek={() => {}} onExit={onExit} />));
const bar = () => host.querySelector<HTMLElement>('[role="toolbar"]');

beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); onExit.mockClear(); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('PreviewFullscreen', () => {
  it('draws nothing when not full screen', () => {
    mount(false);
    expect(bar()).toBeNull();
  });

  it('shows the frame bar, hides after 2 s and wakes on movement', () => {
    mount();
    expect(bar()!.dataset.shown).toBe('true');
    expect(bar()!.textContent).toContain('0:27 / 5:48');
    expect(bar()!.textContent).toContain('Esc to go back');
    act(() => { vi.advanceTimersByTime(BAR_HIDE_MS - 1); });
    expect(bar()!.dataset.shown).toBe('true');
    act(() => { vi.advanceTimersByTime(1); });
    expect(bar()!.dataset.shown).toBe('false');
    act(() => { window.dispatchEvent(new MouseEvent('mousemove')); });
    expect(bar()!.dataset.shown).toBe('true');
    act(() => { vi.advanceTimersByTime(BAR_HIDE_MS); });
    expect(bar()!.dataset.shown).toBe('false');
  });

  it('Esc goes back', () => {
    mount();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
