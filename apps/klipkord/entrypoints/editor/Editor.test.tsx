// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from '@appskord/platform/router';
import { closeDB, putRecording } from '@/lib/db';
import { setTrack } from '@/lib/project/ops';
import { getProject, putProject, SAVE_DEBOUNCE_MS } from '@/lib/project/store';
import type { Project, Source } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import type { SlotProps } from './components/slots';
import type { EditorDeps } from './deps';
import type { EditorSlots } from './Editor';
import type { LoadedMedia } from './media';
import type { PreviewClient } from './preview';
import { writeUnsaved } from './recovery';
import type { EditorSession, SessionState } from './session';
import { EditorApp } from './router';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const save = vi.hoisted(() => ({ fail: false }));
vi.mock('@/lib/project/store', async (original) => {
  const real = await original<typeof import('@/lib/project/store')>();
  return { ...real, putProject: (p: Project) => (save.fail ? Promise.reject(new Error('QuotaExceededError')) : real.putProject(p)) };
});

const rec = (over: Partial<Recording> = {}): Recording => ({
  id: 'rec-1', title: 'Invite your team', createdAt: 1, duration: 60_000, status: 'ready', mode: 'tab', quality: '1080p', mime: 'video/webm',
  bytes: 1, markers: [], notes: [], comments: [], transcript: [{ start: 0, end: 4000, text: 'Hi, I am Sam.' }, { start: 8000, end: 12_000, text: 'Open Settings.' }],
  transcriptPending: false, edits: [], ...over,
});

function fakeSession(state: SessionState): EditorSession & { taken: boolean } {
  let current = state;
  const listeners = new Set<(s: SessionState) => void>();
  return {
    taken: false,
    get state() { return current; },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    async take() { this.taken = true; current = 'editing'; listeners.forEach((l) => l(current)); },
    close() {},
  };
}

interface Setup { media?: Partial<LoadedMedia>; session?: SessionState; draws?: boolean; strict?: boolean }

function fakeDeps({ media = {}, session = 'editing', draws = true }: Setup = {}) {
  const rendered: number[] = [];
  const panels: string[] = [];
  const client: PreviewClient = {
    render(plan) {
      rendered.push(plan.out);
      if (draws) queueMicrotask(() => listeners.forEach((l) => l(true)));
    },
    resize() {}, addSources() {}, close: vi.fn(),
    onDrawn(l) { listeners.add(l); return () => listeners.delete(l); },
  };
  const listeners = new Set<(drawn: boolean) => void>();
  const sessionObj = fakeSession(session);
  const deps: EditorDeps = {
    loadMedia: async () => ({ blobs: new Map(), missing: [], ...media }),
    startPreview: vi.fn(() => client),
    audio: () => null,
    joinSession: () => sessionObj,
    openPanel: (s) => void panels.push(s),
    useGroq: vi.fn(),
    closeTab: vi.fn(),
    putFile: vi.fn(async () => {}),
  };
  return { deps, rendered, panels, session: sessionObj, client };
}

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1);
      else await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const mounted: (() => void)[] = [];
afterEach(() => { for (const u of mounted.splice(0)) u(); vi.useRealTimers(); vi.unstubAllGlobals(); save.fail = false; localStorage.clear(); });
beforeEach(async () => {
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  Object.assign(window, { innerWidth: 1366, innerHeight: 640 });
});

async function mount(path: string, setup: Setup = {}, slots?: EditorSlots) {
  const fake = fakeDeps(setup);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const history = createMemoryHistory({ initialEntries: [path] });
  const app = <EditorApp deps={fake.deps} history={history} slots={slots} />;
  await act(async () => { root.render(setup.strict ? <StrictMode>{app}</StrictMode> : app); });
  await settle();
  mounted.push(() => { act(() => root.unmount()); host.remove(); });
  return { host, ...fake };
}

const text = (host: HTMLElement) => host.textContent ?? '';
const button = (host: HTMLElement, label: string) => {
  const found = [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await settle(); };
const key = async (init: KeyboardEventInit) => { await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })); }); await settle(); };
const status = (host: HTMLElement) => host.querySelector('[data-save]')?.textContent;

// A stand-in timeline (T7) that makes one edit, so the shell's save and undo can be driven.
function MuteButton(p: SlotProps) {
  return <button type="button" onClick={() => p.edit((project) => setTrack(project, { name: 'voice', patch: { muted: true } }))}>Mute voice</button>;
}

describe('editor tab', () => {
  it('opens with the steps, then shows the project name, Saved and a playable preview', async () => {
    await putRecording(rec());
    const view = await mount('/rec-1', { draws: false });
    expect(text(view.host)).toContain('Getting your recording ready');
    expect(text(view.host)).toContain('Reading the video');
    expect(text(view.host)).toContain('The transcript appears here in a moment.');
    expect(button(view.host, 'Play (Space)').disabled).toBe(true);
    expect(text(view.host)).toContain('Invite your team');
    expect(status(view.host)).toBe('Saving…');
    await act(async () => { await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 50)); });
    await settle();
    expect(status(view.host)).toBe('Saved');
    // An older recording gets its project on first open, seeded from the title.
    expect((await getProject('rec-1'))?.name).toBe('Invite your team');
  });

  it('plays once the first frame shows; Space toggles, J and L move by sentence', async () => {
    // The clock stands still, so the playhead only moves by J and L.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    await putRecording(rec());
    const view = await mount('/rec-1');
    expect(text(view.host)).not.toContain('Getting your recording ready');
    expect(view.rendered.length).toBeGreaterThan(0);
    await key({ key: ' ' });
    expect(button(view.host, 'Pause (Space)')).toBeTruthy();
    await key({ key: ' ' });
    expect(button(view.host, 'Play (Space)')).toBeTruthy();
    await key({ key: 'l' });
    expect(text(view.host)).toContain('0:08.0');
    await key({ key: 'j' });
    expect(text(view.host)).toContain('0:00.0');
  });

  it('save status, Undo and Redo buttons, Ctrl+Z and Ctrl+Shift+Z', async () => {
    await putRecording(rec());
    const view = await mount('/rec-1', {}, { timeline: MuteButton });
    const undo = () => button(view.host, 'Undo (Ctrl+Z)');
    const redo = () => button(view.host, 'Redo (Ctrl+Shift+Z)');
    expect(undo().disabled).toBe(true);
    expect(undo().title).toBe('Nothing to undo yet.');
    expect(redo().disabled).toBe(true);

    await click(button(view.host, 'Mute voice'));
    expect(status(view.host)).toBe('Saving…');
    expect(undo().disabled).toBe(false);
    await act(async () => { await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 50)); });
    await settle();
    expect(status(view.host)).toBe('Saved');
    expect((await getProject('rec-1'))?.cuts[0]?.tracks.voice?.muted).toBe(true);

    await click(undo());
    expect(redo().disabled).toBe(false);
    expect(undo().disabled).toBe(true);
    await key({ key: 'z', ctrlKey: true, shiftKey: true });
    expect(undo().disabled).toBe(false);
    await key({ key: 'z', ctrlKey: true });
    expect(undo().disabled).toBe(true);
  });

  it('not-saved: the top bar says Not saved and Free up space opens Storage', async () => {
    await putRecording(rec());
    const view = await mount('/rec-1', {}, { timeline: MuteButton });
    save.fail = true;
    await click(button(view.host, 'Mute voice'));
    await settle();
    expect(status(view.host)).toBe('Not saved');
    expect(text(view.host)).toContain("Couldn't save your last change");
    await click(button(view.host, 'Free up space'));
    expect(view.panels).toEqual(['Storage']);
  });

  it('old-recording banner for a v1 or v2 recording, gone after Got it', async () => {
    await putRecording(rec());
    const view = await mount('/rec-1');
    expect(text(view.host)).toContain('Made with an older Klipkord');
    await click(button(view.host, 'Got it'));
    expect(text(view.host)).not.toContain('Made with an older Klipkord');
  });

  it('words-pending and no-voice in the transcript column', async () => {
    await putRecording(rec({ transcriptPending: true, transcript: [] }));
    const pending = await mount('/rec-1');
    expect(text(pending.host)).toContain('Words are on their way');
    await click(button(pending.host, 'Use Groq instead'));
    expect(pending.deps.useGroq).toHaveBeenCalled();

    await putRecording(rec({ id: 'rec-2', transcript: [] }));
    const quiet = await mount('/rec-2');
    expect(text(quiet.host)).toContain('No talking found');
  });

  it('media-missing names the file', async () => {
    await putRecording(rec());
    const gone: Source = { id: 'm', kind: 'music', file: 'intro-music.mp3', mime: 'audio/mpeg', offset: 0, duration: 1, video: false, audio: true, name: 'intro-music.mp3' };
    const view = await mount('/rec-1', { media: { missing: [gone] } });
    expect(text(view.host)).toContain('A file is missing: intro-music.mp3');
    await click(button(view.host, 'Remove it'));
    expect(text(view.host)).not.toContain('A file is missing');
  });

  it('StrictMode: the canvas goes to the worker once, and the preview closes once on unmount', async () => {
    await putRecording(rec());
    const view = await mount('/rec-1', { strict: true });
    expect(view.deps.startPreview).toHaveBeenCalledTimes(1);
    expect(view.client.close).not.toHaveBeenCalled();
    mounted.pop()?.();
    await new Promise((r) => setTimeout(r, 5));
    expect(view.client.close).toHaveBeenCalledTimes(1);
  });

  it('open-elsewhere: read-only until Edit here', async () => {
    await putRecording(rec());
    const view = await mount('/rec-1', { session: 'elsewhere' });
    expect(text(view.host)).toContain('This project is being edited in another tab. Edit here and that tab becomes read-only.');
    await click(button(view.host, 'Edit here'));
    expect(view.session.taken).toBe(true);
    expect(text(view.host)).not.toContain('Open in another tab');
  });

  it('unsaved-recovered: kept edits come back on Keep them', async () => {
    await putRecording(rec());
    const first = await mount('/rec-1');
    expect(text(first.host)).not.toContain('Your last edits were kept');
    const stored = (await getProject('rec-1'))!;
    await putProject(stored);
    const later = setTrack(stored, { name: 'voice', patch: { muted: true } });
    writeUnsaved({ project: later, changes: 12, at: Date.now() + 1000 });
    const view = await mount('/rec-1');
    expect(text(view.host)).toContain('Klipkord closed before saving. 12 changes from');
    await click(button(view.host, 'Keep them'));
    expect(button(view.host, 'Undo (Ctrl+Z)').disabled).toBe(false);
  });

  it('long-recording asks first; window-small and no-project replace the editor', async () => {
    await putRecording(rec({ duration: 72 * 60_000 }));
    const long = await mount('/rec-1', { draws: false });
    expect(text(long.host)).toContain('This recording is 1 h 12 min');
    await click(button(long.host, 'Open anyway'));
    expect(text(long.host)).toContain('Getting your recording ready');

    const none = await mount('/');
    expect(text(none.host)).toContain('Pick a recording to edit');
    await click(button(none.host, 'Open the library'));
    expect(none.panels).toEqual(['Library']);
    expect(text((await mount('/nope')).host)).toContain('Pick a recording to edit');

    Object.assign(window, { innerWidth: 1024, innerHeight: 640 });
    expect(text((await mount('/rec-1')).host)).toContain('The editor needs at least 1280 by 600. Yours is 1024 by 640.');
  });

  it('opening-slow after 8 s without a first frame', async () => {
    await putRecording(rec());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = await mount('/rec-1', { draws: false });
    expect(text(view.host)).not.toContain('Still getting this ready');
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(text(view.host)).toContain('Still getting this ready');
    await click(button(view.host, 'Keep waiting'));
    expect(text(view.host)).toContain('Getting your recording ready');
  });
});
