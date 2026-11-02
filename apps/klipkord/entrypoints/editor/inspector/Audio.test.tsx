// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRACKS } from '@/lib/audio/tracks';
import { currentCut, steps } from '@/lib/project/history';
import { addMusic } from '@/lib/project/media';
import { fromRecording } from '@/lib/project/migrate';
import { cutLength } from '@/lib/project/time';
import type { Project, Source } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import type { SlotProps } from '../components/slots';
import type { MediaIO } from '../dialogs/AddMedia';
import { MusicPicker, type TrackAudio } from '../dialogs/MusicPicker';
import { AudioPanel, lufsText, meterShare, musicLine } from './Audio';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recording = { id: 'r', title: 'Invite', createdAt: 1, duration: 20_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [], transcriptPending: false } as unknown as Recording;
const src = (id: string, kind: Source['kind'], duration: number, name?: string): Source =>
  ({ id, kind, file: `${id}.webm`, mime: 'audio/webm', offset: 0, duration, video: false, audio: true, ...(name && { name }) });
const base = (): Project => {
  const p = fromRecording(recording);
  return { ...p, sources: [...p.sources, src('mic', 'mic', 20_000), src('tab', 'tab', 20_000)] };
};
const withSong = () => addMusic(base(), { source: src('song', 'music', 150_000, 'Bright morning') });

let root: Root;
let host: HTMLElement;
let latest: Project;
const io: MediaIO = {
  recordings: async () => [], video: async () => new Blob(), track: vi.fn(async () => new Blob(['x'])), put: vi.fn(async () => {}),
  probe: async () => ({ duration: 118_000, video: false, audio: true }),
};
const audio = (): TrackAudio => ({ play: vi.fn(async () => {}), pause: vi.fn(), duration: 150, addEventListener: () => {} });

function Harness({ start, picker }: { start: Project; picker?: boolean }) {
  const [project, setProject] = useState(start);
  latest = project;
  const cut = currentCut(project);
  const p: SlotProps = { recording, project, cut, out: 0, length: cutLength(cut), playing: false, ready: true, readOnly: false, seek: () => {}, play: () => {}, edit: (op) => setProject(op) };
  return picker ? <MusicPicker p={p} onClose={() => {}} onOwnFile={() => {}} io={io} audio={audio} /> : <AudioPanel {...p} />;
}
const render = (start: Project, picker = false) => act(() => root.render(<Harness start={start} picker={picker} />));
const button = (name: string) => [...host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!;
const toggle = (name: string) => [...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith(name))!.querySelector('input')!;
const lastLabel = () => steps(latest).steps.at(-1)?.label;
const mix = () => currentCut(latest).audio;
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); };

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Audio tab', () => {
  it('turns noise removal and loudness on as one "Changed audio" step each', async () => {
    render(base());
    await click(toggle('Remove background noise'));
    expect(mix().denoise).toBe(true);
    expect(lastLabel()).toBe('Changed audio');
    await click(toggle('Even out the loudness'));
    expect(mix().level).toBe(true);
  });

  it('shows the music with its source and length, and edits ducking and fades', async () => {
    render(withSong());
    expect(host.textContent).toContain('Bright morning');
    expect(host.textContent).toContain('Bundled · CC0 · 2:30');
    await click(toggle('Lower music while you talk'));
    expect(mix().music?.duck).toBe(false);
    await click(button('No fade'));
    expect(mix().music).toMatchObject({ fadeIn: 0, fadeOut: 0 });
    expect(lastLabel()).toBe('Changed audio');
  });

  it('says No music and hides the music controls without a track', () => {
    render(base());
    expect(host.textContent).toContain('No music');
    expect(host.textContent).not.toContain('Lower music while you talk');
    expect(host.textContent).toContain('Tab sound');
  });

  it('formats the meter like the frame', () => {
    expect(lufsText(-16.2)).toBe('−16 LUFS');
    expect(meterShare(-16)).toBeCloseTo(0.7, 1);
    expect(musicLine('Bright morning', 150_000, 400_000)).toBe('Bundled · CC0 · 2:30, loops');
    expect(musicLine('mine.mp3', 60_000, 30_000)).toBe('1:00');
  });
});

describe('MusicPicker', () => {
  it('filters by mood and plays a preview', async () => {
    render(base(), true);
    await click(button('Calm'));
    expect(host.textContent).toContain('Slow tide');
    expect(host.textContent).not.toContain('Night drive');
    await click(button('Play Slow tide'));
    expect(button('Play Slow tide').getAttribute('aria-pressed')).toBe('true');
  });

  it('copies the chosen bundled track into the project with "Set music to" as its step', async () => {
    render(base(), true);
    await click(button('Driving'));
    await click(host.querySelector<HTMLElement>('[role="option"]')!);
    await click(button('Use this track'));
    const track = TRACKS.find((t) => t.id === 'night-drive')!;
    expect(io.track).toHaveBeenCalledWith(track);
    expect(latest.sources.find((s) => s.id === mix().music?.source)?.name).toBe('Night drive');
    expect(lastLabel()).toBe('Set music to “Night drive”');
  });

  it('No music takes the music off', async () => {
    render(withSong(), true);
    await click(button('No music'));
    expect(mix().music).toBeUndefined();
    expect(lastLabel()).toBe('Changed audio');
  });
});
