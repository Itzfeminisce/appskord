// Item meta and quote captions for meetings told after the fact ("… · 2 Nov · From your catch-up"). Pure.
import { dayMonth } from '../memory/brief';
import type { Meeting } from '../types';

export const FROM_CATCHUP = 'From your catch-up';
export const CATCHUP_TAG = 'Catch up';

/** Missing source means a tab recording, so meetings from v1 to v4 are never catch-ups. */
export const isCatchup = (meeting: Pick<Meeting, 'source'> | undefined): boolean => meeting?.source === 'catchup';

/** "Q4 planning with Northwind · 2 Nov · From your catch-up", or "Pricing review · 26 Oct · 40:18" with the caller's clock. */
export function itemMeta(meeting: Pick<Meeting, 'title' | 'startedAt' | 'source'>, clock: string): string {
  return [meeting.title, dayMonth(meeting.startedAt), isCatchup(meeting) ? FROM_CATCHUP : clock].join(' · ');
}

/** Quote caption: the speaker first, then the item meta ("Alex · Q4 planning with Northwind · 2 Nov · From your catch-up"). */
export function quoteCaption(speaker: string, meeting: Pick<Meeting, 'title' | 'startedAt' | 'source'>, clock: string): string {
  return `${speaker} · ${itemMeta(meeting, clock)}`;
}
