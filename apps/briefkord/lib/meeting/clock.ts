/** Meeting time: how long went on each section, and how the timer reads. Pure: `now` comes from the caller. */

/** `section` is where time runs now; null when the clock is stopped (the end screen). */
export interface Clock {
  section: string | null;
  since: number;
  spent: Readonly<Record<string, number>>;
}

export const startClock = (section: string | null, now: number): Clock => ({ section, since: now, spent: {} });

/** Books the time since the last switch to the running section, then runs for `section` (null stops it). */
export function switchSection(clock: Clock, section: string | null, now: number): Clock {
  if (clock.section === section) return clock;
  const run = clock.section;
  const spent = run === null ? clock.spent : { ...clock.spent, [run]: (clock.spent[run] ?? 0) + Math.max(0, now - clock.since) };
  return { section, since: now, spent };
}

/** Milliseconds spent on one section so far. */
export function spentIn(clock: Clock, section: string, now: number): number {
  return (clock.spent[section] ?? 0) + (clock.section === section ? Math.max(0, now - clock.since) : 0);
}

/** Milliseconds spent on the whole meeting so far. */
export function elapsed(clock: Clock, now: number): number {
  const booked = Object.values(clock.spent).reduce((sum, ms) => sum + ms, 0);
  return booked + (clock.section === null ? 0 : Math.max(0, now - clock.since));
}

/** How far past its planned minutes a time is; 0 when on time or nothing is planned. */
export const overBy = (ms: number, minutes: number): number => (minutes > 0 ? Math.max(0, ms - minutes * 60_000) : 0);

const seconds = (ms: number) => Math.max(0, Math.floor(ms / 1000));
const pad = (n: number) => String(n).padStart(2, '0');

/** "06:40": the running timer. */
export function clockText(ms: number): string {
  const s = seconds(ms);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** "2:05": a time on the end screen. */
export function durationText(ms: number): string {
  const s = seconds(ms);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** The header timer: "06:40" "/ 15 min", or over time "16:20" "/ 15 min · 1 min over". */
export function timerText(ms: number, plannedMinutes: number): { time: string; plan: string; over: boolean } {
  const time = clockText(ms);
  if (plannedMinutes <= 0) return { time, plan: '', over: false };
  const over = overBy(ms, plannedMinutes);
  if (over <= 0) return { time, plan: `/ ${plannedMinutes} min`, over: false };
  return { time, plan: `/ ${plannedMinutes} min · ${Math.max(1, Math.floor(over / 60_000))} min over`, over: true };
}
