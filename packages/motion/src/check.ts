/** v3 machine check: budgets, verdicts and fallbacks. Pure, so the check page and tests share them. */
export type Verdict = 'Pass' | 'Slow' | 'Fail';
export type Numbers = Record<string, number | string | boolean | null>;
export type V3Id = 'blocks' | 'preview' | 'export30' | 'export60' | 'memory';

export interface V3Row {
  id: V3Id;
  name: string;
  budget: string;
  verdict: Verdict;
  value: number | null;
  unit: string;
  fallback: string | null;
  numbers: Numbers;
}

export const SCENE = { seconds: 15, width: 1080, height: 1920, seed: 7 } as const;
export const V3_BUDGET = { previewFps: 30, previewSeconds: 10, exportRatio: 4, memoryMb: 1536 } as const;

export const V3_ROWS: readonly { id: V3Id; name: string; budget: string; fallback: string }[] = [
  {
    id: 'blocks',
    name: 'Building blocks load',
    budget: 'All load, no eval, no remote code',
    fallback: 'v2 clips keep drawing with @appskord/scenes',
  },
  {
    id: 'preview',
    name: 'Preview speed',
    budget: `≥ ${V3_BUDGET.previewFps} fps at reduced quality`,
    fallback: 'fewer effects in preview',
  },
  {
    id: 'export30',
    name: 'Export 30 fps',
    budget: `≤ ${V3_BUDGET.exportRatio}x clip length (${SCENE.seconds * V3_BUDGET.exportRatio} s)`,
    fallback: 'export takes longer; quality never drops',
  },
  // 60 fps renders twice the frames, so its budget is twice the 30 fps one.
  {
    id: 'export60',
    name: 'Export 60 fps',
    budget: `≤ ${V3_BUDGET.exportRatio * 2}x clip length (${SCENE.seconds * V3_BUDGET.exportRatio * 2} s)`,
    fallback: '30 fps default',
  },
  {
    id: 'memory',
    name: 'Memory',
    budget: `< ${V3_BUDGET.memoryMb / 1024} GB during export`,
    fallback: '30 fps default, fewer effects in preview',
  },
];

export function blocksVerdict(loaded: number, total: number): Verdict {
  return loaded === total ? 'Pass' : 'Fail';
}

export function previewVerdict(meanFps: number): Verdict {
  return meanFps >= V3_BUDGET.previewFps ? 'Pass' : 'Slow';
}

export function exportVerdict(seconds: number, fps: 30 | 60, clipSeconds: number = SCENE.seconds): Verdict {
  return seconds <= clipSeconds * V3_BUDGET.exportRatio * (fps / 30) ? 'Pass' : 'Slow';
}

export function memoryVerdict(peakMb: number): Verdict {
  return peakMb < V3_BUDGET.memoryMb ? 'Pass' : 'Slow';
}

/** Builds a row; a row that misses its budget names the fallback the build will use. */
export function v3Row(id: V3Id, verdict: Verdict, value: number | null, unit: string, numbers: Numbers): V3Row {
  const spec = V3_ROWS.find((r) => r.id === id)!;
  return {
    id,
    name: spec.name,
    budget: spec.budget,
    verdict,
    value,
    unit,
    fallback: verdict === 'Pass' ? null : spec.fallback,
    numbers,
  };
}

export function failedRow(id: V3Id, error: unknown): V3Row {
  return v3Row(id, 'Fail', null, '', { error: error instanceof Error ? error.message : String(error) });
}
