import { describe, expect, it } from 'vitest';
import { CEILING, gainTo, integratedLoudness, level, limit, momentaryLoudness, TARGET_LUFS } from './loudness';

const SR = 48_000;
const sine = (amp: number, freq = 997, seconds = 3, sr = SR) =>
  Float32Array.from({ length: seconds * sr }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sr));
const peak = (chs: Float32Array[]) => Math.max(...chs.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));

describe('loudness', () => {
  it('reads a full-scale 997 Hz sine as -3.01 LUFS (BS.1770 reference)', () => {
    expect(integratedLoudness([sine(1)], SR)).toBeCloseTo(-3.01, 1);
    expect(integratedLoudness([sine(1, 997, 3, 44_100)], 44_100)).toBeCloseTo(-3.01, 1);
  });

  it('adds channels and follows level in dB', () => {
    expect(integratedLoudness([sine(1), sine(1)], SR)).toBeCloseTo(0, 1);
    expect(integratedLoudness([sine(0.1)], SR)).toBeCloseTo(-23.01, 1);
  });

  it('gates out silence: a tone with long silence reads as the tone', () => {
    const s = new Float32Array(6 * SR);
    s.set(sine(0.1), 0);
    // Ungated, half silence would read 3 dB lower; only the edge blocks pull it down a little.
    expect(integratedLoudness([s], SR)).toBeCloseTo(-23.01, 0);
    expect(integratedLoudness([new Float32Array(SR)], SR)).toBe(-Infinity);
    expect(integratedLoudness([new Float32Array(100)], SR)).toBe(-Infinity);
  });

  it('meters momentary loudness every 100 ms', () => {
    const m = momentaryLoudness([sine(1, 997, 1)], SR);
    expect(m).toHaveLength(7);
    expect(m[3]).toBeCloseTo(-3.01, 1);
  });

  it('works out the gain to -14 LUFS, capped at +20 dB, and none for silence', () => {
    expect(gainTo(-23)).toBeCloseTo(10 ** (9 / 20), 6);
    expect(gainTo(-60)).toBeCloseTo(10, 6);
    expect(gainTo(-Infinity)).toBe(1);
  });

  it('limits peaks to the ceiling and leaves quiet audio alone', () => {
    const loud = [sine(2, 440, 1)];
    limit(loud, SR);
    expect(peak(loud)).toBeLessThanOrEqual(CEILING + 1e-6);
    const quiet = [sine(0.5, 440, 1)];
    limit(quiet, SR);
    expect(peak(quiet)).toBeCloseTo(0.5, 3);
  });

  it('levels a quiet voice to the target without clipping', () => {
    const chs = [sine(0.05)];
    const { before, gain } = level(chs, SR);
    expect(before).toBeCloseTo(-29.03, 1);
    expect(gain).toBeGreaterThan(1);
    expect(integratedLoudness(chs, SR)).toBeCloseTo(TARGET_LUFS, 0);
    expect(peak(chs)).toBeLessThanOrEqual(CEILING + 1e-6);
  });
});
