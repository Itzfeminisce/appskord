import { describe, expect, it, vi } from 'vitest';
import type { Clip, Cut, Project } from '../project/types';
import { renderCut } from './cut';
import { estimateExport, estimateLine, gifBytes, minShort, minutes, minutesText, pipelineFps, remaining, sizeText, timeLeft, uploadLeft } from './estimate';
import { exportName, extraFiles, sibling, youtubeChapters } from './files';
import { PRESETS, outputSize, overLimit, presetById, shapeFor, shortSide, videoBitrate } from './presets';
import { frameCount, frameOut, frameSchedule } from './schedule';
import { titleLines } from './title';

const clip = (id: string, a: number, b: number, speed = 1, gap?: boolean): Clip => ({ id, in: a, out: b, speed, ...(gap && { gap }) });
const cutOf = (clips: Clip[], extra: Partial<Cut> = {}) => ({ id: 'c1', name: 'Full', shape: '16:9', clips, tracks: {}, captions: { show: false }, ...extra }) as unknown as Cut;

describe('presets and limits', () => {
  it('lists the frame presets in order', () => {
    expect(PRESETS.map((p) => [p.name, p.sub])).toEqual([
      ['YouTube', '16:9 · 1080p'], ['Shorts, Reels, TikTok', '9:16 · 1080p'], ['LinkedIn', '1:1 or 16:9'], ['X', '16:9 · 720p'], ['Custom', 'Any size'],
    ]);
  });

  it('measures how far a cut runs over the limit, and never blocks', () => {
    expect(overLimit(presetById('shorts'), 348_000)).toBe(168_000);   // 5:48 is over 3:00 by 2:48
    expect(overLimit(presetById('shorts'), 180_000)).toBe(0);
    expect(overLimit(presetById('youtube'), 10 * 3_600_000)).toBe(0);
    expect(overLimit(presetById('x'), 141_000)).toBe(1000);
  });

  it('keeps the cut shape where the preset takes it', () => {
    expect(shapeFor(presetById('shorts'), '16:9')).toBe('9:16');
    expect(shapeFor(presetById('linkedin'), '1:1')).toBe('1:1');
    expect(shapeFor(presetById('linkedin'), '9:16')).toBe('1:1');
    expect(shapeFor(presetById('custom'), '4:5')).toBe('4:5');
  });

  it('sizes the output by quality, capped by the preset', () => {
    expect(shortSide(presetById('youtube'), 'best')).toBe(1080);
    expect(shortSide(presetById('x'), 'best')).toBe(720);
    expect(outputSize('16:9', 1080)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize('16:9', 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('4:5', 720)).toEqual({ width: 720, height: 900 });
    expect(videoBitrate(1920, 1080)).toBe(3_000_000);
  });
});

describe('estimate', () => {
  it('runs render and encode one after the other', () => {
    // 45 fps render and 90 fps encode at 1080p make 30 fps.
    expect(pipelineFps(1920, 1080, 90)).toBeCloseTo(30);
    // 720p draws 2.25x faster; with no H.264 probe the software rate scales the same way.
    expect(pipelineFps(1280, 720, 0)).toBeCloseTo(1 / (1 / 101.25 + 1 / 40.5));
  });

  it('gives the frame line for 5:48 at 1080p', () => {
    const e = estimateExport({ lengthMs: 348_000, width: 1920, height: 1080, encoderFps: 90, audio: true });
    expect(e.seconds).toBeCloseTo(10_440 / 30);
    expect(e.bytes).toBe(Math.round(((3_128_000 * 348) / 8) * 1.01));
    expect(estimateLine(e)).toBe('About 6 min on this computer · about 137 MB');
  });

  it('formats sizes and times as the frames do', () => {
    expect(sizeText(6_200_000)).toBe('6.2 MB');
    expect(sizeText(142_400_000)).toBe('142 MB');
    expect(minutes(20)).toBe(1);
    expect(minutesText(540)).toBe('about 9 minutes');
    expect(minutesText(70)).toBe('about 1 minute');
    expect(minutesText(50)).toBe('under a minute');
    expect(minShort(50)).toBe('1 min');
    expect(minShort(300)).toBe('5 min');
    expect(timeLeft(91)).toBe('about 1 min 30 s left');
    expect(timeLeft(42)).toBe('about 42 s left');
    expect(timeLeft(120)).toBe('about 2 min left');
    expect(uploadLeft(70)).toBe('About 1 min left.');
    expect(remaining(25, 100, 10_000)).toBe(30);
    expect(remaining(0, 100, 10_000)).toBeNull();
  });

  it('estimates a GIF from frames and pixels', () => {
    // 15 s, 640x360 at 12.5 fps is the T0 measure (3.4 MB for 188 frames).
    expect(gifBytes(15_040, 640, 360, 12.5)).toBe(3_400_000);
    expect(gifBytes(8000, 640, 360, 15)).toBeGreaterThan(gifBytes(8000, 640, 360, 10));
  });
});

describe('frame schedule', () => {
  // 0..1000 at 1x, 2000..4000 at 2x (1000 ms out), a 500 ms gap, 5000..5500 at 0.5x (1000 ms out): 3.5 s out.
  const cut = cutOf([clip('a', 0, 1000), clip('b', 2000, 4000, 2), clip('g', 0, 500, 1, true), clip('c', 5000, 5500, 0.5)]);

  it('spaces frames evenly in output time at 30 fps', () => {
    expect(frameCount(3500, 30)).toBe(105);
    expect(frameCount(1000, 30)).toBe(30);
    expect(frameOut(30, 30)).toBe(1000);
    const all = [...frameSchedule(cut, 3500)];
    expect(all).toHaveLength(105);
    expect(all.every((f, i) => f.index === i && Math.abs(f.out - (i * 1000) / 30) < 1e-9)).toBe(true);
  });

  it('walks the recording faster in a sped-up clip, shows nothing in a gap and slows down after', () => {
    const at = (i: number) => [...frameSchedule(cut, 3500)][i]!;
    expect(at(29).rec).toBeCloseTo(966.67, 1);
    expect(at(30).rec).toBe(2000);
    expect(at(31).rec! - at(30).rec!).toBeCloseTo(66.67, 1);     // 2x: two frames' worth of recording per frame
    expect(at(66).rec).toBeNull();                                 // 2200 ms out is in the gap
    expect(at(76).rec).toBeCloseTo(5000 + (2533.33 - 2500) * 0.5, 1);
    expect(at(77).rec! - at(76).rec!).toBeCloseTo(16.67, 1);     // 0.5x
  });

  it('covers only the asked part for a GIF', () => {
    const part = [...frameSchedule(cut, 3500, 10, 1000, 2000)];
    expect(part.map((f) => f.out)).toEqual([1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]);
  });
});

describe('files', () => {
  const project = {
    name: 'Invite your team', cuts: [{ id: 'c1' }, { id: 'c2' }], translations: {},
    chapters: [{ at: 500, title: 'Intro' }, { at: 2500, title: 'Cut away' }, { at: 5200, title: 'Roles' }],
  } as unknown as Project;
  const cut = cutOf([clip('a', 0, 2000), clip('b', 5000, 125_000)]);

  it('names the export after the project, and other cuts after both', () => {
    expect(exportName(project, cut, 'mp4')).toBe('Invite your team.mp4');
    expect(exportName(project, { ...cut, id: 'c2', name: 'LinkedIn 30s' }, 'webm')).toBe('Invite your team - LinkedIn 30s.webm');
    expect(sibling('Invite your team.mp4', 'srt')).toBe('Invite your team.srt');
  });

  it('lists YouTube chapters in output time from 0:00, dropping cut ones', () => {
    expect(youtubeChapters(project, cut)).toBe('0:00 Intro\n0:02 Roles\n');
    expect(youtubeChapters({ ...project, chapters: [] }, cut)).toBe('');
  });

  it('writes SRT and VTT beside the video when asked', () => {
    const captions = [{ start: 100, end: 900, text: 'Hello there', words: [{ index: 0, text: 'Hello', start: 100, end: 500 }, { index: 1, text: 'there', start: 500, end: 900 }] }];
    const files = extraFiles(project, { ...cut, captions: { show: false, style: 'clean', position: 'bottom', size: 1 } } as Cut, captions, 'a.mp4', { captionFiles: true, chapters: true });
    expect(files.map((f) => f.name)).toEqual(['a.srt', 'a.vtt', 'a.chapters.txt']);
    expect(files[0]!.data).toContain('Hello there');
    expect(files[1]!.data.startsWith('WEBVTT')).toBe(true);
  });
});

describe('render cut', () => {
  it('sets the shape, captions and camera for this export only', () => {
    const cut = cutOf([clip('a', 0, 1000)], { tracks: { camera: { locked: true } } });
    const r = renderCut(cut, { shape: '9:16', burn: true, camera: false });
    expect(r.shape).toBe('9:16');
    expect(r.captions.show).toBe(true);
    expect(r.tracks.camera).toEqual({ locked: true, hidden: true });
    expect(cut.tracks.camera).toEqual({ locked: true });
    expect(renderCut(cut, {})).toEqual(cut);
  });
});

describe('thumbnail title', () => {
  it('wraps words and cuts after three lines', () => {
    const measure = vi.fn((s: string) => s.length * 10);
    expect(titleLines('Invite your team in 1 minute', 120, measure)).toEqual(['Invite your', 'team in 1', 'minute']);
    expect(titleLines('a b c d e f g h', 30, measure)).toEqual(['a b', 'c d', 'e f…']);
  });
});
