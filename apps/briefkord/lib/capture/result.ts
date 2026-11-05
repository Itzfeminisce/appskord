/** Why reading a tab failed: no grant for it, a page Chrome never lets extensions read, or anything else. */
export type CaptureProblem = 'no-access' | 'restricted' | 'failed';
export type CaptureResult<T> = { ok: true; value: T } | { ok: false; problem: CaptureProblem; message: string };

export function captureProblem(error: unknown): { ok: false; problem: CaptureProblem; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/cannot be scripted|chrome:\/\/|chrome-extension:\/\/|extensions gallery|webstore/i.test(message)) return { ok: false, problem: 'restricted', message };
  if (/permission|cannot access|host/i.test(message)) return { ok: false, problem: 'no-access', message };
  return { ok: false, problem: 'failed', message };
}
