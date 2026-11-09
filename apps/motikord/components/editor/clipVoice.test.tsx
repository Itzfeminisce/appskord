// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { validateRecipe } from '../../lib/recipe/validate';
import type { RestyledClip } from '../../lib/restyle/restyle';
import { CaptionsVoice, type CaptionsVoiceProps } from './CaptionsVoice';
import { hasCaptions } from './CaptionsVoiceEdits';
import { MAX_NARRATION_BYTES, NARRATION_TOO_BIG, setVoice, useClipVoice, voiceAsset, type VoiceMedia } from './clipVoice';
import { EditorV3Provider, useEditorV3, type EditorV3Api } from './context';
import { sampleClip } from './fixture';
import { initV3 } from './model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unmounts: (() => void)[] = [];
beforeEach(() => { fakeBrowser.reset(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { for (const u of unmounts.splice(0)) u(); vi.restoreAllMocks(); });

const audio = (n = 4, type = 'audio/mpeg') => new File([new Uint8Array(n)], 'take.mp3', { type });

function fakeMedia() {
  const files = new Map<string, Blob>();
  let next: File | undefined;
  let n = 0;
  const media: VoiceMedia = {
    get: async (p) => files.get(p),
    put: async (p, b) => { files.set(p, b); },
    pick: (on) => { if (next) on(next); },
    durationMs: async () => 6000,
    id: () => `voice-${++n}`,
  };
  return { media, files, choose: (f: File) => { next = f; } };
}

async function open(clip: RestyledClip, media: VoiceMedia, props: CaptionsVoiceProps) {
  let api!: EditorV3Api;
  let voice!: ReturnType<typeof useClipVoice>;
  const Probe = () => { api = useEditorV3(); voice = useClipVoice(media); return <CaptionsVoice {...voice} {...props} />; };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<EditorV3Provider clip={clip}><Probe /></EditorV3Provider>); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };
  const sw = (name: string) => host.querySelector<HTMLElement>(`[role=switch][aria-label="${name}"]`)!;
  const button = (t: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === t);
  const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
  const choose = () => act(async () => { voice.onChooseNarration!(); });
  return { host, click, sw, button, settle, choose, api: () => api };
}

describe('clip voice track', () => {
  it('puts audio in the voice slot as one undoable change that replaces the old voice', () => {
    const st = initV3(sampleClip());
    const a = voiceAsset('voice-a', audio(), 'take.mp3', 6000);
    const one = setVoice(st, a, 'narration');
    expect(one.clip.recipe.voice).toEqual({ assetId: 'voice-a', volume: 1, source: 'narration' });
    expect(one.clip.recipe.assets['voice-a']).toMatchObject({ kind: 'audio', durationMs: 6000, opfsPath: 'media/voice-a.mp3' });
    expect(validateRecipe(one.clip.recipe)).toEqual([]);
    const two = setVoice(one, voiceAsset('voice-b', audio(), 'AI voiceover', 5000), 'voiceover');
    expect(two.clip.history.length).toBe(st.clip.history.length + 2);
    expect(two.clip.recipe.voice?.source).toBe('voiceover');
    expect(two.clip.recipe.assets['voice-a']).toBeUndefined();
  });

  it('Choose narration keeps the file locally, caps its size, and Make voiceover replaces it', async () => {
    const m = fakeMedia();
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    const v = await open(sampleClip(), m.media, { fetch: fetch as unknown as typeof globalThis.fetch, keyOf: async () => 'sk-test' });
    const before = v.api().state.clip.history.length;
    m.choose(audio(MAX_NARRATION_BYTES + 1));
    await v.choose();
    expect(v.api().state.errors).toEqual([NARRATION_TOO_BIG]);
    m.choose(audio());
    await v.choose();
    await v.settle();
    expect(v.api().state.clip.recipe.voice).toMatchObject({ assetId: 'voice-1', source: 'narration' });
    expect(v.api().state.clip.history.length).toBe(before + 1);
    expect(m.files.get('media/voice-1.mp3')?.size).toBe(4);
    await v.click(v.sw('AI voiceover'));
    await v.click(v.button('Make voiceover'));
    await v.settle();
    expect(v.api().state.clip.recipe.voice).toMatchObject({ assetId: 'voice-2', source: 'voiceover' });
    expect(v.host.textContent).toContain('Ready · 0:06');
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { v.api().undo(); });
    expect(v.api().state.clip.recipe.voice?.assetId).toBe('voice-1');
  });

  it('turns Auto captions on in the clip’s style when narration first arrives on a "Say it out loud" clip', async () => {
    const m = fakeMedia();
    const clip = { ...sampleClip(), autoCaptions: 'pop' } as RestyledClip;
    const stt = vi.fn(async () => new Response(JSON.stringify({ segments: [{ start: 0.2, end: 2, text: 'Say it.' }] }), { status: 200 }));
    const v = await open(clip, m.media, { fetch: stt as unknown as typeof globalThis.fetch, keyOf: async () => 'gsk_test' });
    expect(v.sw('Auto captions').getAttribute('aria-checked')).toBe('false');
    expect(stt).not.toHaveBeenCalled();
    m.choose(audio());
    await v.choose();
    await v.settle();
    await v.settle();
    expect(stt).toHaveBeenCalledTimes(1);
    expect(v.sw('Auto captions').getAttribute('aria-checked')).toBe('true');
    expect(hasCaptions(v.api().state)).toBe(true);
  });

  it('shows captions-no-key instead when there is no speech-to-text key', async () => {
    const m = fakeMedia();
    const clip = { ...sampleClip(), autoCaptions: 'pop' } as RestyledClip;
    const stt = vi.fn();
    const v = await open(clip, m.media, { fetch: stt as unknown as typeof globalThis.fetch, keyOf: async () => undefined });
    m.choose(audio());
    await v.choose();
    await v.settle();
    expect(v.host.querySelector('[data-state=captions-no-key]')).not.toBeNull();
    expect(v.sw('Auto captions').getAttribute('aria-checked')).toBe('false');
    expect(stt).not.toHaveBeenCalled();
  });
});
