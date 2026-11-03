// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS, type FetchLike } from '@/lib/llm';
import { currentCut, steps } from '@/lib/project/history';
import { fromRecording } from '@/lib/project/migrate';
import { cutLength } from '@/lib/project/time';
import type { Project } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import type { SlotProps } from '../components/slots';
import { DepsContext, type EditorDeps } from '../deps';
import { aiSlots } from '.';
import { setAiDeps } from './deps';
import { aiState, openAsk, openTranslate, resetAi } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const words = ['Hi,', "I'm", 'Sam.', 'Um,', 'then', 'pick', 'Members.'].map((text, i) => ({ start: i * 1000, end: i * 1000 + 600, text }));
const recording = { id: 'r', title: 'Invite', createdAt: 1, duration: 10_000, mime: 'video/webm', quality: '1080p', edits: [], transcriptPending: false,
  transcript: [{ start: 0, end: 6600, text: words.map((w) => w.text).join(' '), words }] } as unknown as Recording;

let root: Root;
let host: HTMLElement;
let latest: Project;
let online = true;
const openPanel = vi.fn();

function Harness() {
  const [project, setProject] = useState(() => fromRecording(recording));
  latest = project;
  const cut = currentCut(project);
  const edit = (op: (p: Project) => Project) => setProject((p) => op(p));
  const p: SlotProps = { recording, project, cut, out: 0, length: cutLength(cut), playing: false, ready: true, readOnly: false, seek: () => {}, play: () => {}, edit };
  return <DepsContext.Provider value={{ openPanel } as unknown as EditorDeps}><aiSlots.Cover {...p} /><aiSlots.Overlay {...p} /></DepsContext.Provider>;
}

const groqNotes = { provider: 'groq' as const, model: 'openai/gpt-oss-120b' };
function useAi(keys: Record<string, string>, ...replies: unknown[]) {
  const queue = replies.map((r) => JSON.stringify(r));
  const fetchFn = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ choices: [{ message: { content: queue.shift() ?? '{}' } }] })));
  setAiDeps({ keys: async () => keys, notes: async () => groqNotes, fetch: fetchFn, online: () => online, watchOnline: () => () => {} });
  return fetchFn;
}
const key = { [PROVIDERS.groq.keyName]: 'gsk_test' };
const text = () => host.textContent ?? '';
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!;
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
async function send(request: string) {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Ask for an edit"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, request);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await flush();
}

beforeEach(() => { online = true; resetAi(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); setAiDeps(null); });

describe('Ask AI', () => {
  it('shows ai-not-set-up without a key, with Connect Penv Cloud and Paste a key', async () => {
    useAi({});
    act(() => { openAsk(); root.render(<Harness />); });
    await flush();
    expect(text()).toContain('Turn on AI edits');
    act(() => button('Paste a key').click());
    expect(openPanel).toHaveBeenCalledWith('PasteKey');
  });

  it('turns a reply into a draft, applies the ticked rows as one step and shows the toast', async () => {
    const f = useAi(key, { ops: [{ op: 'cut', from: 3, to: 3, label: 'Cut 1 filler word' }, { op: 'caption', style: 'bold', label: 'Bold captions' }] });
    act(() => { openAsk(); root.render(<Harness />); });
    await flush();
    expect(text()).toContain('Groq · GPT-oss');
    await send('Tighten it up');
    expect(f).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Draft · 2 changes · 0:10 → 0:09');
    expect(text()).toContain('Cut 1 filler word');
    act(() => host.querySelector<HTMLInputElement>('input[aria-label="Bold captions"]')!.click());
    act(() => button('Apply 1').click());
    expect(steps(latest).steps.map((s) => s.label)).toEqual(['Applied AI edit · 1 change']);
    expect(currentCut(latest).captions.show).toBe(false);
    expect(text()).toContain('AI edit applied · 1 change');
    act(() => button('Undo').click());
    expect(steps(latest).applied).toBe(0);
    expect(cutLength(currentCut(latest))).toBe(10_000);
  });

  it('adds a card from the scenes templates the Cards panel offers', async () => {
    useAi(key, { ops: [{ op: 'card', template: 'title-hook', at: 0, slots: { headline: 'Invite your team' }, label: 'Add a title hook' }] });
    act(() => { openAsk(); root.render(<Harness />); });
    await send('Add a title card');
    expect(text()).toContain('Add a title hook');
    act(() => button('Apply 1').click());
    expect(currentCut(latest).cards).toEqual([expect.objectContaining({ template: 'title-hook', ms: 3000, slots: { headline: 'Invite your team' }, pack: 'clean' })]);
  });

  it('says ai-cant, then ai-failed after a failed repair', async () => {
    useAi(key, { ops: [], cant: 'add sound effects' });
    act(() => { openAsk(); root.render(<Harness />); });
    await send('Add a whoosh');
    expect(text()).toContain("The AI can't do that yet");
    useAi(key, { ops: [] }, { ops: [] });
    act(() => button('Try something else').click());
    await send('Do it');
    expect(text()).toContain("The AI's reply didn't make sense");
    expect(steps(latest).steps).toEqual([]);
  });

  it('never shows the model\'s own words for ai-cant', async () => {
    useAi(key, { ops: [], cant: 'add sound effects' });
    act(() => { openAsk(); root.render(<Harness />); });
    await send('Add a whoosh');
    expect(text()).toContain('It can cut, keep, reorder, speed, zoom, caption, add cards, chapters and layouts.');
    expect(text()).not.toContain('sound effects');
  });

  it('keeps a request running after Back; a new cut that lands meanwhile is made when Ask AI opens', async () => {
    let answer: (body: string) => void = () => {};
    const reply = { ops: [{ op: 'newCut', name: 'Short', shape: '9:16', keep: [{ from: 0, to: 2 }] }] };
    setAiDeps({ keys: async () => key, notes: async () => groqNotes, online: () => true, watchOnline: () => () => {},
      fetch: () => new Promise<Response>((r) => { answer = (body) => r(new Response(JSON.stringify({ choices: [{ message: { content: body } }] }))); }) });
    act(() => { openAsk(); root.render(<Harness />); });
    await send('Make a short');
    expect(text()).toContain('Working out the changes. You can keep editing; the draft waits for you.');
    act(() => button('Back').click());
    await act(async () => answer(JSON.stringify(reply)));
    await flush();
    expect(latest.cuts).toHaveLength(1);
    act(() => openAsk());
    await flush();
    expect(currentCut(latest).name).toBe('Short');
  });

  it('makes a highlight cut that Discard removes', async () => {
    useAi(key, { ops: [{ op: 'newCut', name: 'LinkedIn 30s', shape: '1:1', keep: [{ from: 0, to: 2 }] }] });
    act(() => { openAsk(); root.render(<Harness />); });
    await send('Make a 30-second highlight for LinkedIn');
    expect(currentCut(latest).name).toBe('LinkedIn 30s');
    expect(text()).toContain('New cut “LinkedIn 30s” · 1:1 · 0:02');
    expect(text()).toContain('Your Full cut is unchanged.');
    act(() => button('Discard').click());
    expect(latest.cuts).toHaveLength(1);
    expect(aiState().trial).toBeNull();
  });

  it('shows offline', async () => {
    online = false;
    useAi(key);
    act(() => { openAsk(); root.render(<Harness />); });
    expect(text()).toContain("You're offline");
  });
});

describe('Translate captions', () => {
  it('translates, lets a line be edited, and saves on Done; a failure shows translate-failed', async () => {
    useAi(key, { lines: ['Hola, soy Sam.', 'Um, luego elige Miembros.'] });
    act(() => { openTranslate(); root.render(<Harness />); });
    await flush();
    act(() => button('+ Add a language').click());
    const options = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options[0]).toBe('Español · Spanish');
    expect(options.at(-1)).toBe('简体中文 · Chinese (Simplified)');
    expect(options).toHaveLength(15);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')][0]!.click());
    await flush();
    expect(text()).toContain('Spanish captions');
    expect(text()).toContain('Show Spanish in the video');
    act(() => button('Done').click());
    expect(latest.translations.Spanish).toHaveLength(2);
    expect(currentCut(latest).captions.language).toBe('Spanish');
    expect(steps(latest).steps.map((s) => s.label)).toEqual(['Added Spanish captions']);

    useAi(key, {}, {});
    act(() => openTranslate());
    act(() => button('+ Add a language').click());
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search languages"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'fran');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const left = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(left.map((o) => o.textContent)).toEqual(['Français · French']);
    await act(async () => left[0]!.click());
    await flush();
    expect(text()).toContain("Couldn't translate the captions");
  });
});
