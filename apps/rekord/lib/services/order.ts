import type { MemoryItem } from '../memory/types';

/** Promises in the frames' order: yours first, then by due date, no date last. */
export function promiseOrder(a: MemoryItem, b: MemoryItem): number {
  const mine = Number(b.ownerId === 'me') - Number(a.ownerId === 'me');
  return mine || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt - b.createdAt;
}
