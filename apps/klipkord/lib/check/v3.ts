import { mean, round } from './stats';

// Targets from PLAN "Performance budget" for Klipkord v3.
export const BUDGET = {
  // Export 5 min at 1080p30 in under 5 min needs 30 fps; 720p "Fast" under 3 min needs 50 fps.
  encode: { '720p': 50, '1080p': 30 },
  previewFps: 30,
  firstFrameMs: 3000,
  seekMs: 300,
  memoryMb: 1500,
  // Camera blur: the light preview mask a few times a second; export with blur in up to 2x the plain time needs ~encode fps.
  segment: { preview: 10, export: 30 },
} as const;

export type Verdict = 'pass' | 'miss';
export type Size = keyof typeof BUDGET.encode;

export function fpsOf(frames: number, ms: number): number {
  return ms > 0 && frames > 0 ? round((frames / ms) * 1000) : 0;
}

export interface EncodeVerdict {
  supported: boolean;
  fps: number;
  verdict: Verdict;
  target: number;
}

export function encodeVerdict(size: Size, supported: boolean, frames: number, ms: number): EncodeVerdict {
  const target = BUDGET.encode[size];
  const fps = supported ? fpsOf(frames, ms) : 0;
  return { supported, fps, verdict: supported && fps >= target ? 'pass' : 'miss', target };
}

export interface DecodeVerdict {
  firstFrameMs: number;
  meanSeekMs: number;
  worstSeekMs: number;
  seeks: number;
  verdict: Verdict;
}

export function decodeVerdict(firstFrameMs: number, seekMs: number[]): DecodeVerdict {
  const meanSeekMs = round(mean(seekMs));
  const ok = seekMs.length > 0 && firstFrameMs > 0 && firstFrameMs < BUDGET.firstFrameMs && meanSeekMs < BUDGET.seekMs;
  return {
    firstFrameMs: round(firstFrameMs),
    meanSeekMs,
    worstSeekMs: round(Math.max(0, ...seekMs)),
    seeks: seekMs.length,
    verdict: ok ? 'pass' : 'miss',
  };
}

export function drawVerdict(frames: number, ms: number): { fps: number; verdict: Verdict } {
  const fps = fpsOf(frames, ms);
  return { fps, verdict: fps >= BUDGET.previewFps ? 'pass' : 'miss' };
}

export interface SegmentVerdict { previewFps: number; exportFps: number; verdict: Verdict }

/** Person masks per second at preview and export size, round trip to the worker included. */
export function segmentVerdict(preview: { frames: number; ms: number }, exp: { frames: number; ms: number }): SegmentVerdict {
  const previewFps = fpsOf(preview.frames, preview.ms);
  const exportFps = fpsOf(exp.frames, exp.ms);
  const ok = previewFps >= BUDGET.segment.preview && exportFps >= BUDGET.segment.export;
  return { previewFps, exportFps, verdict: ok ? 'pass' : 'miss' };
}

// Timestamp (us) of the last key frame at or before `target`; decoding a seek starts there.
export function keyframeBefore(keyframes: number[], target: number): number {
  let found = keyframes[0] ?? 0;
  for (const k of keyframes) {
    if (k <= target) found = k;
    else break;
  }
  return found;
}

// Evenly spread seek targets that do not need a random source in tests: pass any [0,1) values.
export function seekPoints(unit: number[], durationUs: number): number[] {
  return unit.map((u) => Math.floor(Math.min(Math.max(u, 0), 0.999999) * durationUs));
}

export function memoryLine(usedBytes: number | null): { usedMb: number | null; verdict: Verdict | null } {
  if (usedBytes === null) return { usedMb: null, verdict: null };
  const usedMb = Math.round(usedBytes / 1_048_576);
  return { usedMb, verdict: usedMb < BUDGET.memoryMb ? 'pass' : 'miss' };
}

export interface V3Row {
  measure: string;
  verdict: Verdict | 'not measured';
  numbers: string;
}

export function summaryRow(measure: string, verdict: Verdict | null, numbers: string): V3Row {
  return { measure, verdict: verdict ?? 'not measured', numbers };
}

// Plain text for pasting; holds measures only, no personal data.
export function resultsText(rows: V3Row[], machine: { cores: number | null; chrome: string | null }): string {
  const head = `Klipkord v3 machine check, Chrome ${machine.chrome ?? '?'}, ${machine.cores ?? '?'} cores`;
  return [head, ...rows.map((r) => `${r.measure}: ${r.verdict}${r.numbers ? ` (${r.numbers})` : ''}`)].join('\n');
}
