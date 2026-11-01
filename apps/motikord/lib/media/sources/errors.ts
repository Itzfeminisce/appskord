/** Why a source left its results out: offline (no answer), key (401/403), busy (429), down (any other error), unreadable (not JSON). */
export type SourceErrorReason = 'offline' | 'key' | 'busy' | 'down' | 'unreadable';

export class SourceError extends Error {
  constructor(readonly reason: SourceErrorReason, readonly status?: number) {
    super(`Media source ${reason}${status ? ` (${status})` : ''}`);
    this.name = 'SourceError';
  }
}

/** Reads a fetch reply as a SourceError when it is not ok. */
export function checkReply(res: Response): Response {
  if (res.ok) return res;
  throw new SourceError(res.status === 401 || res.status === 403 ? 'key' : res.status === 429 ? 'busy' : 'down', res.status);
}
