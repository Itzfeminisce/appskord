/** The last search's problems per source, so Media sources can show "Not answering". Session only: cleared when Chrome closes. */
const STATUS_KEY = 'motikordSourceStatus';
export type SourceStatus = { state: 'down' | 'busy' | 'rejected'; status?: number };

export async function getSourceStatus(): Promise<Record<string, SourceStatus>> {
  try {
    const v = (await browser.storage.session.get(STATUS_KEY))[STATUS_KEY];
    return v && typeof v === 'object' ? (v as Record<string, SourceStatus>) : {};
  } catch { return {}; }
}

/** Replaces the status of the sources a search asked: problems are set, the rest cleared. */
export async function setSourceStatus(asked: string[], problems: Record<string, SourceStatus>): Promise<void> {
  const now = await getSourceStatus();
  for (const id of asked) delete now[id];
  await browser.storage.session.set({ [STATUS_KEY]: { ...now, ...problems } }).catch(() => undefined);
}
