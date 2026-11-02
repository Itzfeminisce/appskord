import type { ItemStatus, MemoryItem, Quote } from './types';

export type ItemEvent =
  | { type: 'confirm' }
  | { type: 'edit'; changes: Partial<Pick<MemoryItem, 'text' | 'ownerId' | 'toId' | 'personIds' | 'due'>> }
  | { type: 'done' }
  | { type: 'undo' }
  | { type: 'snooze'; until: number }
  | { type: 'drop'; reason: NonNullable<MemoryItem['dropReason']> | NonNullable<MemoryItem['dismissReason']> }
  | { type: 'looksDone'; evidence: Quote }
  | { type: 'notYet' }
  | { type: 'answer'; quote?: Quote }
  | { type: 'replace'; byId: string }
  | { type: 'undoReplace' };

const LIVE: ItemStatus[] = ['suggested', 'open', 'looksDone'];

/** True when `event` is allowed for the item's kind and status. */
export function canApply(item: MemoryItem, event: ItemEvent): boolean {
  const { kind, status } = item;
  switch (event.type) {
    case 'confirm': return status === 'suggested';
    case 'edit': return LIVE.includes(status);
    case 'done': return kind === 'promise' && (status === 'open' || status === 'looksDone');
    case 'undo': return ['done', 'dropped', 'answered', 'dismissed'].includes(status);
    case 'snooze': return kind === 'promise' && status === 'open';
    case 'drop':
      return event.reason === 'notAPromise' || event.reason === 'wrongPerson'
        ? status === 'suggested'
        : kind === 'promise' && (status === 'open' || status === 'looksDone');
    case 'looksDone': return kind === 'promise' && status === 'open';
    case 'notYet': return status === 'looksDone';
    case 'answer': return kind === 'question' && status === 'open';
    case 'replace': return kind === 'decision' && status === 'open';
    case 'undoReplace': return status === 'replaced';
  }
}

/** Applies a user's click. Returns the same object when the event does not apply. */
export function transition(item: MemoryItem, event: ItemEvent, now: number): MemoryItem {
  if (!canApply(item, event)) return item;
  const next = (patch: Partial<MemoryItem>): MemoryItem => ({ ...item, ...patch, updatedAt: now });
  switch (event.type) {
    case 'confirm': return next({ status: 'open', leftOut: undefined });
    case 'edit': return next(event.changes);
    case 'done': return next({ status: 'done', snoozedUntil: undefined });
    case 'undo':
      return item.status === 'dismissed'
        ? next({ status: 'suggested', dismissReason: undefined })
        : next({ status: 'open', dropReason: undefined });
    case 'snooze': return next({ snoozedUntil: event.until });
    case 'drop':
      return event.reason === 'notAPromise' || event.reason === 'wrongPerson'
        ? next({ status: 'dismissed', dismissReason: event.reason })
        : next({ status: 'dropped', dropReason: event.reason });
    case 'looksDone': return next({ status: 'looksDone', evidence: event.evidence });
    case 'notYet': return next({ status: 'open', evidence: undefined });
    case 'answer': return next({ status: 'answered', history: event.quote ? [...item.history, event.quote] : item.history });
    case 'replace': return next({ status: 'replaced', replacedById: event.byId });
    case 'undoReplace': return next({ status: 'open', replacedById: undefined });
  }
}
