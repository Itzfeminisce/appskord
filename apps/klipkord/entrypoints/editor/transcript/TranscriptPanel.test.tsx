// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentCut, steps } from '@/lib/project/history';
import { fromRecording } from '@/lib/project/migrate';
import { cutLength, toOut } from '@/lib/project/time';
import type { Project } from '@/lib/project/types';
import type { Recording, Segment } from '@/lib/types';
import type { TranscriptSlotProps } from '../components/slots';
import { CleanUpPanel } from './CleanUpPanel';
import { resetUi } from './store';
import { TranscriptPanel } from './TranscriptPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function line(at: number, text: string): Segment {
  const words = text.split(' ').map((w, i) => ({ start: at + i * 600, end: at + i * 600 + 500, text: w }));
  return { start: at, end: words.at(-1)!.end, text, words };
}
const transcript = [
  line(0, "Hi, I'm Sam. Um, in this video"),
  line(5000, 'Click Invite and type their email, uh,'),
  line(10_000, 'Click Invite and type their email address.'),
  line(18_000, 'Pick a role.'),
];
const recording = { id: 'r', title: 'Invite your team', createdAt: 1, duration: 20_000, mime: 'video/webm', quality: '1080p', edits: [], transcript, transcriptPending: false } as unknown as Recording;

let root: Root;
let host: HTMLElement;
let latest: Project;
const seek = vi.fn();

function Harness({ start }: { start: Project }) {
  const [project, setProject] = useState(start);
  latest = project;
  const cut = currentCut(project);
  const props: TranscriptSlotProps = {
    recording, project, cut, out: 0, length: cutLength(cut), playing: false, ready: true, readOnly: false, seek, play: () => {},
    edit: (op) => setProject((p) => op(p)), state: 'ready', onGroq: () => {},
  };
  return <div><TranscriptPanel {...props} /><CleanUpPanel {...props} /></div>;
}

const seen = (): Project => ({ ...fromRecording(recording), quickWins: 'seen', chapters: [{ at: 0, title: 'Intro' }] });
const render = (p: Project = seen()) => act(() => root.render(<Harness start={p} />));
const word = (i: number) => host.querySelector(`[data-i="${i}"]`)!;
// The selection bar renders in a body layer, so read the whole page.
const text = () => document.body.textContent ?? '';
const button = (name: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent === name || b.title === name || b.getAttribute('aria-label') === name)!;
const mouse = (el: Element, type: string, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...init }));
const lastLabel = () => steps(latest).steps.at(-1)?.label;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  seek.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetUi();
});

describe('TranscriptPanel', () => {
  it('shows chapters, a time per sentence, the pause, the length and the hint', () => {
    render();
    expect(text()).toContain('Intro');
    expect(text()).toContain('0:10');
    expect(text()).toContain('3.9 s pause');
    expect(text()).toContain('0:20Click a word to jump. Select words and press Delete to cut.');
    expect((word(3) as HTMLElement).style.textDecoration).toContain('dotted');
  });

  it('jumps to a clicked word', () => {
    render();
    act(() => { mouse(word(4), 'mousedown'); mouse(word(4), 'mouseup'); });
    expect(seek).toHaveBeenLastCalledWith(toOut(currentCut(latest), transcript[0]!.words![4]!.start));
  });

  it('selects by dragging, deletes, and brings a struck word back', () => {
    render();
    act(() => { mouse(word(1), 'mousedown'); mouse(word(2), 'mouseover'); mouse(word(2), 'mouseup'); });
    expect(text()).toContain('2 words · 0:00 to 0:01');
    expect(text()).toContain('Drag the selection to move this part. Shift+click to extend.');
    act(() => button('Delete').click());
    expect(lastLabel()).toBe('Cut 2 words');
    expect((word(1) as HTMLElement).style.textDecoration).toBe('line-through');
    act(() => { mouse(word(1), 'mousedown'); mouse(word(1), 'mouseup'); });
    expect(lastLabel()).toBe('Brought back 1 word');
  });

  it('moves a selection by dragging it before another word', () => {
    render();
    act(() => { mouse(word(21), 'mousedown'); mouse(word(23), 'mouseover'); mouse(word(23), 'mouseup'); });
    act(() => { mouse(word(22), 'mousedown'); mouse(word(0), 'mouseover'); mouse(word(0), 'mouseup'); });
    expect(lastLabel()).toBe('Moved “Pick a role.” before Intro');
  });

  it('finds, replaces all and cuts all from the find bar', () => {
    render();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true })); });
    const find = host.querySelector<HTMLInputElement>('input[aria-label="Find"]')!;
    const replace = host.querySelector<HTMLInputElement>('input[aria-label="Replace with"]')!;
    const type = (el: HTMLInputElement, value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    type(find, 'invite');
    expect(text()).toContain('1 of 2');
    expect(text()).toContain('Replace fixes the words and captions. The audio stays as you said it.');
    type(replace, 'Add');
    act(() => button('Replace all').click());
    expect(lastLabel()).toBe('Replaced “invite” with “Add”');
    expect(Object.values(latest.wordFixes)).toEqual(['Add', 'Add']);
    type(find, 'Click');
    act(() => button('Cut all 2').click());
    expect(lastLabel()).toBe('Cut 2 words');
  });

  it('cleans up fillers, the pause and the retake in one step', () => {
    render();
    act(() => button('Clean up').click());
    expect(text()).toContain('Highlighted words will be cut. Click one to keep it.');
    expect(text()).toContain('Um, uh, so, like, you know · 2 found');
    expect(text()).toContain('A sentence said twice. Keeps the last · 1 found');
    expect(text()).toContain('Cut 4');
    // Click a highlighted filler in the transcript to keep it.
    act(() => { mouse(word(3), 'mousedown'); mouse(word(3), 'mouseup'); });
    expect(text()).toContain('Cut 3');
    act(() => button('Cut 3').click());
    expect(lastLabel()).toBe('Cut 3 with Clean up');
    expect(steps(latest).steps).toHaveLength(1);
    expect(host.querySelector('[aria-label="Clean up"][role="region"]')).toBeNull();
  });

  it('shows nothing-to-clean when nothing is found', () => {
    render();
    act(() => button('Clean up').click());
    for (const name of ['Filler words', 'Long pauses', 'Retakes']) act(() => host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!.click());
    expect(text()).toContain('Nothing to clean up');
    expect(host.querySelector('[data-state="nothing-to-clean"]')).not.toBeNull();
  });

  it('offers quick wins on the first open and applies all as one step', () => {
    render({ ...seen(), quickWins: 'new' });
    expect(text()).toContain('3 quick wins for this video');
    expect(text()).toContain('Nothing changes until you apply.');
    act(() => button('Apply all 3').click());
    expect(lastLabel()).toBe('Applied 3 quick wins');
    expect(latest.quickWins).toBe('seen');
    expect(host.querySelector('[aria-label="Quick wins"]')).toBeNull();
  });

  it('"Not now" closes the quick wins and marks them seen', () => {
    render({ ...seen(), quickWins: 'new' });
    act(() => button('Not now').click());
    expect(latest.quickWins).toBe('seen');
    expect(steps(latest).steps).toHaveLength(0);
  });
});
