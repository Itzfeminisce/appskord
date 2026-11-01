// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/settings';
import type { Settings as S } from '../lib/types';
import { PrivacyView } from './Privacy';
import { criticStatus, LookSection } from './Settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base: S = { ...DEFAULT_SETTINGS, provider: 'openai', ai: 'cloud', models: { openai: 'gpt-4o' } } as S;

function mount(s: S) {
  const set = vi.fn(); const onImageKey = vi.fn();
  const el = document.createElement('div'); document.body.append(el);
  act(() => createRoot(el).render(<LookSection s={s} set={set} onImageKey={onImageKey} />));
  return { el, set, onImageKey };
}
const sw = (el: HTMLElement, i: number) => el.querySelectorAll<HTMLInputElement>('input[role=switch]')[i]!;

describe('Look and quality', () => {
  it('saves each switch and shows On/Off', () => {
    const { el, set, onImageKey } = mount(base);
    expect(el.textContent).toContain('Look and quality');
    act(() => sw(el, 0).click()); expect(set).toHaveBeenLastCalledWith({ critic: false });
    act(() => sw(el, 1).click()); expect(set).toHaveBeenLastCalledWith({ beatSync: true });
    expect(onImageKey).not.toHaveBeenCalled();
    act(() => sw(el, 2).click()); expect(set).toHaveBeenLastCalledWith({ aiImages: true });
    expect(onImageKey).toHaveBeenCalledOnce();
  });
  it('turning AI images off does not open the key screen', () => {
    const { el, set, onImageKey } = mount({ ...base, aiImages: true });
    act(() => sw(el, 2).click()); expect(set).toHaveBeenLastCalledWith({ aiImages: false });
    expect(onImageKey).not.toHaveBeenCalled();
  });
  it('saves the default style and pace', () => {
    const { el, set } = mount(base);
    const sel = el.querySelector('select')!;
    act(() => { sel.value = 'bold'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(set).toHaveBeenLastCalledWith({ look: { style: 'bold' } });
    act(() => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Fast')!.click());
    expect(set).toHaveBeenLastCalledWith({ look: { pace: 'fast' } });
  });
  it('says whether the model can see images', () => {
    expect(criticStatus(base)).toEqual({ ready: true, text: "OpenAI's model can see images · Ready" });
    expect(criticStatus({ ...base, models: { openai: 'whisper-1' } }).ready).toBe(false);
    expect(criticStatus({ ...base, ai: 'local' }).ready).toBe(false);
  });
});

describe('Privacy status pills', () => {
  it('link to Settings with the live state', () => {
    const off = renderToStaticMarkup(<PrivacyView s={{ ...base, critic: false, aiImages: false }} onSettings={() => undefined} />);
    expect(off).toContain('Visual critic is off. Change in Settings');
    expect(off).toContain('AI images is off. Change in Settings');
    const on = renderToStaticMarkup(<PrivacyView s={{ ...base, critic: true, aiImages: true }} onSettings={() => undefined} />);
    expect(on).toContain('Visual critic is on. Change in Settings');
    expect(on).toContain('Keys come from Penv Cloud');
  });
});
