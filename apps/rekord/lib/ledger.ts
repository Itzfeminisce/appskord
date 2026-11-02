import { getDB } from './db';
import type { LedgerEntry } from './memory/types';

export interface LedgerCall { meetingId?: string; service: LedgerEntry['service']; what: string; at?: number }

/** Folds one call into the rows: same meeting, service and what add to one row's count and times. */
export function mergeCall(rows: LedgerEntry[], call: LedgerCall, at: number, newId: () => string): LedgerEntry {
  const row = rows.find((r) => r.meetingId === call.meetingId && r.service === call.service && r.what === call.what);
  if (!row) return { id: newId(), meetingId: call.meetingId, service: call.service, what: call.what, count: 1, firstAt: at, lastAt: at };
  return { ...row, count: row.count + 1, firstAt: Math.min(row.firstAt, at), lastAt: Math.max(row.lastAt, at) };
}

/** Records one outside call. Never pass a key, transcript text or email body as `what`. */
export function record(call: LedgerCall): Promise<LedgerEntry> {
  const run = queue.then(() => write(call));
  queue = run.catch(() => undefined);
  return run;
}

// Calls run one at a time so parallel calls add to one row instead of racing to create two.
let queue: Promise<unknown> = Promise.resolve();

async function write(call: LedgerCall): Promise<LedgerEntry> {
  // Read, merge and put in one transaction so two contexts cannot each create the row.
  const tx = (await getDB()).transaction('ledger', 'readwrite');
  const all = call.meetingId
    ? await tx.store.index('meetingId').getAll(call.meetingId)
    : (await tx.store.getAll()).filter((r) => !r.meetingId);
  const entry = mergeCall(all, call, call.at ?? Date.now(), () => crypto.randomUUID());
  await Promise.all([tx.store.put(entry), tx.done]);
  return entry;
}
