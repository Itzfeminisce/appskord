import { TEN_MINUTE_TELLING } from './ten';
import { THIRTY_MINUTE_TELLING } from './thirty';
import { TWENTY_MINUTE_TELLING } from './twenty';
import type { Telling } from './types';

export type { Telling };
export const LINE_MS = 10_000;
export const TELLINGS: readonly Telling[] = [TEN_MINUTE_TELLING, TWENTY_MINUTE_TELLING, THIRTY_MINUTE_TELLING];
