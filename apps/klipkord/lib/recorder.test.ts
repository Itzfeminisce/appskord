import { describe, expect, it } from 'vitest';
import {
  SILENT_VIDEO_MIMES, VIDEO_MIMES, badgeTitle, chooseMime, chooseVoiceMime, clockElapsed, clockPause, clockResume, clockStart, containerOf, createChunkWriter, partOffset, planTake,
  shortClock, takeSources, type StartedPart,
} from './recorder';

describe('clock', () => {
  it('counts only the time spent recording, across pauses', () => {
    let c = clockStart(1000);
    expect(clockElapsed(c, 4000)).toBe(3000);
    c = clockPause(c, 4000);
    expect(clockElapsed(c, 60_000)).toBe(3000);
    c = clockResume(c, 60_000);
    expect(clockElapsed(c, 62_500)).toBe(5500);
    c = clockPause(clockPause(c, 63_000), 99_000);
    expect(clockElapsed(c, 120_000)).toBe(6000);
    expect(clockElapsed(clockResume(clockResume(c, 200_000), 300_000), 201_000)).toBe(7000);
  });
});

describe('labels', () => {
  it('formats the badge and its title', () => {
    expect(shortClock(252_000)).toBe('4:12');
    expect(shortClock(754_000)).toBe('12:34');
    expect(badgeTitle(252_000)).toBe('Klipkord is recording, 4 minutes 12 seconds');
    expect(badgeTitle(61_000)).toBe('Klipkord is recording, 1 minute 1 second');
  });
});

describe('mime choice', () => {
  const only = (...types: string[]) => (t: string) => types.includes(t);
  it('prefers WebM VP9, then VP8, over H.264', () => {
    const all = (t: string) => t !== '';
    expect(chooseMime(all, true)).toBe('video/webm;codecs=vp9,opus');
    expect(chooseMime(all, false)).toBe('video/webm;codecs=vp9');
    expect(chooseMime(only('video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp8,opus'), true)).toBe('video/webm;codecs=vp8,opus');
    expect(chooseMime(only('video/mp4;codecs=avc1.640028', 'video/webm;codecs=vp8'), false)).toBe('video/webm;codecs=vp8');
  });
  it('falls back to H.264 at a level that fits 1080p', () => {
    expect(chooseMime(only('video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4'), true)).toBe('video/mp4;codecs=avc1.640028,mp4a.40.2');
    expect(chooseMime(only('video/mp4;codecs=avc1.640028', 'video/mp4'), false)).toBe('video/mp4;codecs=avc1.640028');
    expect([...VIDEO_MIMES, ...SILENT_VIDEO_MIMES].some((m) => m.includes('avc1.42E01E'))).toBe(false);
  });
  it('leaves the choice to Chrome when nothing listed is supported', () => {
    expect(chooseMime(() => false, true)).toBe('');
  });
  it('records the voice as Opus', () => {
    expect(chooseVoiceMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(containerOf('video/mp4;codecs=avc1.42E01E')).toBe('video/mp4');
    expect(containerOf('video/webm;codecs=vp9')).toBe('video/webm');
  });
});

describe('chunk writer', () => {
  it('appends chunks in arrival order even when writes finish out of order', async () => {
    const written: string[] = [];
    const delays = [30, 0, 10];
    let i = 0;
    const writer = createChunkWriter(async (chunk) => {
      await new Promise((r) => setTimeout(r, delays[i++ % delays.length]));
      written.push(await chunk.text());
    });
    ['a', 'bb', 'ccc', 'dddd'].forEach((s) => writer.write(new Blob([s])));
    writer.write(new Blob([]));
    await writer.flush();
    expect(written).toEqual(['a', 'bb', 'ccc', 'dddd']);
    expect(writer.bytes).toBe(10);
  });

  it('keeps writing after a failed chunk and reports it', async () => {
    const written: string[] = [];
    const errors: unknown[] = [];
    const writer = createChunkWriter(async (chunk) => {
      const s = await chunk.text();
      if (s === 'bad') throw new Error('disk');
      written.push(s);
    }, (e) => errors.push(e));
    ['one', 'bad', 'two'].forEach((s) => writer.write(new Blob([s])));
    await writer.flush();
    expect(written).toEqual(['one', 'two']);
    expect(errors).toHaveLength(1);
  });

  it('reports only the first failed write and counts the rest', async () => {
    const errors: unknown[] = [];
    const writer = createChunkWriter(async (chunk) => {
      if ((await chunk.text()).startsWith('bad')) throw new Error('disk');
    }, (e) => errors.push(e));
    ['bad1', 'ok', 'bad2', 'bad3'].forEach((s) => writer.write(new Blob([s])));
    await writer.flush();
    expect(errors).toHaveLength(1);
    expect(writer.failed).toBe(3);
  });
});

describe('planTake', () => {
  it('keeps v2\'s one baked file and the voice when "Bake camera into the video" is on', () => {
    expect(planTake({ bake: true, camera: true, mic: true, sound: true }).map((p) => [p.file, p.kind])).toEqual([['video', null], ['voice', null]]);
    expect(planTake({ bake: true, camera: false, mic: false, sound: false }).map((p) => p.file)).toEqual(['video']);
  });

  it('gives each source its own file when it is off; the mic stays the voice file the transcript reads', () => {
    expect(planTake({ bake: false, camera: true, mic: true, sound: true }).map((p) => [p.file, p.kind])).toEqual([
      ['screen', 'screen'], ['camera', 'camera'], ['voice', 'mic'], ['tab', 'tab'],
    ]);
    expect(planTake({ bake: false, camera: false, mic: false, sound: false }).map((p) => p.file)).toEqual(['screen']);
  });
});

describe('take offsets', () => {
  const part = (file: StartedPart['file'], kind: StartedPart['kind'], startedAt: number, video = false): StartedPart =>
    ({ file, kind, video, audio: !video, mime: video ? 'video/webm' : 'audio/webm', startedAt });

  it('measures every file from the one start clock', () => {
    expect(partOffset(1000, 1040)).toBe(40);
    expect(partOffset(1000, 990)).toBe(0);
    const sources = takeSources([
      { ...part('screen', 'screen', 1000, true), width: 1920, height: 1080 },
      part('camera', 'camera', 1120, true),
      part('voice', 'mic', 1015),
      part('tab', 'tab', 1000),
    ], 1000, 60_000);
    expect(sources.map((s) => [s.kind, s.file, s.offset, s.duration])).toEqual([
      ['screen', 'screen', 0, 60_000], ['camera', 'camera', 120, 59_880], ['mic', 'voice', 15, 59_985], ['tab', 'tab', 0, 60_000],
    ]);
    expect(sources[0]).toMatchObject({ id: 'screen', video: true, audio: false, width: 1920, height: 1080 });
  });

  it('makes no sources for a baked take', () => {
    expect(takeSources([part('video', null, 1000, true), part('voice', null, 1000)], 1000, 5000)).toEqual([]);
  });
});
