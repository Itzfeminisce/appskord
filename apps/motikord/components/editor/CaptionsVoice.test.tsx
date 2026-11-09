// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptionsVoice, type CaptionsVoiceProps } from './CaptionsVoice';
import { captionPieces, hasCaptions } from './CaptionsVoiceEdits';
import { EditorV3Provider, useEditorV3, type EditorV3Api } from './context';
import { sampleClip } from './fixture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unmounts: (() => void)[] = [];
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { for (const u of unmounts.splice(0)) u(); vi.restoreAllMocks(); });

const narration = new Blob([new Uint8Array([1])], { type: 'audio/webm' });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

async function open(props: CaptionsVoiceProps) {
  let api!: EditorV3Api;
  const Probe = () => { api = useEditorV3(); return <CaptionsVoice {...props} />; };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<EditorV3Provider clip={sampleClip()}><Probe /></EditorV3Provider>); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  const sw = (name: string) => host.querySelector<HTMLElement>(`[role=switch][aria-label="${name}"]`)!;
  const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };
  const button = (t: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === t);
  return { host, sw, click, button, api: () => api };
}

describe('CaptionsVoice', () => {
  it('starts with both features off and sends nothing', async () => {
    const fetch = vi.fn();
    const v = await open({ narration, fetch: fetch as unknown as typeof globalThis.fetch, keyOf: async () => 'gsk_test' });
    expect(v.sw('Auto captions').getAttribute('aria-checked')).toBe('false');
    expect(v.sw('AI voiceover').getAttribute('aria-checked')).toBe('false');
    expect(v.host.textContent).toContain('Off by default. Change it in Settings.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('burns captions in as one undoable change of text layers', async () => {
    const fetch = vi.fn(async () => json({ segments: [{ start: 0.2, end: 2.2, text: 'Morning shift.' }, { start: 3.2, end: 5, text: 'Coffee by 7am.' }] }));
    const v = await open({ narration, fetch: fetch as unknown as typeof globalThis.fetch, keyOf: async () => 'gsk_test' });
    const before = v.api().state.clip.history.length;
    await v.click(v.sw('Auto captions'));
    expect(fetch).toHaveBeenCalledTimes(1);
    const st = v.api().state;
    expect(hasCaptions(st)).toBe(true);
    expect(st.clip.history.length).toBe(before + 1);
    expect(st.clip.recipe.scenes.flatMap((s) => s.layers).filter((l) => l.id.startsWith('caption-') && l.type === 'text')).toHaveLength(2);
    await act(async () => { v.api().undo(); });
    expect(hasCaptions(v.api().state)).toBe(false);
  });

  it('shows captions-failed and captions-no-voice cards', async () => {
    const bad = vi.fn(async () => json({}, 500));
    const v = await open({ narration, fetch: bad as unknown as typeof globalThis.fetch, keyOf: async () => 'gsk_test' });
    await v.click(v.sw('Auto captions'));
    expect(v.host.querySelector('[data-state=captions-failed]')?.textContent).toContain('Your narration couldn’t be written down');
    const empty = vi.fn(async () => json({ segments: [] }));
    const w = await open({ narration, fetch: empty as unknown as typeof globalThis.fetch, keyOf: async () => 'gsk_test' });
    await w.click(w.sw('Auto captions'));
    expect(w.host.querySelector('[data-state=captions-no-voice]')?.textContent).toContain('No speech found in the narration');
  });

  it('shows voiceover-no-key without a request when there is no OpenAI key', async () => {
    const fetch = vi.fn();
    const v = await open({ fetch: fetch as unknown as typeof globalThis.fetch, keyOf: async () => undefined });
    await v.click(v.sw('AI voiceover'));
    const card = v.host.querySelector('[data-state=voiceover-no-key]');
    expect(card?.textContent).toContain('AI voiceover needs an OpenAI key');
    expect(v.button('Make voiceover')).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('makes the voiceover from the script only', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200 }));
    const onVoiceover = vi.fn(async () => 14_000);
    const v = await open({ fetch: fetch as unknown as typeof globalThis.fetch, keyOf: async () => 'sk-test', onVoiceover });
    await v.click(v.sw('AI voiceover'));
    await v.click(v.button('Make voiceover'));
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { input: string };
    expect(body.input.length).toBeGreaterThan(5);
    expect(onVoiceover).toHaveBeenCalled();
    expect(v.host.textContent).toContain('Ready · 0:14');
  });
});

describe('captionPieces', () => {
  it('cuts a cue at the scene edge', () => {
    expect(captionPieces([0, 3000], [3000, 3000], [{ startMs: 2500, endMs: 3500, text: 'x' }])).toEqual([
      { scene: 0, startMs: 2500, endMs: 3000, text: 'x' },
      { scene: 1, startMs: 0, endMs: 500, text: 'x' },
    ]);
  });
});
