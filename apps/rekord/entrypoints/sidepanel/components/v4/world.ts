import type { CalendarEvent } from '@/lib/types';

/** The clock and calendar v4 screens read; dev frame routes swap in the sample world's. */
export const world: { now: () => number; events?: CalendarEvent[] } = { now: () => Date.now() };
