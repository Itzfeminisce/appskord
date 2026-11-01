import { EXPORT, MEMORY_BUDGET_MB, PREVIEW } from './plan';

/** Pass meets the plan's budget, Slow misses it, Fail means the test could not run or the feature is missing. */
export type Verdict = 'Pass' | 'Slow' | 'Fail';

export function previewVerdict(meanFps: number): Verdict {
  return meanFps >= PREVIEW.minFps ? 'Pass' : 'Slow';
}

/** Budget scales with clip length: 15 s of 1080p30 in 30 s, so twice the clip's length. */
export function exportVerdict(seconds: number, clipSeconds: number = EXPORT.seconds): Verdict {
  return seconds <= clipSeconds * (EXPORT.budgetSeconds / EXPORT.seconds) ? 'Pass' : 'Slow';
}

export function memoryVerdict(usedMb: number): Verdict {
  return usedMb < MEMORY_BUDGET_MB ? 'Pass' : 'Slow';
}

export function supportVerdict(supported: boolean): Verdict {
  return supported ? 'Pass' : 'Fail';
}
