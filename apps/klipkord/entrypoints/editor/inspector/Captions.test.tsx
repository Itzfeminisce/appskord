// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentCut, steps } from '@/lib/project/history';
import { fromRecording } from '@/lib/project/migrate';
import { setShape } from '@/lib/project/cuts';
import { cutLength } from '@/lib/project/time';
import type { Project } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import type { SlotProps } from '../components/slots';
import { ShapeMenu } from '../components/ShapeMenu';
import { CaptionsPanel } from './Captions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recording = { id: 'r', title: 'Invite', createdAt: 1, duration: 20_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [], transcriptPending: false } as unknown as Recording;
let root: Root;
let host: HTMLElement;
let latest: Project;

function Harness({ start, readOnly = false, menu = false }: { start: Project; readOnly?: boolean; menu?: boolean }) {
  const [project, setProject] = useState(start);
  latest = project;
  const cut = currentCut(project);
  const edit = (op: (p: Project) => Project) => setProject((p) => op(p));
  const props: SlotProps = { recording, project, cut, out: 0, length: cutLength(cut), playing: false, ready: true, readOnly, seek: () => {}, play: () => {}, edit };
  return menu ? <ShapeMenu shape={cut.shape} fit={cut.fit} readOnly={readOnly} edit={edit} onClose={() => {}} /> : <CaptionsPanel {...props} />;
}
const seed = (): Project => ({ ...fromRecording(recording), translations: { French: [] } });
const render = (props: Parameters<typeof Harness>[0]) => act(() => root.render(<Harness {...props} />));
const find = (name: string) => [...host.querySelectorAll<HTMLElement>('button, [role="switch"]')].find((b) => b.textContent === name || b.textContent === `Aa${name}` || b.textContent === `A${'a'}${name}` || b.getAttribute('aria-label') === name)!;
const captions = () => currentCut(latest).captions;
const lastLabel = () => steps(latest).steps.at(-1)?.label;

beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('Captions tab', () => {
  it('saves each choice as one undoable step', () => {
    render({ start: seed() });
    act(() => find('Show captions').click());
    expect(captions().show).toBe(true);
    for (const [label, style] of [['Bold', 'bold'], ['Word by word', 'word'], ['Clean', 'clean']] as const) {
      act(() => find(label).click());
      expect(captions().style).toBe(style);
    }
    for (const [label, position] of [['Top', 'top'], ['Middle', 'middle'], ['Bottom', 'bottom']] as const) {
      act(() => find(label).click());
      expect(captions().position).toBe(position);
    }
    expect(lastLabel()).toBe('Changed captions');
  });

  it('saves size and language', () => {
    render({ start: seed() });
    const size = host.querySelector<HTMLInputElement>('#caption-size')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(size, '72');
      size.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(captions().size).toBe(72);
    expect(host.textContent).toContain('L');
    const select = host.querySelector<HTMLSelectElement>('select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['English (spoken)', 'French']);
    act(() => {
      select.value = 'French';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(captions().language).toBe('French');
  });

  it('shows Translate in its needs-AI state until T15 fills it', () => {
    render({ start: seed() });
    expect((find('Translate') as HTMLButtonElement).disabled).toBe(true);
    expect(find('Translate').title).toBe('Turn on AI edits');
  });

  it('changes nothing when read-only', () => {
    render({ start: seed(), readOnly: true });
    expect((find('Bold') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Shape menu', () => {
  it('changes the shape and shows the fits only for 9:16', () => {
    render({ start: seed(), menu: true });
    expect(host.textContent).not.toContain('Fit the screen into 9:16');
    act(() => find('9:16').click());
    expect(currentCut(latest).shape).toBe('9:16');
    expect(host.textContent).toContain('Fit the screen into 9:16');
    expect(host.textContent).toContain('Captions and cards move into the safe area for Shorts, Reels and TikTok.');
  });

  it('picks each fit', () => {
    render({ start: setShape(seed(), { shape: '9:16' }), menu: true });
    for (const [name, fit] of [['Follow the cursor', 'follow'], ['Fit with bars', 'bars'], ['Screen over camera', 'stack']] as const) {
      act(() => ([...host.querySelectorAll<HTMLElement>('[role="radio"]')].find((b) => b.textContent!.startsWith(name))!).click());
      expect(currentCut(latest).fit).toBe(fit);
    }
  });
});
