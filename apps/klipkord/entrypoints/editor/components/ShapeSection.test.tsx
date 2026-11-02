// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shape, VerticalFit } from '@/lib/project/types';
import { ShapeSection } from './ShapeMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
const edit = vi.fn();
const mount = (shape: Shape, fit: VerticalFit, readOnly = false) => act(() => root.render(<ShapeSection shape={shape} fit={fit} readOnly={readOnly} edit={edit} />));

beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); edit.mockClear(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('ShapeSection', () => {
  it('shows the header, all shapes and the safe-area note', () => {
    mount('16:9', 'bars');
    expect(host.textContent).toContain('this cut');
    for (const s of ['16:9', '9:16', '1:1', '4:5']) expect(host.textContent).toContain(s);
    expect(host.textContent).toContain('safe area');
    expect(host.querySelector('[role="radiogroup"][aria-label="Fit the screen into 9:16"]')).toBeNull();
  });

  it('offers the three fits for 9:16 with the current one checked', () => {
    mount('9:16', 'bars');
    const radios = [...host.querySelectorAll<HTMLElement>('[role="radio"][aria-checked]')].filter((r) => r.closest('[role="radiogroup"][aria-label="Fit the screen into 9:16"]'));
    expect(radios.map((r) => r.textContent)).toEqual([expect.stringContaining('Screen over camera'), expect.stringContaining('Follow the cursor'), expect.stringContaining('Fit with bars')]);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    act(() => { radios[0]!.click(); });
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it('does not edit when read only', () => {
    mount('9:16', 'stack', true);
    act(() => { host.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]')!.click(); });
    expect(edit).not.toHaveBeenCalled();
  });
});
