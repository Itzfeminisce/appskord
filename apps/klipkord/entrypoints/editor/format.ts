/** Editor times: 402000 → "6:42"; with tenths, 27400 → "0:27.4"; an hour or more → "1:02:03". */
export function clock(ms: number, tenths = false): string {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const total = Math.floor(safe / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  const head = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  return tenths ? `${head}.${Math.floor((safe % 1000) / 100)}` : head;
}

/** Seconds with one decimal, for the opening steps: 800 → "0.8 s". */
export const seconds = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

/** Whole minutes since `at`, at least 1; a time in the future (another clock, a later tab) reads as 1. */
export function minutesAgo(at: number, now: number): number {
  const ms = now - at;
  return Number.isFinite(ms) ? Math.max(1, Math.round(Math.max(0, ms) / 60_000)) : 1;
}
