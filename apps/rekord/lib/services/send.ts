/** Sending action items out: one call per promise to the chosen service, then the promise remembers where it went. */
import { record as recordCall, trackSend } from '../ledger';
import { putItem } from '../memory/store';
import type { MemoryItem } from '../memory/types';
import { addDatabasePage, searchDatabases, type NotionDatabase, type NotionDeps } from '../share/notion';
import { addTask, type TasksDeps } from './gtasks';
import { createIssue, type LinearDeps } from './linear';
import { promiseOrder } from './order';

export type SendService = NonNullable<MemoryItem['sentTo']>[number]['service'];

/** Names as the frames write them: "Send 2 to Google Tasks", "In Google Tasks". */
export const SERVICE_NAMES: Record<SendService, string> = { gtasks: 'Google Tasks', notion: 'Notion', linear: 'Linear' };

/** Where a promise was sent most recently, for the "In Google Tasks" chip. */
export function lastSent(item: Pick<MemoryItem, 'sentTo'>): NonNullable<MemoryItem['sentTo']>[number] | undefined {
  return item.sentTo?.reduce<NonNullable<MemoryItem['sentTo']>[number] | undefined>((a, b) => (!a || b.at >= a.at ? b : a), undefined);
}

/** Whether this item already went to the service. */
export const sentTo = (item: Pick<MemoryItem, 'sentTo'>, service: SendService): boolean => !!item.sentTo?.some((s) => s.service === service);

/** The promises a meeting can send, in the frame's order. */
export function sendable(items: MemoryItem[], meetingId: string): MemoryItem[] {
  return items
    .filter((i) => i.meetingId === meetingId && i.kind === 'promise' && !i.leftOut && !['dismissed', 'dropped', 'replaced'].includes(i.status))
    .sort(promiseOrder);
}

/** Records one Notion call against the meeting. */
export async function notionDatabases(token: string, meetingId: string, deps: NotionDeps & { record?: typeof recordCall } = {}): Promise<NotionDatabase[]> {
  try {
    return await searchDatabases(token, deps);
  } finally {
    await (deps.record ?? recordCall)({ meetingId, service: 'notion', what: 'Database list' });
  }
}

export type SendTarget =
  | { service: 'gtasks'; listId: string }
  | { service: 'notion'; token: string; database: NotionDatabase }
  | { service: 'linear'; key: string; teamId: string };

export interface SendDeps {
  tasks?: TasksDeps;
  notion?: NotionDeps;
  linear?: LinearDeps;
  record?: typeof recordCall;
  now?: () => number;
  /** Saves the item (defaults to the memory store). */
  save?: (item: MemoryItem) => Promise<void>;
}

async function sendOne(target: SendTarget, item: MemoryItem, note: string, deps: SendDeps): Promise<string> {
  const record = deps.record;
  if (target.service === 'gtasks') return addTask(target.listId, item, note, { ...deps.tasks, ...(record ? { record } : {}) });
  if (target.service === 'linear') return createIssue(target.key, target.teamId, item, note, { ...deps.linear, ...(record ? { record } : {}) });
  const tracked = trackSend(deps.notion?.fetch);
  try {
    return await addDatabasePage(target.token, target.database, item, note, { ...deps.notion, fetch: tracked.fetch });
  } finally {
    if (tracked.left()) await (record ?? recordCall)({ meetingId: item.meetingId, service: 'notion', what: 'Action items' });
  }
}

export interface SendResult { sent: { item: MemoryItem; url: string }[]; error?: unknown }

/**
 * Sends each item in turn and saves its `sentTo` right after, so a failure part way keeps what already went.
 * `noteFor` gives the line under each task (who it is owed to, the meeting). Never throws: the first error stops.
 */
export async function sendItems(target: SendTarget, items: MemoryItem[], noteFor: (item: MemoryItem) => string, deps: SendDeps = {}): Promise<SendResult> {
  const now = deps.now ?? Date.now;
  const save = deps.save ?? putItem;
  const sent: SendResult['sent'] = [];
  for (const item of items) {
    try {
      const url = await sendOne(target, item, noteFor(item), deps);
      const at = now();
      const next: MemoryItem = { ...item, sentTo: [...(item.sentTo ?? []), { service: target.service, url, at }], updatedAt: at };
      await save(next);
      sent.push({ item: next, url });
    } catch (error) {
      return { sent, error };
    }
  }
  return { sent };
}
