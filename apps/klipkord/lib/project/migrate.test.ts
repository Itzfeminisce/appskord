import { describe, expect, it } from 'vitest';
import type { Recording } from '../types';
import { currentCut } from './history';
import { bakedSource, fromRecording } from './migrate';
import { cutLength } from './time';
import type { Source } from './types';

const v2: Recording = {
  id: 'old', title: 'Invite your team', createdAt: 5, duration: 60_000, status: 'ready', mode: 'tab', quality: '1080p', height: 720,
  mime: 'video/mp4', bytes: 1, markers: [], notes: [], comments: [], transcript: [], transcriptPending: false,
  edits: [{ start: 1000, end: 20_000 }, { start: 25_000, end: 60_000 }],
  summary: {
    style: 'howto', detected: 'howto', engine: 'x', summary: '', points: [], actions: [],
    chapters: [{ at: 30_000, title: 'Roles' }, { at: 0, title: 'Intro' }],
  },
};

describe('fromRecording', () => {
  it('turns a v2 recording into one baked source with its kept ranges and chapters', () => {
    const p = fromRecording(v2);
    expect(p).toMatchObject({ id: 'old', version: 3, name: 'Invite your team', events: false, quickWins: 'new', wordFixes: {}, translations: {} });
    expect(p.sources).toEqual([bakedSource(v2)]);
    expect(p.sources[0]).toMatchObject({ kind: 'baked', file: 'video', mime: 'video/mp4', duration: 60_000, width: 1280, height: 720 });
    const cut = currentCut(p);
    expect(cut).toMatchObject({ name: 'Full', made: 'full', shape: '16:9' });
    expect(cut.clips.map((c) => [c.in, c.out, c.speed])).toEqual([[1000, 20_000, 1], [25_000, 60_000, 1]]);
    expect(cutLength(cut)).toBe(54_000);
    expect(p.chapters.map((c) => c.title)).toEqual(['Intro', 'Roles']);
    expect(p.history).toEqual({ [cut.id]: { undo: [], redo: [] } });
  });

  it('keeps the whole video for a v1 recording without edits and never leaves the name empty', () => {
    const p = fromRecording({ ...v2, title: '  ', edits: [], summary: undefined, height: undefined });
    expect(p.name).toBe('Untitled recording');
    expect(currentCut(p).clips.map((c) => [c.in, c.out])).toEqual([[0, 60_000]]);
    expect(p.sources[0]).toMatchObject({ width: 1920, height: 1080 });
    expect(p.chapters).toEqual([]);
  });

  it('builds a v3 project from its sources with default layers and options', () => {
    const sources: Source[] = [
      { id: 'screen', kind: 'screen', file: 'screen.webm', mime: 'video/webm', offset: 0, duration: 8000, video: true, audio: false },
      { id: 'camera', kind: 'camera', file: 'camera.webm', mime: 'video/webm', offset: 30, duration: 7900, video: true, audio: false },
    ];
    const p = fromRecording({ ...v2, v3: { sources: ['screen', 'camera'], events: true } }, sources, { bakeCamera: true });
    expect(p.sources).toBe(sources);
    expect(p.events).toBe(true);
    expect(p.options).toEqual({ lightPreview: false, tour: true, bakeCamera: true, autoZoomed: false });
    const cut = currentCut(p);
    expect(cut.clips.map((c) => [c.in, c.out])).toEqual([[0, 8000]]);
    expect(cut.look.padding).toBeGreaterThan(0);
    expect([cut.zooms, cut.layouts, cut.overlays, cut.cards, cut.media, cut.voiceovers]).toEqual([[], [], [], [], [], []]);
    expect(cut.fit).toBe('stack');
  });
});
