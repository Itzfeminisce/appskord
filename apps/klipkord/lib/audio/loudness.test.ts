import { describe, expect, it } from 'vitest';
import { CEILING, gainTo, integratedLoudness, level, limit, Limiter, LoudnessMeter, momentaryLoudness, TARGET_LUFS } from './loudness';

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

  it('meters in pieces to the same loudness as the whole buffer', () => {
    const s = new Float32Array(6 * SR);
    s.set(sine(0.3, 440, 2), 0);
    s.set(sine(0.05, 2000, 3), 2.5 * SR);
    const chs = [s, s.map((v) => v * 0.5)];
    const meter = new LoudnessMeter(SR, 2);
    for (let at = 0; at < s.length; at += 12_345) meter.push(chs.map((c) => c.subarray(at, at + 12_345)));
    expect(meter.integrated()).toBeCloseTo(integratedLoudness(chs, SR), 2);
  });

  it('limits in pieces exactly as all at once, gliding the gain down across the look-ahead', () => {
    const x = sine(0.5, 100, 1);
    x[24_000] = 2;
    const whole = [x.slice()];
    limit(whole, SR);
    const l = new Limiter(SR, 1);
    const out = [...[5000, 7000, 36_000].flatMap((n, k, ns) => {
      const at = ns.slice(0, k).reduce((a, b) => a + b, 0);
      return [...l.process([x.subarray(at, at + n)])[0]!];
    }), ...l.flush()[0]!];
    expect(out).toHaveLength(x.length);
    expect(out.every((v, i) => Math.abs(v - whole[0]![i]!) < 1e-6)).toBe(true);
    expect(peak(whole)).toBeLessThanOrEqual(CEILING + 1e-6);
    // The gain steps no more than a look-ahead's share at a time on its way down to the spike.
    const gains = Array.from({ length: 240 }, (_, k) => 24_000 - 240 + k).filter((i) => Math.abs(x[i]!) > 0.05).map((i) => whole[0]![i]! / x[i]!);
    for (let i = 1; i < gains.length; i++) expect(gains[i - 1]! - gains[i]!).toBeLessThan(0.01);
    expect(gains[0]).toBeGreaterThan(0.9);
  });
});
