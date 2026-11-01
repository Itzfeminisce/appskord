import { createRouter } from '@/lib/router';
import { ReviewShell } from '../sidepanel/components/Player';

/** The player window's one route: the Review player, full screen. */
export const player = createRouter({ Review: () => <ReviewShell tab="Review" window>{() => null}</ReviewShell> });
