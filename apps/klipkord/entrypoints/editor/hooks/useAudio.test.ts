import { describe, expect, it } from 'vitest';
import { blankCut } from '@/lib/project/cuts';
import type { Source } from '@/lib/project/types';
import { audioTarget, needsSeek } from './useAudio';

const mic: Source = { id: 'mic', kind: 'mic', file: 'voice', mime: 'audio/webm', offset: 500, duration: 20_000, video: false, audio: true };
const cut = blankCut({
  name: 'Full', made: 'full', clips: [
    { id: 'a', in: 1000, out: 3000, speed: 1 },
    { id: 'gap', in: 0, out: 1000, speed: 1, gap: true },
    { id: 'b', in: 8000, out: 12_000, speed: 2, naturalVoice: false },
  ],
});

describe('preview audio follows the cut', () => {
  it('plays the source at the clip time, minus where the source starts', () => {
    expect(audioTarget(cut, mic, 500)).toEqual({ t: 1, rate: 1, naturalVoice: true, clip: 'a' });
  });

  it('is silent in a gap and past the end', () => {
    expect(audioTarget(cut, mic, 2500)).toBeNull();
    expect(audioTarget(cut, mic, 60_000)).toBeNull();
  });

  it('jumps over cut-away time and keeps the clip speed', () => {
    // Clip b starts at output 3000 ms: 2000 of clip a, then 1000 of gap.
    expect(audioTarget(cut, mic, 3000 + 1000)).toEqual({ t: 9.5, rate: 2, naturalVoice: false, clip: 'b' });
  });

  it('seeks when the playhead crosses into the next clip, even over a cut shorter than the drift allowance', () => {
    const short = blankCut({ name: 'Full', made: 'full', clips: [
      { id: 'one', in: 0, out: 5000, speed: 1 },
      { id: 'two', in: 5200, out: 10_000, speed: 1 },
    ] });
    const voice = { ...mic, offset: 0 };
    const before = audioTarget(short, voice, 4990)!;
    const after = audioTarget(short, voice, 5010)!;
    expect(after).toEqual({ t: 5.21, rate: 1, naturalVoice: true, clip: 'two' });
    // The element ran on to 5.01 s: inside the drift allowance, yet 200 ms of cut-away sound.
    expect(needsSeek(before, after, 5.01)).toBe(true);
    expect(needsSeek(after, audioTarget(short, voice, 5100)!, 5.3)).toBe(false);
  });

  it('seeks when the speed changes and when sound starts', () => {
    const at = audioTarget(cut, mic, 500)!;
    expect(needsSeek({ ...at, rate: 2 }, at, at.t)).toBe(true);
    expect(needsSeek(undefined, at, at.t)).toBe(true);
    expect(needsSeek(at, at, at.t + 0.3)).toBe(true);
  });
});
