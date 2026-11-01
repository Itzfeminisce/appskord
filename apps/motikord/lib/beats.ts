import type { Edit } from './editor/store';
import type { PatchOp, Recipe } from './types';

/** Cuts pull onto a beat only when one is this close. */
export const SNAP_MS = 150;
const MIN_SCENE_MS = 500;

export interface BeatResult { beats: number[]; bpm: number | null }

/** Energy flux onsets and a tempo estimate. No steady beat gives `{ beats: [], bpm: null }`. */
export function detectBeats(samples: Float32Array, sampleRate: number): BeatResult {
  const none: BeatResult = { beats: [], bpm: null };
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  const n = Math.floor(samples.length / hop);
  if (n < 50) return none;
  const energy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += samples[j]! * samples[j]!;
    energy[i] = Math.sqrt(s / hop);
  }
  const flux = new Float32Array(n);
  let max = 0, sum = 0;
  for (let i = 1; i < n; i++) { flux[i] = Math.max(0, energy[i]! - energy[i - 1]!); max = Math.max(max, flux[i]!); sum += flux[i]!; }
  if (max < 1e-4) return none;
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (flux[i]! - mean) ** 2;
  const threshold = Math.max(mean + Math.sqrt(varSum / n), max * 0.3);
  const gap = 25; // 250 ms between onsets at most 240 BPM
  const onsets: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (flux[i]! >= threshold && flux[i]! >= flux[i - 1]! && flux[i]! > flux[i + 1]!) {
      if (onsets.length && i - onsets[onsets.length - 1]! < gap) { if (flux[i]! > flux[onsets[onsets.length - 1]!]!) onsets[onsets.length - 1] = i; } else onsets.push(i);
    }
  }
  if (onsets.length < 4) return none;
  // Tempo: the autocorrelation lag (60 to 200 BPM) that the onsets agree on best.
  let bestLag = 0, best = 0;
  for (let lag = 30; lag <= 100; lag++) {
    let score = 0;
    for (const o of onsets) { const k = o + lag; for (let d = -1; d <= 1; d++) if (flux[k + d]! >= threshold) { score += flux[k + d]!; break; } }
    if (score > best) { best = score; bestLag = lag; }
  }
  if (!bestLag) return none;
  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) { const d = onsets[i]! - onsets[i - 1]!; if (Math.abs(d - bestLag) <= bestLag * 0.15) intervals.push(d); }
  if (intervals.length < 3 || intervals.length < (onsets.length - 1) * 0.6) return none;
  intervals.sort((a, b) => a - b);
  const period = intervals[Math.floor(intervals.length / 2)]!;
  const beats = onsets.map((o) => Math.round((o * hop * 1000) / sampleRate));
  return { beats, bpm: Math.round(6000 / period) };
}

/** BPM from the median gap between stored beats, or null when there are too few. */
export function bpmOf(beats: readonly number[] | undefined): number | null {
  if (!beats || beats.length < 4) return null;
  const gaps = beats.slice(1).map((b, i) => b - beats[i]!).sort((a, b) => a - b);
  const mid = gaps[Math.floor(gaps.length / 2)]!;
  return mid > 0 ? Math.round(60000 / mid) : null;
}

export function nearestBeat(ms: number, beats: readonly number[], tolMs = SNAP_MS): number {
  let out = ms, gap = tolMs + 1;
  for (const b of beats) { const d = Math.abs(b - ms); if (d <= tolMs && d < gap) { out = b; gap = d; } }
  return out;
}

/** Scene lengths with each inner cut moved to the nearest beat within tolMs. The total stays; no scene gets shorter than 500 ms. */
export function snapCuts(sceneDurations: readonly number[], beats: readonly number[], tolMs = SNAP_MS): number[] {
  const out: number[] = [];
  let at = 0, prev = 0;
  const total = sceneDurations.reduce((a, b) => a + b, 0);
  sceneDurations.forEach((d, i) => {
    at += d;
    if (i === sceneDurations.length - 1) { out.push(total - prev); return; }
    const next = at + sceneDurations[i + 1]!;
    let cut = nearestBeat(at, beats, tolMs);
    if (cut - prev < MIN_SCENE_MS || next - cut < MIN_SCENE_MS) {
      cut = prev + d;
      if (next - cut < MIN_SCENE_MS) cut = Math.min(cut, Math.max(next - MIN_SCENE_MS, prev + Math.min(d, MIN_SCENE_MS)));
    }
    out.push(cut - prev);
    prev = cut;
  });
  return out.map((d) => Math.round(d));
}

/** The one Change for beats: stores beats and the switch, and snaps cuts when on. */
export function beatSyncEdit(r: Recipe, beats: readonly number[] | undefined, on: boolean): Edit | undefined {
  const ops: PatchOp[] = [];
  if (beats && JSON.stringify(beats) !== JSON.stringify(r.beats)) ops.push({ op: r.beats ? 'replace' : 'add', path: '/beats', value: [...beats] });
  if (on !== !!r.beatSync) ops.push({ op: r.beatSync === undefined ? 'add' : 'replace', path: '/beatSync', value: on });
  const use = beats ?? r.beats;
  if (on && use?.length) {
    const next = snapCuts(r.scenes.map((s) => s.durationMs), use);
    r.scenes.forEach((s, si) => {
      const ms = next[si]!;
      if (ms === s.durationMs) return;
      ops.push({ op: 'replace', path: `/scenes/${si}/durationMs`, value: ms });
      s.layers.forEach((l, li) => {
        const start = Math.min(l.startMs, Math.max(0, ms - 100));
        const end = Math.max(l.endMs >= s.durationMs || l.endMs > ms ? ms : l.endMs, start + 1);
        if (start !== l.startMs) ops.push({ op: 'replace', path: `/scenes/${si}/layers/${li}/startMs`, value: start });
        if (end !== l.endMs) ops.push({ op: 'replace', path: `/scenes/${si}/layers/${li}/endMs`, value: end });
      });
    });
  }
  return ops.length ? { ops, summary: on ? 'Beat sync on' : 'Beat sync off' } : undefined;
}

export interface BeatDeps { decode: (data: ArrayBuffer) => Promise<{ samples: Float32Array; sampleRate: number }> }

/** Decodes with an OfflineAudioContext (mono mix), on this computer. */
export const browserDecode: BeatDeps['decode'] = async (data) => {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(data);
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i]! += ch[i]! / buf.numberOfChannels; }
  return { samples: mono, sampleRate: buf.sampleRate };
};

export async function findBeats(file: Blob, deps: BeatDeps = { decode: browserDecode }): Promise<BeatResult & { peaks: number[] }> {
  const { samples, sampleRate } = await deps.decode(await file.arrayBuffer());
  const bins = 120, size = Math.max(1, Math.floor(samples.length / bins));
  const peaks = Array.from({ length: bins }, (_, b) => { let m = 0; for (let i = b * size; i < Math.min(samples.length, (b + 1) * size); i++) m = Math.max(m, Math.abs(samples[i]!)); return m; });
  return { ...detectBeats(samples, sampleRate), peaks };
}
