import type { Verdict } from './verdict';

export const TESTS = [
  { id: 'preview', name: '1. Preview' },
  { id: 'mp4', name: '2. Export MP4' },
  { id: 'webm', name: '3. Export WebM' },
  { id: 'alpha', name: '4. See-through WebM' },
  { id: 'gif', name: '5. GIF' },
  { id: 'audio', name: '6. Audio' },
  { id: 'ai', name: '7. Built-in AI' },
  { id: 'memory', name: '8. Memory' },
] as const;

export type TestId = (typeof TESTS)[number]['id'];
export type Numbers = Record<string, number | string | boolean | null>;
export interface TestResult { verdict: Verdict; numbers: Numbers; error?: string }

/** Turns a failure into a Fail result with its message. */
export function failed(error: unknown, numbers: Numbers = {}): TestResult {
  return { verdict: 'Fail', numbers, error: error instanceof Error ? error.message : String(error) };
}

/** The JSON that Copy results puts on the clipboard: machine facts, then every test in order, run or not. */
export function shapeResults(machine: Numbers, results: Partial<Record<TestId, TestResult>>, at: string) {
  return {
    app: 'Motikord machine check',
    at,
    machine,
    tests: TESTS.map(({ id, name }) => {
      const r = results[id];
      return r ? { id, name, verdict: r.verdict, ...r.numbers, ...(r.error ? { error: r.error } : {}) } : { id, name, verdict: 'Not run' };
    }),
  };
}

/** One line per number for the page's Numbers cell. */
export function numbersText(numbers: Numbers): string {
  return Object.entries(numbers).map(([k, v]) => `${k}: ${v}`).join('\n');
}
